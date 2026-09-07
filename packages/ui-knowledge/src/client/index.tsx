import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import { descriptors, RPC_PACKAGE, type Request, type Value, type Method } from '@nook-dsh/adapter-knowledge-dsh/rpc'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { KnowledgeToggle } from './toggle.js'
export type Api = <K extends Method>(method: K, request: Request<K>, signal?: AbortSignal) => Promise<Value<K>>
export const inject = ['remote', 'slots']
export async function apply(ctx: ClientContext): Promise<void> {
  await ctx.remote.$mount({ package: RPC_PACKAGE, descriptors })
  ctx.inject(['remote.nookKnowledgeRpc', 'slots'], ctx => {
    const remote = ctx.remote.nookKnowledgeRpc
    const api: Api = async <K extends Method>(method: K, request: Request<K>, signal?: AbortSignal) => {
      const call = remote[method] as (request: Request<K>, signal?: AbortSignal) => Promise<RemoteResult<Value<K>>>
      const result = await call(request, signal)
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    }
    ctx.slots.inject('conversation.session.header.actions', () =>
      ctx.slots.register(
        { name: 'conversation.session.header.actions', id: 'nook-knowledge-toggle', order: 10 },
        props => <KnowledgeToggle {...props} api={api} />,
      ),
    )
  })
}
