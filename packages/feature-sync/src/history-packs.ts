import { createHash } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import {
  canonicalJson,
  HASH,
  recordKey,
  SyncError,
  validateVersion,
  type RecordVersion,
  type SyncReplica,
  type SyncStorage,
  type VersionItem,
} from '@nook-dsh/capability-sync'

const encode = (value: unknown) => Buffer.from(canonicalJson(value))
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const LIMIT = 8_000_000
interface Manifest {
  format: 1
  head: string
  chunks: string[]
}
function parse(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'))
  } catch {
    throw new SyncError('同步历史包 JSON 损坏。')
  }
}

/** Content-addressed sidecars; individual objects remain the compatibility protocol. */
export class HistoryPacks {
  private readonly manifests = new Map<string, Promise<Manifest>>()
  readonly received = new Map<string, readonly string[]>()
  constructor(
    private readonly replica: Pick<SyncReplica, 'version'> & Partial<Pick<SyncReplica, 'hasPack'>>,
    private readonly remote: SyncStorage,
  ) {}

  private manifest(hash: string, head: string, signal: AbortSignal) {
    let task = this.manifests.get(hash)
    if (!task) {
      task = (async () => {
        const object = await this.remote.get(`objects/${hash}.history`, signal)
        if (!object || object.bytes.length > LIMIT || digest(object.bytes) !== hash)
          throw new SyncError('同步历史清单缺失或校验失败。')
        const value = parse(object.bytes) as Manifest
        if (
          !value ||
          value.format !== 1 ||
          !HASH.test(value.head) ||
          !Array.isArray(value.chunks) ||
          !value.chunks.length ||
          value.chunks.length > 100000 ||
          !value.chunks.every(h => typeof h === 'string' && HASH.test(h)) ||
          new Set(value.chunks).size !== value.chunks.length
        )
          throw new SyncError('同步历史清单格式无效。')
        return value
      })()
      this.manifests.set(hash, task)
    }
    return task.then(value => {
      if (value.head !== head) throw new SyncError('同步历史清单与版本不一致。')
      return value
    })
  }

  async download(
    head: string,
    manifest: string,
    key: string,
    signal: AbortSignal,
  ): Promise<Map<string, RecordVersion>> {
    const result = new Map<string, RecordVersion>()
    for (const hash of (await this.manifest(manifest, head, signal)).chunks) {
      signal.throwIfAborted()
      if (this.replica.hasPack?.(hash)) continue
      const object = await this.remote.get(`objects/${hash}.pack`, signal)
      if (!object || object.bytes.length > LIMIT || digest(object.bytes) !== hash)
        throw new SyncError('同步历史包缺失或校验失败。')
      let raw: Buffer
      try {
        raw = gunzipSync(object.bytes, { maxOutputLength: LIMIT })
      } catch {
        throw new SyncError('同步历史包损坏或超出大小限制。')
      }
      const items = parse(raw) as VersionItem[]
      if (!Array.isArray(items) || !items.length || items.length > 128) throw new SyncError('同步历史包格式无效。')
      for (const item of items) {
        if (!item || typeof item.hash !== 'string' || !HASH.test(item.hash))
          throw new SyncError('同步历史版本标识无效。')
        validateVersion(item.value)
        if (recordKey(item.value.type, item.value.id) !== key || digest(encode(item.value)) !== item.hash)
          throw new SyncError('同步历史版本校验失败。')
        if (result.has(item.hash)) throw new SyncError('同步历史包包含重复版本。')
        result.set(item.hash, item.value)
        if (result.size > 100000) throw new SyncError('同步历史超出容量。')
      }
      this.received.set(
        hash,
        items.map(item => item.hash),
      )
    }
    return result
  }

  /** Stable oldest-first chunks reuse sealed prefixes as a linear history grows. */
  async publish(
    head: string,
    previous: readonly { head: string; manifest: string }[],
    signal: AbortSignal,
    immutable: (path: string, bytes: Uint8Array, signal: AbortSignal) => Promise<void>,
  ): Promise<string> {
    const reusable = new Set<string>()
    for (const old of previous)
      for (const hash of (await this.manifest(old.manifest, old.head, signal)).chunks) reusable.add(hash)
    const seen = new Set<string>(),
      active = new Set<string>()
    const ordered: VersionItem[] = []
    const stack: { hash: string; value?: RecordVersion }[] = [{ hash: head }]
    let key: string | undefined
    while (stack.length) {
      signal.throwIfAborted()
      const item = stack.pop()!
      if (item.value) {
        active.delete(item.hash)
        seen.add(item.hash)
        ordered.push({ hash: item.hash, value: item.value })
        continue
      }
      if (seen.has(item.hash)) continue
      if (active.has(item.hash) || seen.size + active.size >= 100000)
        throw new SyncError('本地版本历史损坏或超出容量。')
      const value = this.replica.version(item.hash)
      if (!value) throw new SyncError('本地同步版本缺失。')
      key ??= recordKey(value.type, value.id)
      if (recordKey(value.type, value.id) !== key) throw new SyncError('版本历史跨记录引用。')
      active.add(item.hash)
      stack.push({ hash: item.hash, value })
      for (const parent of [...value.parents].sort().reverse()) stack.push({ hash: parent })
    }
    const chunks: string[] = []
    let batch: VersionItem[] = [],
      size = 2
    const flush = async () => {
      if (!batch.length) return
      const raw = encode(batch)
      if (raw.length > LIMIT) throw new SyncError('同步历史包超出大小限制。')
      const bytes = gzipSync(raw)
      const hash = digest(bytes)
      if (!reusable.has(hash)) await immutable(`objects/${hash}.pack`, bytes, signal)
      chunks.push(hash)
      batch = []
      size = 2
    }
    for (const item of ordered) {
      const length = encode(item).length + 1
      if (batch.length && (batch.length === 128 || size + length > 1_000_000)) await flush()
      batch.push(item)
      size += length
    }
    await flush()
    const bytes = encode({ format: 1, head, chunks } satisfies Manifest)
    if (bytes.length > LIMIT) throw new SyncError('同步历史清单超出大小限制。')
    const hash = digest(bytes)
    await immutable(`objects/${hash}.history`, bytes, signal)
    return hash
  }
}
