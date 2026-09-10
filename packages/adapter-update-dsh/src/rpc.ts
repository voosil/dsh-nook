import { z } from 'zod'
import type { InvocationDescriptor, RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { UpdateStatus } from '@nook-dsh/capability-update'
const status = z.strictObject({
  phase: z.enum(['unavailable', 'idle', 'checking', 'available', 'preparing', 'switching', 'succeeded', 'failed']),
  current: z.string(),
  target: z.string().nullable(),
  summary: z.string().nullable(),
  message: z.string(),
  task: z.string().nullable(),
})
export const requests = {
  status: z.strictObject({}),
  check: z.strictObject({}),
  start: z.strictObject({}),
}
const outputs = { status, check: status, start: status }
export type Method = keyof typeof requests
export type Request<K extends Method> = z.input<(typeof requests)[K]>
export type Value<K extends Method> = UpdateStatus
export type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
export type UpdateRemote = {
  [K in Method]: (request: Request<K>, signal?: AbortSignal) => Promise<RemoteResult<Result<UpdateStatus>>>
}
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    nookUpdateRpc: UpdateRemote
  }
}
export const RPC_PACKAGE = '@nook-dsh/adapter-update-dsh'
export const descriptors: readonly InvocationDescriptor[] = (Object.keys(requests) as Method[]).map(method => ({
  id: `${RPC_PACKAGE}#${method}`,
  service: 'nookUpdateRpc',
  namespace: 'nookUpdateRpc',
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
