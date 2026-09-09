import type { SyncRemote, Method, Request, Value, Result } from '@nook-dsh/adapter-sync-dsh/rpc'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

export type SyncApi = <K extends Method>(method: K, request: Request<K>, signal?: AbortSignal) => Promise<Value<K>>
export function syncApi(remote: SyncRemote): SyncApi {
  return async <K extends Method>(method: K, request: Request<K>, signal?: AbortSignal): Promise<Value<K>> => {
    const call = remote[method] as (r: Request<K>, s?: AbortSignal) => Promise<RemoteResult<Result<Value<K>>>>
    const response = await call(request, signal)
    if (!response.ok) throw new Error(response.error.message)
    if (!response.value.ok) throw new Error(response.value.error.message)
    return response.value.value
  }
}
