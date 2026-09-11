import { createHash, randomUUID } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import {
  canonicalJson,
  epochBaseline,
  recordKey,
  syncEpoch,
  SyncError,
  validateEpochTransition,
  validateIndex,
  validateVersion,
  type SyncEpochPlan,
  type SyncEpochTransition,
  type SyncIndex,
  type SyncReplica,
  type SyncStorage,
} from '@nook-dsh/capability-sync'
import { concurrent, pullIndex } from './pull.js'
import { HistoryPacks } from './history-packs.js'
const encode = (v: unknown) => Buffer.from(canonicalJson(v))
const digest = (v: Uint8Array) => createHash('sha256').update(v).digest('hex')
const LIMIT = 32_000_000
async function readTransition(
  remote: SyncStorage,
  index: SyncIndex,
  signal: AbortSignal,
): Promise<SyncEpochTransition> {
  const object = await remote.get(`objects/${index.transition}.epoch`, signal)
  if (!object || object.bytes.length > LIMIT || digest(object.bytes) !== index.transition)
    throw new SyncError('同步迁移清单缺失或校验失败。')
  let value: unknown
  try {
    value = JSON.parse(gunzipSync(object.bytes, { maxOutputLength: LIMIT }).toString('utf8'))
  } catch {
    throw new SyncError('同步迁移清单损坏或超出大小限制。')
  }
  validateEpochTransition(value)
  if (
    value.epoch !== index.epoch ||
    value.from.vaultId !== index.vaultId ||
    BigInt(value.from.generation) >= BigInt(index.generation)
  )
    throw new SyncError('同步迁移链不一致。')
  return value
}

/** Preflight the whole chain, then commit one recoverable transition at a time. */
export async function migrateEpochs(
  replica: SyncReplica,
  remote: SyncStorage,
  current: SyncIndex,
  signal: AbortSignal,
) {
  const previous = replica.remoteIndex()
  if (!previous) {
    if (current.format === 2) {
      const transition = await readTransition(remote, current, signal)
      if (!replica.supportsEpochMigration(transition.migration.id, transition.migration.version))
        throw new SyncError('此数据代次需要更新应用后才能同步，本地修改已保留。')
    }
    return
  }
  if (syncEpoch(previous) === syncEpoch(current)) return
  const chain: { transition: SyncEpochTransition; hash: string }[] = []
  let index = current
  while (syncEpoch(previous) !== syncEpoch(index)) {
    signal.throwIfAborted()
    if (index.format !== 2 || chain.length >= 64) throw new SyncError('同步代次发生回退或迁移链过长，已保留本地数据。')
    const transition = await readTransition(remote, index, signal)
    if (!replica.adoptEpoch || !replica.supportsEpochMigration?.(transition.migration.id, transition.migration.version))
      throw new SyncError('此数据代次需要更新应用后才能同步，本地修改已保留。')
    chain.unshift({ transition, hash: index.transition! })
    index = transition.from
  }
  if (index.vaultId !== previous.vaultId || BigInt(index.generation) < BigInt(previous.generation))
    throw new SyncError('同步迁移源发生回退。')
  for (const item of chain) {
    const baseline = epochBaseline(item.transition, item.hash)
    const downloaded = await pullIndex(replica, remote, baseline, signal)
    signal.throwIfAborted()
    replica.adoptEpoch!(item.transition, item.hash, downloaded.versions, downloaded.packs)
    await replica.reconcile(signal)
  }
}

