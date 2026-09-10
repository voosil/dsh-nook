import { createHash } from 'node:crypto'
import * as A from '@automerge/automerge'
import {
  canonicalJson,
  SyncError,
  type Json,
  type SyncMergeInput,
  type SyncMergeResult,
} from '@nook-dsh/capability-sync'

type Document = { text: string; fields: Record<string, A.ImmutableString> }
const POLICY = 'nook-automerge-1/3.4.1'
const actor = (value: string) => createHash('sha256').update(`${POLICY}/${value}`).digest('hex')
const ignored = new Set(['id', 'createdAt', 'updatedAt', 'deletedAt', 'markdown', 'description'])

/** Rebuildable, process-local cache. Serialized bytes are never a sync identity. */
export class MergeAlgorithm {
  private readonly cache = new Map<string, Uint8Array>()
  private bytes = 0
  private remember(hash: string, doc: A.Doc<Document>) {
    const bytes = A.save(doc)
    if (bytes.length > 64_000_000) return
    const previous = this.cache.get(hash)
    if (previous) this.bytes -= previous.length
    this.cache.delete(hash)
    this.cache.set(hash, bytes)
    this.bytes += bytes.length
    while (this.bytes > 64_000_000) {
      const first = this.cache.keys().next().value!
      this.bytes -= this.cache.get(first)!.length
      this.cache.delete(first)
    }
  }
  merge(input: SyncMergeInput): SyncMergeResult {
    const versions = new Map(input.versions.map(item => [item.hash, item.value]))
    const heads = [...input.heads].sort()
    const first = versions.get(heads[0]!)
    if (!first || !['note', 'project'].includes(first.type)) throw new SyncError('不支持此合并类型。')
    const key = `${first.type}/${first.id}`
    const textKey = first.type === 'note' ? 'markdown' : 'description'
    const maxText = first.type === 'note' ? 500_000 : 2000
    const seed = () =>
      A.change(A.init<Document>({ actor: actor(`seed/${key}`) }), { time: 0 }, d => {
        d.text = ''
        d.fields = {}
      })
    const order: string[] = []
    const visited = new Set<string>()
    const active = new Set<string>()
    const uses = new Map<string, number>()
    for (const head of heads) {
      const stack: { hash: string; exit: boolean }[] = [{ hash: head, exit: false }]
      while (stack.length) {
        const step = stack.pop()!
        if (step.exit) {
          active.delete(step.hash)
          visited.add(step.hash)
          order.push(step.hash)
          continue
        }
        if (visited.has(step.hash)) continue
        if (active.has(step.hash)) throw new SyncError('版本历史包含循环。')
        const v = versions.get(step.hash)
        if (!v || `${v.type}/${v.id}` !== key || v.schema !== 1) throw new SyncError('合并历史不完整或版本不受支持。')
        active.add(step.hash)
        stack.push({ hash: step.hash, exit: true })
        if (!this.cache.has(step.hash)) {
          for (const parent of [...new Set(v.parents)].sort().reverse()) {
            uses.set(parent, (uses.get(parent) ?? 0) + 1)
            stack.push({ hash: parent, exit: false })
          }
        }
      }
    }
    const states = new Map<string, A.Doc<Document>>()
    const retained = new Set(heads)
    let result: A.Doc<Document> | undefined
    try {
      for (const hash of order) {
        const cached = this.cache.get(hash)
        if (cached) {
          states.set(hash, A.load<Document>(cached, { actor: actor(`load/${hash}`) }))
          continue
        }
        const v = versions.get(hash)!
        const parents = [...new Set(v.parents)].sort()
        let doc = parents.length ? A.clone(states.get(parents[0]!)!, { actor: actor(hash) }) : seed()
        for (const parent of parents.slice(1)) doc = A.merge(doc, states.get(parent)!)
        if (!parents.length) {
          const initial = doc
          doc = A.clone(initial, { actor: actor(hash) })
          A.free(initial)
        }
        const data = v.data as Record<string, Json>
        doc = A.change(doc, { time: 0 }, d => {
          const text = String(data[textKey] ?? '')
          if (d.text !== text) A.updateText(d, ['text'], text)
          for (const field of Object.keys(d.fields).sort()) if (!(field in data)) delete d.fields[field]
          for (const field of Object.keys(data).sort()) {
            if (ignored.has(field)) continue
            const value = canonicalJson(data[field])
            if (d.fields[field]?.toString() !== value) d.fields[field] = new A.ImmutableString(value)
          }
        })
        states.set(hash, doc)
        for (const parent of parents) {
          uses.set(parent, uses.get(parent)! - 1)
          if (!uses.get(parent) && !retained.has(parent)) {
            A.free(states.get(parent)!)
            states.delete(parent)
          }
        }
      }
      result = A.clone(states.get(heads[0]!)!, { actor: actor(`result/${heads.join('/')}`) })
      for (const head of heads.slice(1)) result = A.merge(result, states.get(head)!)
      const values = heads.map(hash => versions.get(hash)!)
      const data: Record<string, Json> = Object.fromEntries(
        Object.entries(result.fields).map(([field, value]) => [field, JSON.parse(value.toString()) as Json]),
      )
      const snapshots = values.map(v => v.data as Record<string, Json>)
      data.id = first.id
      data.createdAt = snapshots.map(v => String(v.createdAt)).sort()[0]!
      data.updatedAt = snapshots
        .map(v => String(v.updatedAt))
        .sort((a, b) => Date.parse(a) - Date.parse(b) || (a < b ? -1 : a > b ? 1 : 0))
        .at(-1)!
      data[textKey] = result.text.length <= maxText ? result.text : snapshots[0]![textKey]!
      const deleted = values.every(v => v.deleted)
      if (first.type === 'note')
        data.deletedAt = deleted
          ? snapshots
              .map(v => String(v.deletedAt))
              .sort()
              .at(-1)!
          : null
      const blobs = [...new Map(values.flatMap(v => v.blobs).map(b => [canonicalJson(b), b])).entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([, b]) => b)
      for (const head of heads) this.remember(head, states.get(head)!)
      return { data, deleted, blobs: blobs.length <= 100 ? blobs : first.blobs }
    } finally {
      if (result) A.free(result)
      for (const doc of states.values()) A.free(doc)
    }
  }
}
