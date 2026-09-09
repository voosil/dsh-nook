import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  SyncError,
  type SyncReplica,
  type SyncStorageFactory,
  type SyncService,
  type SyncStatus,
  type ConfigureSync,
  type StorageConfig,
} from '@nook-dsh/capability-sync'
import { synchronize } from './engine.js'
import { durableRename, syncPath } from '@nook-dsh/storage-backup/durability'

declare module '@deepseek-ai/cordis' {
  interface Context {
    nookSync: SyncService
    nookSyncReplica: SyncReplica
    nookSyncStorage: SyncStorageFactory
  }
}
export interface Config {
  readonly file: string
}
export const Config: z<Config> = z.object({ file: z.string().required() })
interface Settings extends StorageConfig {
  enabled: boolean
}
export default class SyncFeature extends Service implements SyncService {
  static inject = ['nookSyncReplica', 'nookSyncStorage']
  static Config = Config
  private settings: Settings = { enabled: false, url: '', username: '', password: '' }
  private state: SyncStatus['state'] = 'disabled'
  private error: string | null = null
  private lastSync: string | null = null
  private running: Promise<SyncStatus> | undefined
  private controller: AbortController | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = false
  private configuring = false
  private configurationController: AbortController | undefined
  private configurationTask: Promise<SyncStatus> | undefined
  private failures = 0
  constructor(
    ctx: Context,
    private readonly config: Config,
  ) {
    super(ctx, 'nookSync')
    if (existsSync(config.file)) {
      const s = JSON.parse(readFileSync(config.file, 'utf8')) as Settings
      if (!s || typeof s.enabled !== 'boolean' || ![s.url, s.username, s.password].every(x => typeof x === 'string'))
        throw new SyncError('同步配置文件损坏。')
      this.settings = s
    }
    this.state = this.settings.enabled ? 'idle' : 'disabled'
    ctx.effect(() => {
      const unsubscribe = ctx.nookSyncReplica.subscribe(() => {
        if (!this.running) this.schedule(1000)
      })
      this.schedule(0)
      return async () => {
        this.stopped = true
        clearTimeout(this.timer)
        unsubscribe()
        this.controller?.abort()
        this.configurationController?.abort()
        await this.configurationTask?.catch(() => {})
        await this.running
      }
    })
  }
  status(): SyncStatus {
    return {
      ...this.ctx.nookSyncReplica.stats(),
      enabled: this.settings.enabled,
      state: this.state,
      url: this.settings.url,
      username: this.settings.username,
      hasPassword: !!this.settings.password,
      caCert: this.settings.caCert ?? '',
      lastSync: this.lastSync,
      error: this.error,
    }
  }
  private schedule(delay: number) {
    clearTimeout(this.timer)
    if (!this.stopped && !this.configuring && this.settings.enabled)
      this.timer = setTimeout(() => {
        void this.run()
      }, delay)
  }
  configure(input: ConfigureSync, signal: AbortSignal): Promise<SyncStatus> {
    if (this.stopped || this.configurationTask) return Promise.reject(new SyncError('同步配置暂不可用，请稍后重试。'))
    const controller = new AbortController()
    this.configurationController = controller
    const abort = () => controller.abort(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    this.configurationTask = this.applySettings(input, controller.signal).finally(() => {
      signal.removeEventListener('abort', abort)
      this.configurationController = undefined
      this.configurationTask = undefined
    })
    return this.configurationTask
  }
  private async applySettings(input: ConfigureSync, signal: AbortSignal): Promise<SyncStatus> {
    if (this.configuring) throw new SyncError('同步配置正在更新，请稍后重试。')
    this.configuring = true
    clearTimeout(this.timer)
    this.controller?.abort()
    await this.running
    try {
      signal.throwIfAborted()
      if (!input.enabled) {
        this.persist({ ...this.settings, enabled: false })
        this.state = 'disabled'
        this.error = null
        return this.status()
      }
      let url: URL
      try {
        url = new URL(input.url)
      } catch {
        throw new SyncError('请输入完整的 WebDAV 地址。')
      }
      url.pathname = url.pathname.replace(/\/+$/, '') + '/'
      const settings: Settings = {
        enabled: true,
        url: url.href,
        username: input.username,
        password: input.password ?? this.settings.password,
        caCert: input.caCert ?? this.settings.caCert ?? '',
      }
      if (settings.username.length > 500 || settings.password.length > 2000) throw new SyncError('存储凭据过长。')
      const binding = this.ctx.nookSyncReplica.binding()
      if (binding && binding.target !== settings.url)
        throw new SyncError('此数据已绑定另一目录。请使用独立本地库连接其他目标。')
      const remote = this.ctx.nookSyncStorage.open(settings)
      this.ctx.nookSyncReplica.prepare()
      await remote.probe(signal)
      signal.throwIfAborted()
      this.persist(settings)
      this.state = 'idle'
      this.error = null
      this.failures = 0
      return this.status()
    } finally {
      this.configuring = false
      this.schedule(0)
    }
  }
  private persist(settings: Settings) {
    mkdirSync(dirname(this.config.file), { recursive: true, mode: 0o700 })
    const temp = `${this.config.file}.${randomUUID()}.tmp`
    writeFileSync(temp, JSON.stringify(settings), { mode: 0o600, flag: 'wx' })
    syncPath(temp)
    durableRename(temp, this.config.file, true)
    chmodSync(this.config.file, 0o600)
    syncPath(dirname(this.config.file))
    this.settings = settings
  }
  run(): Promise<SyncStatus> {
    if (this.running) return this.running
    if (this.stopped || this.configuring || !this.settings.enabled) return Promise.resolve(this.status())
    clearTimeout(this.timer)
    this.controller = new AbortController()
    const controller = this.controller
    this.state = 'syncing'
    this.error = null
    this.running = (async () => {
      try {
        await synchronize(
          this.ctx.nookSyncReplica,
          this.ctx.nookSyncStorage.open(this.settings),
          this.settings.url,
          controller.signal,
        )
        this.lastSync = new Date().toISOString()
        this.state = 'idle'
        this.failures = 0
      } catch (error) {
        if (!controller.signal.aborted) {
          this.error = error instanceof SyncError ? error.message : '同步未完成，本地数据已保留。'
          this.state = 'error'
          this.failures++
        } else this.state = this.settings.enabled ? 'idle' : 'disabled'
      } finally {
        this.running = undefined
        this.controller = undefined
        this.schedule(
          this.failures
            ? Math.min(300000, 2000 * 2 ** Math.min(this.failures, 7)) * (0.8 + Math.random() * 0.4)
            : 30000,
        )
      }
      return this.status()
    })()
    return this.running
  }
  conflicts() {
    return this.ctx.nookSyncReplica.conflicts()
  }
  async resolve(key: string, expected: readonly string[], selected: string, copy: boolean) {
    this.ctx.nookSyncReplica.resolve(key, expected, selected, copy)
    return this.run()
  }
}
