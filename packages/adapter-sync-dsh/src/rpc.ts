import { z } from 'zod'
import type { InvocationDescriptor, RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SyncStatus, SyncConflict } from '@nook-dsh/capability-sync'
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const status = z.strictObject({
  enabled: z.boolean(),
  state: z.enum(['disabled', 'idle', 'syncing', 'error']),
  url: z.string(),
  username: z.string(),
  hasPassword: z.boolean(),
  caCert: z.string(),
  lastSync: z.string().nullable(),
  error: z.string().nullable(),
  pending: z.int().nonnegative(),
  conflicts: z.int().nonnegative(),
  unsupported: z.int().nonnegative(),
  change: z.int().nonnegative(),
})
const json: z.ZodType<import('@nook-dsh/capability-sync').Json> = z.lazy(() =>
  z.union([z.null(), z.boolean(), z.number().finite(), z.string(), z.array(json), z.record(z.string(), json)]),
)
const version = z.strictObject({
  format: z.literal(1),
  type: z.string(),
  id: z.string(),
  schema: z.int().positive(),
  parents: z.array(hash),
  deleted: z.boolean(),
  data: json,
  blobs: z.array(z.strictObject({ hash, bytes: z.int().nonnegative(), mediaType: z.string() })),
})
const conflict = z.strictObject({
  key: z.string(),
  type: z.string(),
  id: z.string(),
  versions: z.array(z.strictObject({ hash, value: version })),
})
export const requests = {
  status: z.strictObject({}),
  configure: z.strictObject({
    enabled: z.boolean(),
    url: z.string().max(2000),
    username: z.string().max(500),
    password: z.string().max(2000).optional(),
    caCert: z.string().max(16000).optional(),
  }),
  run: z.strictObject({}),
  conflicts: z.strictObject({}),
  resolve: z.strictObject({
    key: z.string().max(200),
    expected: z.array(hash).min(2).max(64),
    selected: hash,
    copy: z.boolean(),
  }),
}
const outputs = { status, configure: status, run: status, conflicts: z.array(conflict), resolve: status }
export type Method = keyof typeof requests
export type Request<K extends Method> = z.input<(typeof requests)[K]>
export type Value<K extends Method> = K extends 'conflicts' ? readonly SyncConflict[] : SyncStatus
export type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
export type SyncRemote = {
  [K in Method]: (request: Request<K>, signal?: AbortSignal) => Promise<RemoteResult<Result<Value<K>>>>
}
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    nookSyncRpc: SyncRemote
  }
}
export const RPC_PACKAGE = '@nook-dsh/adapter-sync-dsh'
export const descriptors: readonly InvocationDescriptor[] = (Object.keys(requests) as Method[]).map(method => ({
  id: `${RPC_PACKAGE}#${method}`,
  service: 'nookSyncRpc',
  namespace: 'nookSyncRpc',
  method,
  invocation: { kind: 'direct' },
  parameters: [
    {
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: { mode: 'strict', typeSymbol: `${RPC_PACKAGE}#${method}Request`, schema: requests[method] },
    },
  ],
  cancellation: { parameter: 'signal' },
  result: {
    mode: 'strict',
    typeSymbol: `${RPC_PACKAGE}#${method}Result`,
    schema: z.discriminatedUnion('ok', [
      z.strictObject({ ok: z.literal(true), value: outputs[method] }),
      z.strictObject({ ok: z.literal(false), error: z.strictObject({ code: z.string(), message: z.string() }) }),
    ]),
  },
}))
