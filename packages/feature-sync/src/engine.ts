import { createHash, randomUUID } from 'node:crypto'
import {
  canonicalJson,
  SyncError,
  validateIndex,
  validateVersion,
  recordKey,
  type SyncReplica,
  type SyncStorage,
  type SyncIndex,
  type RecordVersion,
} from '@nook-dsh/capability-sync'
const bytes = (v: unknown) => Buffer.from(canonicalJson(v))
const hash = (v: Uint8Array) => createHash('sha256').update(v).digest('hex')
const parse = (v: Uint8Array): unknown => {
  try {
    return JSON.parse(Buffer.from(v).toString('utf8'))
  } catch {
    throw new SyncError('远端 JSON 数据损坏。')
  }
}
/** Drain cancelled workers before returning, so a failed round cannot outlive its owner. */
async function concurrent<T>(
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
/** Generic record DAG; file payloads stay outside the metadata index. */
export async function synchronize(
  replica: SyncReplica,
  remote: SyncStorage,
  target: string,
  signal: AbortSignal,
): Promise<void> {
  // A CAS retry can reuse objects already verified during this run.
  const verified = new Map<string, Promise<void>>()
  function immutable(path: string, content: Uint8Array, cancellation: AbortSignal): Promise<void> {
    let task = verified.get(path)
    if (!task) {
      task = (async () => {
        await remote.put(path, content, null, cancellation)
        const check = await remote.get(path, cancellation)
        if (!check || hash(check.bytes) !== hash(content)) throw new SyncError('远端对象写入校验失败。')
      })()
      verified.set(path, task)
    }
    return task
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    signal.throwIfAborted()
    let object = await remote.get('index.json', signal)
    if (!object) {
      if (replica.binding()) throw new SyncError('已绑定的远端索引不存在，已停止同步。请检查目录或恢复备份。')
      const initial: SyncIndex = { format: 1, vaultId: randomUUID(), generation: '0', heads: {} }
      await remote.put('index.json', bytes(initial), null, signal)
      object = await remote.get('index.json', signal)
      if (!object) throw new SyncError('无法初始化同步目录。')
    }
    const index = parse(object.bytes)
    validateIndex(index)
    replica.bind(target, index.vaultId)
    const loaded = new Map<string, RecordVersion>()
    const visiting = new Set<string>()
    const blobs = new Map<string, Promise<void>>()
    let downloaded = 0
    async function load(id: string, cancellation: AbortSignal): Promise<RecordVersion> {
      cancellation.throwIfAborted()
      const known = loaded.get(id) ?? replica.version(id)
      if (known) return known
      if (visiting.has(id) || ++downloaded > 100000) throw new SyncError('远端版本链损坏或超出首版容量。')
      visiting.add(id)
      const o = await remote.get(`objects/${id}`, cancellation)
      if (!o || hash(o.bytes) !== id) throw new SyncError('远端版本缺失或校验失败。')
      const v = parse(o.bytes)
      validateVersion(v)
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
        const v = await load(h, cancellation)
        if (recordKey(v.type, v.id) !== key) throw new SyncError('远端索引标识不一致。')
      }
    })
    replica.receive(
      [...loaded].map(([hash, value]) => ({ hash, value })),
      index,
    )
    await replica.reconcile(signal)
    const snapshot = replica.snapshot()
    if (!snapshot.pending.length) return
    // Objects are invisible to readers until the index publishes the complete dependency set.
    await concurrent(snapshot.pending, signal, async (id, cancellation) => {
      const value = replica.version(id)
      if (!value) throw new SyncError('本地同步版本缺失。')
      for (const ref of value.blobs) {
        const content = replica.blob(ref.hash)
        if (!content || content.length !== ref.bytes) throw new SyncError('本地附件缺失。')
        await immutable(`blobs/${ref.hash}`, content, cancellation)
      }
      await immutable(`objects/${id}`, bytes(value), cancellation)
    })
    const heads: Record<string, readonly string[]> = {}
    for (const key of Object.keys(snapshot.heads).sort()) heads[key] = [...snapshot.heads[key]!].sort()
    const next: SyncIndex = {
      format: 1,
      vaultId: index.vaultId,
      generation: String(BigInt(index.generation) + 1n),
      heads,
    }
    validateIndex(next)
    const body = bytes(next)
    if (body.length > 4_000_000) throw new SyncError('同步索引超出首版容量，请保留本地数据。')
    if (await remote.put('index.json', body, object.etag, signal)) {
      replica.receive([], next)
      replica.acknowledge(snapshot.pending)
      // Pull once more so writes that raced this publication are observed.
      continue
    }
  }
  throw new SyncError('其他设备正在频繁同步，将自动重试。')
}
