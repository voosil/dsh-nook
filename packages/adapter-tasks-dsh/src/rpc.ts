import { z } from 'zod'
import type { InvocationDescriptor, RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { snapshotSchema, requestSchema, receiptSchema, settingsSchema } from '@nook-dsh/capability-task'
export const requests = {
  sources: z.strictObject({}),
  snapshot: z.strictObject({}),
  submit: requestSchema,
  configure: settingsSchema,
  refine: z.strictObject({}),
  models: z.strictObject({}),
}
const outputs = {
  sources: z.strictObject({
    notes: z.array(z.strictObject({ id: z.string(), title: z.string() })),
    projects: z.array(z.strictObject({ id: z.string(), name: z.string() })),
  }),
  snapshot: snapshotSchema,
  submit: receiptSchema,
  configure: receiptSchema,
  refine: z.boolean(),
  models: z.array(z.strictObject({ provider: z.string(), id: z.string(), name: z.string() })),
}
export type Method = keyof typeof requests
export type Request<K extends Method> = z.input<(typeof requests)[K]>
export type Value<K extends Method> = z.output<(typeof outputs)[K]>
export type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
export type TaskRemote = {
  [K in Method]: (request: Request<K>, signal?: AbortSignal) => Promise<RemoteResult<Result<Value<K>>>>
}
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    nookTasksRpc: TaskRemote
  }
}
export const RPC_PACKAGE = '@nook-dsh/adapter-tasks-dsh'
export const descriptors: readonly InvocationDescriptor[] = (Object.keys(requests) as Method[]).map(method => ({
  id: `${RPC_PACKAGE}#${method}`,
  service: 'nookTasksRpc',
  namespace: 'nookTasksRpc',
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
