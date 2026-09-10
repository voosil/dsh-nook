/** Nook-owned wire types. No runtime, database, or vendor objects cross this boundary. */
export { parseSyncConnection, CONNECTION_FILE_LIMIT, type SyncConnection } from './connection.js'
export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json }
export interface BlobRef {
  readonly hash: string
  readonly bytes: number
  readonly mediaType: string
}
export interface RecordVersion {
  readonly format: 1
  readonly type: string
  readonly id: string
  readonly schema: number
  readonly parents: readonly string[]
  readonly deleted: boolean
  readonly data: Json
  readonly blobs: readonly BlobRef[]
}
export interface SyncIndex {
  readonly format: 1
  readonly vaultId: string
  readonly generation: string
  readonly heads: Readonly<Record<string, readonly string[]>>
}
export interface RemoteObject {
  readonly bytes: Uint8Array
  readonly etag: string
}
export interface StorageConfig {
  readonly url: string
  readonly username: string
  readonly password: string
  readonly caCert?: string | undefined
}
export interface SyncStorage {
  get(path: string, signal: AbortSignal): Promise<RemoteObject | null>
  put(path: string, bytes: Uint8Array, expected: string | null, signal: AbortSignal): Promise<boolean>
  probe(signal: AbortSignal): Promise<void>
}
export interface SyncStorageFactory {
  open(config: StorageConfig): SyncStorage
}
export interface VersionItem {
  readonly hash: string
  readonly value: RecordVersion
}
export interface SyncConflict {
  readonly key: string
  readonly type: string
  readonly id: string
  readonly versions: readonly VersionItem[]
}
export interface ReplicaSnapshot {
  readonly heads: Readonly<Record<string, readonly string[]>>
  readonly pending: readonly string[]
}
export interface SyncMergeInput {
  readonly heads: readonly string[]
  readonly versions: readonly VersionItem[]
}
export type SyncMergeResult = Pick<RecordVersion, 'data' | 'deleted' | 'blobs'>
/** Host-only type registration; no database or runtime object enters the wire protocol. */
export interface SyncTypeHandler {
  readonly type: string
  readonly schema: number
  validate(value: RecordVersion): void
  apply?(value: RecordVersion, hash: string): void
  copy?(value: RecordVersion, id: string): Json
  merge?(input: SyncMergeInput, signal: AbortSignal): Promise<SyncMergeResult>
}
export interface RecordWrite {
  readonly type: string
  readonly id: string
  readonly schema: number
  readonly expected: string | null
  readonly data: Json
  readonly deleted: boolean
  readonly blobs: readonly BlobRef[]
}
/** Implementations own their transactions; callers never receive a SQLite connection. */
export interface SyncReplica {
  registerType(handler: SyncTypeHandler): () => void
  records(type: string): readonly VersionItem[]
  writeRecords(writes: readonly RecordWrite[]): readonly VersionItem[]
  snapshot(): ReplicaSnapshot
  version(hash: string): RecordVersion | null
  receive(versions: readonly VersionItem[], remote: SyncIndex): void
  reconcile(signal?: AbortSignal): Promise<void>
  acknowledge(hashes: readonly string[]): void
  binding(): { readonly target: string; readonly vaultId: string } | null
  bind(target: string, vaultId: string): void
  prepare(): void
  conflicts(): readonly SyncConflict[]
  resolve(key: string, expected: readonly string[], selected: string, copy: boolean): void
  stats(): {
    readonly pending: number
    readonly conflicts: number
    readonly unsupported: number
    readonly change: number
  }
  subscribe(listener: () => void): () => void
  blob(hash: string): Uint8Array | null
  receiveBlob(ref: BlobRef, bytes: Uint8Array): void
}
export interface SyncStatus {
  readonly enabled: boolean
  readonly state: 'disabled' | 'idle' | 'syncing' | 'error'
  readonly url: string
  readonly username: string
  readonly hasPassword: boolean
  readonly caCert: string
  readonly lastSync: string | null
  readonly error: string | null
  readonly pending: number
  readonly conflicts: number
  readonly unsupported: number
  readonly change: number
}
export interface ConfigureSync {
  readonly enabled: boolean
  readonly url: string
  readonly username: string
  readonly password?: string
  readonly caCert?: string | undefined
}
export interface SyncService {
  prepareDeployment(): Promise<{ directory: string }>
  status(): SyncStatus
  configure(config: ConfigureSync, signal: AbortSignal): Promise<SyncStatus>
  importConnection(file: string, expectedUrl: string, signal: AbortSignal): Promise<SyncStatus>
  run(): Promise<SyncStatus>
  conflicts(): readonly SyncConflict[]
  resolve(key: string, expected: readonly string[], selected: string, copy: boolean): Promise<SyncStatus>
}
export class SyncError extends Error {
  override readonly name = 'SyncError'
  readonly code = 'SYNC_ERROR'
}
export const HASH = /^[a-f0-9]{64}$/
export function recordKey(type: string, id: string): string {
  if (!/^[a-z][a-z0-9.-]{0,63}$/.test(type) || !/^[A-Za-z0-9_-]{1,128}$/.test(id))
    throw new SyncError('无效的数据类型或标识。')
  return `${type}/${id}`
}
export function validateVersion(value: unknown): asserts value is RecordVersion {
  const v = value as RecordVersion
  if (
    !v ||
    v.format !== 1 ||
    !Number.isSafeInteger(v.schema) ||
    v.schema < 1 ||
    typeof v.deleted !== 'boolean' ||
    !Array.isArray(v.parents) ||
    v.parents.length > 64 ||
    !v.parents.every(h => typeof h === 'string' && HASH.test(h)) ||
    !Array.isArray(v.blobs) ||
    v.blobs.length > 100 ||
    !v.blobs.every(
      b =>
        b &&
        HASH.test(b.hash) &&
        Number.isSafeInteger(b.bytes) &&
        b.bytes >= 0 &&
        b.bytes <= 20_000_000 &&
        typeof b.mediaType === 'string' &&
        b.mediaType.length <= 200,
    ) ||
    v.data === undefined
  )
    throw new SyncError('远端数据格式不受支持，请升级或检查同步目录。')
  recordKey(v.type, v.id)
}
export function validateIndex(value: unknown): asserts value is SyncIndex {
  const v = value as SyncIndex
  if (
    !v ||
    v.format !== 1 ||
    !/^[0-9a-f-]{36}$/i.test(v.vaultId) ||
    !/^(0|[1-9][0-9]{0,30})$/.test(v.generation) ||
    !v.heads ||
    Array.isArray(v.heads) ||
    typeof v.heads !== 'object' ||
    Object.keys(v.heads).length > 10000
  )
    throw new SyncError('同步索引格式不受支持或超出首版容量。')
  for (const [key, heads] of Object.entries(v.heads)) {
    const parts = key.split('/')
    if (
      parts.length !== 2 ||
      recordKey(parts[0]!, parts[1]!) !== key ||
      !Array.isArray(heads) ||
      !heads.length ||
      heads.length > 64 ||
      !heads.every(h => typeof h === 'string' && HASH.test(h))
    )
      throw new SyncError('同步索引损坏。')
  }
}

/** Stable JSON encoding is part of the public object format. */
export function canonicalJson(value: unknown): string {
  const active = new Set<object>()
  function visit(v: unknown, depth: number): unknown {
    if (depth > 64) throw new SyncError('数据嵌套过深。')
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (!v || typeof v !== 'object' || active.has(v)) throw new SyncError('同步数据必须是无循环的 JSON。')
    active.add(v)
    try {
      if (Array.isArray(v)) return v.map(x => visit(x, depth + 1))
      return Object.fromEntries(
        Object.entries(v)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, x]) => [k, visit(x, depth + 1)]),
      )
    } finally {
      active.delete(v)
    }
  }
  return JSON.stringify(visit(value, 0))
}
