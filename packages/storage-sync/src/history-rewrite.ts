import { createHash } from 'node:crypto'
import {
  canonicalJson,
  HASH,
  recordKey,
  SyncError,
  type Json,
  type RecordVersion,
  type SyncEpochMigration,
  type SyncEpochPlan,
  type SyncEpochTransition,
  type SyncIndex,
  type SyncTypeHandler,
  type VersionItem,
} from '@nook-dsh/capability-sync'
const hashVersion = (value: RecordVersion) => createHash('sha256').update(canonicalJson(value)).digest('hex')
function mappings(t: SyncEpochTransition): Record<string, string | null> {
  return (t.migration.data as { mapping: Record<string, string | null> }).mapping
}
export function historyRewriteMigration(handlers: Map<string, SyncTypeHandler>): SyncEpochMigration {
  return {
    id: 'history-rewrite',
    version: 1,
    validate(t) {
      const map = (t.migration.data as { mapping?: unknown } | null)?.mapping
      if (
        !map ||
        typeof map !== 'object' ||
        Array.isArray(map) ||
        Object.keys(map).length > 100000 ||
        Object.entries(map).some(
          ([old, next]) => !HASH.test(old) || (next !== null && (typeof next !== 'string' || !HASH.test(next))),
        )
      )
        throw new SyncError('历史重写映射无效。')
      if (
        Object.values(t.from.heads)
          .flat()
          .some(h => !(h in map) || (map as Record<string, unknown>)[h] === null)
      )
        throw new SyncError('历史重写不能移除当前记录。')
    },
    mapped: (hash, t) => mappings(t)[hash],
    rewrite(value, resolve) {
      const handler = handlers.get(value.type)
      const updated =
        handler?.schema === value.schema && handler.remapReferences ? handler.remapReferences(value, resolve) : value
      return { ...updated, parents: value.parents.map(resolve) }
    },
  }
}

/** Preserve referenced snapshots; unknown reference semantics preserve their complete ancestry. */
export function planHistoryRewrite(
  from: SyncIndex,
  versions: readonly VersionItem[],
  remove: readonly string[],
  handlers: Map<string, SyncTypeHandler>,
): SyncEpochPlan {
  const all = new Map(versions.map(v => [v.hash, v.value])),
    dropped = new Set(remove),
    frozen = new Set<string>()
  if (all.size > 100000 || remove.some(h => !all.has(h))) throw new SyncError('历史精简范围无效。')
  const preserve = (hash: string, ancestors: boolean) => {
    const stack = [hash],
      seen = new Set<string>()
    while (stack.length) {
      const h = stack.pop()!
      if (seen.has(h)) continue
      seen.add(h)
      dropped.delete(h)
      if (ancestors) frozen.add(h)
      const v = all.get(h)
      if (!v) throw new SyncError('历史引用缺失。')
      if (ancestors) stack.push(...v.parents)
    }
  }
  for (const h of Object.values(from.heads).flat()) preserve(h, false)
  const scan = (v: Json) => {
    if (typeof v === 'string' && all.has(v)) preserve(v, true)
    else if (Array.isArray(v)) for (const item of v) scan(item)
    else if (v && typeof v === 'object') for (const item of Object.values(v)) scan(item)
  }
  // Even historical referencing records remain restorable, so inspect all retained records.
  let size: number
  do {
    size = dropped.size - frozen.size
    for (const [hash, value] of all) {
      if (dropped.has(hash)) continue
      const handler = handlers.get(value.type)
      if (handler?.schema === value.schema && handler.references && handler.remapReferences) {
        for (const ref of handler.references(value)) if (all.has(ref)) preserve(ref, frozen.has(hash))
      } else scan(value.data)
    }
  } while (dropped.size - frozen.size !== size)
  const mapping: Record<string, string | null> = Object.fromEntries([...dropped].map(h => [h, null]))
  const output = new Map<string, RecordVersion>()
  const effectiveParents = (hash: string): string[] => {
    const found = new Set<string>(),
      seen = new Set<string>(),
      stack = [hash]
    while (stack.length) {
      const id = stack.pop()!
      if (seen.has(id)) continue
      seen.add(id)
      if (dropped.has(id)) stack.push(...all.get(id)!.parents)
      else found.add(id)
    }
    return [...found].sort()
  }
  const active = new Set<string>()
  for (const root of all.keys()) {
    if (dropped.has(root) || mapping[root]) continue
    const stack: { hash: string; expanded?: boolean }[] = [{ hash: root }]
    while (stack.length) {
      const { hash, expanded } = stack.pop()!
      if (mapping[hash]) continue
      const value = all.get(hash)
      if (!value || dropped.has(hash)) throw new SyncError('历史版本缺失。')
      const handler = handlers.get(value.type),
        known = handler?.schema === value.schema
      const parents = [...new Set(value.parents.flatMap(effectiveParents))].sort()
      if (!expanded) {
        if (active.has(hash)) throw new SyncError('历史引用无法重写。')
        active.add(hash)
        stack.push({ hash, expanded: true })
        const refs = known ? (handler.references?.(value) ?? []) : []
        for (const dependency of [...new Set([...parents, ...refs.filter(h => all.has(h))])].reverse())
          if (!mapping[dependency]) stack.push({ hash: dependency })
        continue
      }
      const resolve = (id: string) => {
        if (!all.has(id)) return id
        const target = mapping[id]
        if (!target) throw new SyncError('历史引用的目标未保留。')
        return target
      }
      const content = known && handler.remapReferences ? handler.remapReferences(value, resolve) : value
      const next: RecordVersion = frozen.has(hash) ? value : { ...content, parents: parents.map(resolve).sort() }
      const result = hashVersion(next)
      mapping[hash] = result
      output.set(result, next)
      active.delete(hash)
    }
  }
  const rewrite = (hash: string) => {
    const result = mapping[hash]
    if (!result) throw new SyncError('当前版本不能删除。')
    return result
  }
  const heads: Record<string, string[]> = {}
  for (const hashes of Object.values(from.heads))
    for (const old of hashes) {
      const hash = rewrite(old),
        value = output.get(hash)!
      ;(heads[recordKey(value.type, value.id)] ??= []).push(hash)
    }
  return {
    from,
    versions: [...output].map(([hash, value]) => ({ hash, value })),
    heads,
    migration: { id: 'history-rewrite', version: 1, data: { mapping } },
  }
}
