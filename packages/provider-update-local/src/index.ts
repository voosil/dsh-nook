import { connect } from 'node:net'
import { Context, Service } from '@deepseek-ai/cordis'
import { unavailable, type UpdateService, type UpdateCommand, type UpdateStatus } from '@nook-dsh/capability-update'
declare module '@deepseek-ai/cordis' {
  interface Context {
    nookUpdate: UpdateService
  }
}
export default class LocalUpdate extends Service implements UpdateService {
  private readonly lifetime = new AbortController()
  constructor(ctx: Context) {
    super(ctx, 'nookUpdate')
    ctx.effect(() => () => this.lifetime.abort())
  }
  async command(command: UpdateCommand, signal: AbortSignal): Promise<UpdateStatus> {
    const path = process.env.NOOK_UPDATE_SOCKET,
      token = process.env.NOOK_UPDATE_TOKEN
    if (!path || !token) return { ...unavailable }
    const combined = AbortSignal.any([signal, this.lifetime.signal])
    combined.throwIfAborted()
    return new Promise((resolve, reject) => {
      const socket = connect(path)
      let buffer = '',
        settled = false
      const finish = (error?: Error, value?: UpdateStatus) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        combined.removeEventListener('abort', aborted)
        socket.destroy()
        if (error) reject(error)
        else resolve(value!)
      }
      const aborted = () => finish(new Error('更新连接已取消。'))
      const timer = setTimeout(() => finish(new Error('更新服务连接超时。')), 10000)
      combined.addEventListener('abort', aborted, { once: true })
      socket.once('error', () => finish(new Error('更新服务不可用。')))
      socket.once('close', () => finish(new Error('更新服务连接已关闭。')))
      socket.once('connect', () => socket.write(JSON.stringify({ type: 'update', token, command }) + '\n'))
      socket.on('data', chunk => {
        buffer += chunk.toString()
        if (buffer.length > 32768) return finish(new Error('更新响应过大。'))
        if (!buffer.includes('\n')) return
        try {
          const value = JSON.parse(buffer.split('\n')[0]!)
          if (value.error) finish(new Error(value.error))
          else if (value.type === 'update' && typeof value.status?.phase === 'string') finish(undefined, value.status)
          else finish(new Error('更新服务响应无效。'))
        } catch {
          finish(new Error('更新服务响应无效。'))
        }
      })
    })
  }
}
