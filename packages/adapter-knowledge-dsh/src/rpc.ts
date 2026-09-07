import { z } from 'zod'
import type { InvocationDescriptor, RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
const selection = z.strictObject({ enabled: z.boolean(), projectId: z.uuid().nullable() })
export const requests = {
  knowledgeSession: z.strictObject({ sessionId: z.string().min(1).max(300) }),
  setKnowledgeSession: selection.extend({ sessionId: z.string().min(1).max(300) }),
  projects: z.strictObject({}),
}
const outputs = {
  knowledgeSession: selection,
  setKnowledgeSession: selection,
  projects: z.array(z.strictObject({ id: z.uuid(), name: z.string() })),
}
export type Method = keyof typeof requests
export type Request<K extends Method> = z.input<(typeof requests)[K]>
export type Value<K extends Method> = z.output<(typeof outputs)[K]>
export type KnowledgeRemote = {
  [K in Method]: (request: Request<K>, signal?: AbortSignal) => Promise<RemoteResult<Value<K>>>
}
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    nookKnowledgeRpc: KnowledgeRemote
  }
}
export const RPC_PACKAGE = '@nook-dsh/adapter-knowledge-dsh'
export const descriptors: readonly InvocationDescriptor[] = (Object.keys(requests) as Method[]).map(method => ({
  id: `${RPC_PACKAGE}#${method}`,
  service: 'nookKnowledgeRpc',
  namespace: 'nookKnowledgeRpc',
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
  result: { mode: 'strict', typeSymbol: `${RPC_PACKAGE}#${method}Result`, schema: outputs[method] },
}))
