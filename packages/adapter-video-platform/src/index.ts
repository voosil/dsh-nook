import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { VideoError, type VideoSourceService, type VideoMaterial } from '@nook-dsh/capability-video'

declare module '@deepseek-ai/cordis' {
  interface Context {
    nookVideoSource: VideoSourceService
  }
}
export interface Config {
  readonly root: string
  readonly python: string
}
export const Config: z<Config> = z.object({ root: z.string().required(), python: z.string().default('python3') })

export default class VideoPlatformAdapter extends Service implements VideoSourceService {
  static Config = Config
  private readonly operations = new Set<AbortController>()
  constructor(
    ctx: Context,
    private readonly config: Config,
  ) {
    super(ctx, 'nookVideoSource')
    ctx.effect(() => () => {
      for (const controller of this.operations) controller.abort()
      this.operations.clear()
    })
  }
  async collect(url: string, notes: boolean, signal: AbortSignal): Promise<VideoMaterial> {
    signal.throwIfAborted()
    const controller = new AbortController()
    this.operations.add(controller)
    const combined = AbortSignal.any([signal, controller.signal])
    try {
      return await new Promise<VideoMaterial>((resolvePromise, reject) => {
        const child = spawn(this.config.python, [fileURLToPath(new URL('../python/collect.py', import.meta.url))], {
          env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' },
          stdio: ['pipe', 'pipe', 'pipe'],
        })
        let output = ''
        let killTimer: ReturnType<typeof setTimeout> | undefined
        const kill = () => {
          child.kill('SIGTERM')
          killTimer = setTimeout(() => child.kill('SIGKILL'), 2000)
          killTimer.unref()
        }
        const timeout = setTimeout(() => {
          controller.abort()
        }, 15 * 60_000)
        timeout.unref()
        combined.addEventListener('abort', kill, { once: true })
        child.stdout.setEncoding('utf8')
        child.stderr.setEncoding('utf8')
        child.stdout.on('data', (chunk: string) => {
          output += chunk
          if (output.length > 20_000_000) controller.abort()
        })
        child.stderr.on('data', () => {
          /* Consume diagnostics without exposing cookies or downloaded source. */
        })
        const cleanup = () => {
          clearTimeout(timeout)
          clearTimeout(killTimer)
          combined.removeEventListener('abort', kill)
        }
        child.once('error', () => {
          cleanup()
          reject(new VideoError('无法启动 Python 采集器，请检查插件 python 配置。'))
        })
        child.once('close', code => {
          cleanup()
          if (combined.aborted) {
            reject(new VideoError('视频采集已取消或超时，可重试并复用已保存资料。'))
            return
          }
          if (code !== 0) {
            reject(new VideoError('视频采集器异常退出，请检查 Python 环境。'))
            return
          }
          try {
            const result = JSON.parse(output) as { ok: boolean; error?: string; value?: VideoMaterial }
            if (!result.ok || !result.value) throw new VideoError(result.error || '视频采集失败。')
            const material = result.value
            if (
              typeof material.title !== 'string' ||
              typeof material.transcript !== 'string' ||
              typeof material.url !== 'string' ||
              typeof material.author !== 'string' ||
              !Array.isArray(material.candidates) ||
              !Array.isArray(material.warnings) ||
              !material.warnings.every(item => typeof item === 'string') ||
              !material.candidates.every(
                item =>
                  typeof item.id === 'string' &&
                  typeof item.markdown === 'string' &&
                  typeof item.text === 'string' &&
                  typeof item.author === 'string' &&
                  typeof item.likes === 'number' &&
                  typeof item.complete === 'boolean',
              )
            )
              throw new VideoError('采集器返回了无效资料。')
            resolvePromise(material)
          } catch (error) {
            reject(error instanceof VideoError ? error : new VideoError('采集器返回了无效 JSON。'))
          }
        })
        child.stdin.on('error', () => {})
        child.stdin.end(JSON.stringify({ root: resolve(this.config.root), url, notes }))
        if (combined.aborted) kill()
      })
    } finally {
      this.operations.delete(controller)
    }
  }
}
