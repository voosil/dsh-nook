import { createHash, randomUUID } from 'node:crypto'
import { HistoryPacks } from './history-packs.js'
import { concurrent, pullIndex } from './pull.js'
import { migrateEpochs } from './epochs.js'
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
/** Generic record DAG; file payloads stay outside the metadata index. */
export async function synchronize(
  replica: SyncReplica,
  remote: SyncStorage,
  target: string,
  signal: AbortSignal,
): Promise<void> {
  // A CAS retry can reuse objects already verified during this run.
  const verified = new Map<string, Promise<void>>()
  const packs = new HistoryPacks(replica, remote)
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
    await migrateEpochs(replica, remote, index, signal)
    const downloaded = await pullIndex(replica, remote, index, signal)
    replica.receive(downloaded.versions, index, downloaded.packs)
    await replica.reconcile(signal)
    const snapshot = replica.snapshot()
    const headsToPack = Object.entries(snapshot.heads).flatMap(([key, heads]) =>
      heads.filter(h => !index.packs?.[h]).map(head => ({ key, head })),
    )
    if (!snapshot.pending.length && !headsToPack.length) return
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
    const manifests: Record<string, string> = {}
    for (const head of Object.values(heads).flat()) if (index.packs?.[head]) manifests[head] = index.packs[head]!
    await concurrent(headsToPack, signal, async ({ key, head }, cancellation) => {
      const previous = (index.heads[key] ?? []).flatMap(h =>
        index.packs?.[h] ? [{ head: h, manifest: index.packs[h]! }] : [],
      )
      manifests[head] = await packs.publish(head, previous, cancellation, immutable)
    })
    const next: SyncIndex = {
      format: index.format,
      ...(index.format === 2 ? { epoch: index.epoch!, transition: index.transition! } : {}),
      vaultId: index.vaultId,
      generation: String(BigInt(index.generation) + 1n),
      heads,
      packs: manifests,
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