/** Stage immutable artifacts; a single CAS changes the active epoch in the existing vault. */
export async function publishEpoch(remote: SyncStorage, plan: SyncEpochPlan, signal: AbortSignal): Promise<SyncIndex> {
  signal.throwIfAborted()
  validateIndex(plan.from)
  validateEpochTransition({
    format: 1,
    from: plan.from,
    epoch: randomUUID(),
    baseline: { heads: plan.heads },
    migration: plan.migration,
  })
  const source = await remote.get('index.json', signal)
  if (!source) throw new SyncError('同步索引不存在。')
  const existing = JSON.parse(Buffer.from(source.bytes).toString()) as unknown
  validateIndex(existing)
  if (canonicalJson(existing) !== canonicalJson(plan.from)) {
    if (existing.format === 2) {
      const committed = await readTransition(remote, existing, signal)
      if (
        canonicalJson(committed.from) === canonicalJson(plan.from) &&
        canonicalJson(committed.migration) === canonicalJson(plan.migration) &&
        canonicalJson(committed.baseline.heads) === canonicalJson(plan.heads)
      )
        return existing
    }
    throw new SyncError('精简期间其他设备更新了同步库，请重新同步并生成迁移计划。')
  }
  const versions = new Map(plan.versions.map(item => [item.hash, item.value]))
  if (versions.size !== plan.versions.length || versions.size > 100000) throw new SyncError('迁移版本重复或超出容量。')
  for (const item of plan.versions) {
    validateVersion(item.value)
    const raw = encode(item.value)
    if (
      raw.length > 4_000_000 ||
      digest(raw) !== item.hash ||
      item.value.parents.some(h => {
        const parent = versions.get(h)
        return !parent || recordKey(parent.type, parent.id) !== recordKey(item.value.type, item.value.id)
      })
    )
      throw new SyncError('迁移计划的版本或父引用无效。')
  }
  for (const [key, heads] of Object.entries(plan.heads))
    for (const h of heads) {
      const v = versions.get(h)
      if (!v || recordKey(v.type, v.id) !== key) throw new SyncError('迁移计划的记录标识无效。')
    }
  const reachable = new Set<string>(),
    todo = Object.values(plan.heads).flat()
  while (todo.length) {
    const h = todo.pop()!
    if (reachable.has(h)) continue
    reachable.add(h)
    todo.push(...versions.get(h)!.parents)
  }
  if (reachable.size !== versions.size) throw new SyncError('迁移计划含有无法从当前记录访问的版本。')
  const checked = new Map<string, Promise<void>>()
  const immutable = (path: string, bytes: Uint8Array, cancellation: AbortSignal) => {
    let task = checked.get(path)
    if (!task) {
      task = (async () => {
        await remote.put(path, bytes, null, cancellation)
        const stored = await remote.get(path, cancellation)
        if (!stored || digest(stored.bytes) !== digest(bytes)) throw new SyncError('迁移对象写入校验失败。')
      })()
      checked.set(path, task)
    }
    return task
  }
  await concurrent(plan.versions, signal, async (item, cancellation) => {
    // Existing attachments keep their original content addresses and are checked before publication.
    for (const ref of item.value.blobs) {
      const blob = await remote.get(`blobs/${ref.hash}`, cancellation)
      if (!blob || blob.bytes.length !== ref.bytes || digest(blob.bytes) !== ref.hash)
        throw new SyncError('迁移附件缺失。')
    }
    await immutable(`objects/${item.hash}`, encode(item.value), cancellation)
  })
  const packs: Record<string, string> = {}
  const history = new HistoryPacks({ version: hash => versions.get(hash) ?? null }, remote)
  await concurrent(Object.values(plan.heads).flat(), signal, async (head, cancellation) => {
    packs[head] = await history.publish(head, [], cancellation, immutable)
  })
  const transition: SyncEpochTransition = {
    format: 1,
    from: plan.from,
    epoch: randomUUID(),
    baseline: { heads: plan.heads, packs },
    migration: plan.migration,
  }
  validateEpochTransition(transition)
  const raw = encode(transition)
  if (raw.length > LIMIT) throw new SyncError('同步迁移清单超出大小限制。')
  const bytes = gzipSync(raw),
    hash = digest(bytes),
    next = epochBaseline(transition, hash)
  const indexBytes = encode(next)
  if (indexBytes.length > 4_000_000) throw new SyncError('同步索引超出大小限制。')
  await immutable(`objects/${hash}.epoch`, bytes, signal)
  signal.throwIfAborted()
  if (!(await remote.put('index.json', indexBytes, source.etag, signal)))
    throw new SyncError('迁移发布遇到并发更新，旧代次仍有效，请重新生成计划。')
  return next
}
