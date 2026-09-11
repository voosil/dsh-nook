import { createHash } from 'node:crypto'
import {
  canonicalJson,
  SyncError,
  validateVersion,
  recordKey,
  type SyncIndex,
  type SyncReplica,
  type SyncStorage,
  type RecordVersion,
} from '@nook-dsh/capability-sync'
import { HistoryPacks } from './history-packs.js'
const hash = (v: Uint8Array) => createHash('sha256').update(v).digest('hex')
const parse = (v: Uint8Array): unknown => {
  try {
    return JSON.parse(Buffer.from(v).toString('utf8'))
  } catch {
    throw new SyncError('远端 JSON 数据损坏。')
  }
}
/** Drain cancelled workers before returning, so a failed round cannot outlive its owner. */
export async function concurrent<T>(
  items: readonly T[],
  signal: AbortSignal,
  visit: (item: T, signal: AbortSignal) => Promise<void>,
) {
  const controller = new AbortController()
  const cancellation = AbortSignal.any([signal, controller.signal])
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(6, items.length) }, async () => {
      try {
        while (cursor < items.length) {
          cancellation.throwIfAborted()
          await visit(items[cursor++]!, cancellation)
        }
      } catch (error) {
        if (!controller.signal.aborted) controller.abort(error)
      }
    }),
  )
  cancellation.throwIfAborted()
}
export async function pullIndex(replica: SyncReplica, remote: SyncStorage, index: SyncIndex, signal: AbortSignal) {
  const packs = new HistoryPacks(replica, remote)
  const loaded = new Map<string, RecordVersion>()
  const visiting = new Set<string>()
  const blobs = new Map<string, Promise<void>>()
  const packed = new Map<string, RecordVersion>()
  let downloaded = 0
  async function load(id: string, cancellation: AbortSignal): Promise<RecordVersion> {
    cancellation.throwIfAborted()
    const known = loaded.get(id) ?? replica.version(id)
    if (known) return known
    if (visiting.has(id) || ++downloaded > 100000) throw new SyncError('远端版本链损坏或超出首版容量。')
    visiting.add(id)
    let v: unknown = packed.get(id)
    if (!v) {
      const o = await remote.get(`objects/${id}`, cancellation)
      if (!o || hash(o.bytes) !== id) throw new SyncError('远端版本缺失或校验失败。')
      v = parse(o.bytes)
    }
    validateVersion(v)
    // Packed chains can be thousands of versions deep without an intervening I/O await.
    await Promise.resolve()
    for (const parent of v.parents) {
      const p = await load(parent, cancellation)
      if (recordKey(p.type, p.id) !== recordKey(v.type, v.id)) throw new SyncError('远端版本引用了其他记录。')
    }
    for (const ref of v.blobs) {
      if (!replica.blob(ref.hash)) {
        let task = blobs.get(ref.hash)
        if (!task) {
          task = (async () => {
            const content = await remote.get(`blobs/${ref.hash}`, cancellation)
            if (!content) throw new SyncError('远端附件尚不完整。')
            replica.receiveBlob(ref, content.bytes)
          })()
          blobs.set(ref.hash, task)
        }
        await task
      }
    }
    visiting.delete(id)
    loaded.set(id, v)
    return v
  }
  // A record's heads share ancestors; keep that traversal serial and parallelize records.
  await concurrent(Object.entries(index.heads), signal, async ([key, heads], cancellation) => {
    for (const h of heads) {
      if (!replica.version(h) && index.packs?.[h]) {
        for (const [id, value] of await packs.download(h, index.packs[h]!, key, cancellation)) packed.set(id, value)
        if (packed.size > 100000) throw new SyncError('同步历史超出容量。')
      }
      const v = await load(h, cancellation)
      if (recordKey(v.type, v.id) !== key) throw new SyncError('远端索引标识不一致。')
    }
  })
  const receivedPacks: string[] = []
  for (const [hash, ids] of packs.received) {
    if (!ids.every(id => loaded.has(id) || replica.version(id))) throw new SyncError('同步历史包包含不可达版本。')
    receivedPacks.push(hash)
  }
  return { versions: [...loaded].map(([hash, value]) => ({ hash, value })), packs: receivedPacks }
}
