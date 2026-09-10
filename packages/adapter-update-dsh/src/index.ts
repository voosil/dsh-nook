import { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-typert-registry'
import type { UpdateService, UpdateStatus } from '@nook-dsh/capability-update'
import { descriptors, RPC_PACKAGE, type Request, type Result } from './rpc.js'
declare module '@deepseek-ai/cordis' {
  interface Context {
    nookUpdate: UpdateService
  }
}
export default class UpdateRpc extends TypertRemoteService {
  static inject = ['typert', 'nookUpdate']
  constructor(ctx: Context) {
    super(ctx, 'nookUpdateRpc')
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
  private async call(command: 'status' | 'check' | 'start', signal: AbortSignal): Promise<Result<UpdateStatus>> {
    try {
      return { ok: true, value: await this.ctx.nookUpdate.command(command, signal) }
    } catch (error) {
      return {
        ok: false,
        error: { code: 'UPDATE_ERROR', message: error instanceof Error ? error.message : '更新操作失败。' },
      }
    }
  }
  status(_r: Request<'status'>, signal: AbortSignal) {
    return this.call('status', signal)
  }
  check(_r: Request<'check'>, signal: AbortSignal) {
    return this.call('check', signal)
  }
  start(_r: Request<'start'>, signal: AbortSignal) {
    return this.call('start', signal)
  }
}
