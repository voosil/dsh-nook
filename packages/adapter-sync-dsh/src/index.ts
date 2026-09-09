import { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-typert-registry'
import type {} from '@nook-dsh/feature-sync'
import { SyncError } from '@nook-dsh/capability-sync'
import { descriptors, RPC_PACKAGE, type Request, type Result } from './rpc.js'
async function result<T>(signal: AbortSignal, fn: () => T | Promise<T>): Promise<Result<T>> {
  try {
    signal.throwIfAborted()
    return { ok: true, value: await fn() }
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'SYNC_ERROR',
        message: error instanceof SyncError ? error.message : '同步操作未完成，本地数据已保留。',
      },
    }
  }
}
export default class SyncRpc extends TypertRemoteService {
  static inject = ['typert', 'nookSync']
  constructor(ctx: Context) {
    super(ctx, 'nookSyncRpc')
    ctx.effect(() =>
      ctx.typert.register({
        package: RPC_PACKAGE,
        face: 'host',
        schemas: [],
        model: { services: [], events: [], objects: [] },
        invocations: descriptors,
      }),
    )
  }
  status(_request: Request<'status'>, signal: AbortSignal) {
    return result(signal, () => this.ctx.nookSync.status())
  }
  configure(request: Request<'configure'>, signal: AbortSignal) {
    return result(signal, () =>
      this.ctx.nookSync.configure(
        {
          enabled: request.enabled,
          url: request.url,
          username: request.username,
          ...(request.password !== undefined ? { password: request.password } : {}),
          ...(request.caCert !== undefined ? { caCert: request.caCert } : {}),
        },
        signal,
      ),
    )
  }
  run(_request: Request<'run'>, signal: AbortSignal) {
    return result(signal, () => this.ctx.nookSync.run())
  }
  conflicts(_request: Request<'conflicts'>, signal: AbortSignal) {
    return result(signal, () => this.ctx.nookSync.conflicts())
  }
  resolve(request: Request<'resolve'>, signal: AbortSignal) {
    return result(signal, () =>
      this.ctx.nookSync.resolve(request.key, request.expected, request.selected, request.copy),
    )
  }
}
