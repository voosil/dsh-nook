import type { UpdateRemote, Method, Request, Value, Result } from '@nook-dsh/adapter-update-dsh/rpc'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

export type UpdateApi = <K extends Method>(method: K, request: Request<K>, signal?: AbortSignal) => Promise<Value<K>>
export function updateApi(remote: UpdateRemote): UpdateApi {
  return async <K extends Method>(method: K, request: Request<K>, signal?: AbortSignal): Promise<Value<K>> => {
    const call = remote[method] as (r: Request<K>, s?: AbortSignal) => Promise<RemoteResult<Result<Value<K>>>>
    const response = await call(request, signal)
    if (!response.ok) throw new Error(response.error.message)
    if (!response.value.ok) throw new Error(response.value.error.message)
    return response.value.value
  }
}
