import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { open, lstat, mkdir, realpath } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  SyncError,
  parseSyncConnection,
  CONNECTION_FILE_LIMIT,
  type SyncReplica,
  type SyncStorageFactory,
  type SyncService,
  type SyncStatus,
  type ConfigureSync,
  type StorageConfig,
  type SyncStorage,
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
  private localMerge: Promise<void> | undefined
  private readonly mergeController = new AbortController()
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
      this.localMerge = ctx.nookSyncReplica.reconcile(this.mergeController.signal).catch(error => {
        if (!this.stopped) this.error = error instanceof SyncError ? error.message : '自动合并未完成，原始版本已保留。'
      })
      this.schedule(0)
      return async () => {
        this.stopped = true
        clearTimeout(this.timer)
        unsubscribe()
        this.mergeController.abort()
        await this.localMerge
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
  async prepareDeployment(): Promise<{ directory: string }> {
    const directory = resolve(dirname(this.config.file), 'sync-deployment')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new SyncError('部署工作目录不可用。')
    return { directory: await realpath(directory) }
  }
  async importConnection(file: string, expectedUrl: string, signal: AbortSignal): Promise<SyncStatus> {
    signal.throwIfAborted()
    if (!isAbsolute(file)) throw new SyncError('请提供连接文件的绝对路径。')
    let config
    try {
      const info = await lstat(file)
      if (!info.isFile() || info.isSymbolicLink() || info.size > CONNECTION_FILE_LIMIT) throw new Error()
      const handle = await open(file, 'r')
      try {
        const opened = await handle.stat()
        if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino) throw new Error()
        const buffer = Buffer.alloc(CONNECTION_FILE_LIMIT + 1)
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
        if (bytesRead > CONNECTION_FILE_LIMIT) throw new Error()
        config = parseSyncConnection(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead)))
      } finally {
        await handle.close()
      }
    } catch {
      throw new SyncError('无法读取有效连接文件：请检查路径、读取权限、文件格式和 32 KB 大小限制。')
    }
    const normalize = (value: string) => {
      try {
        const url = new URL(value)
        url.pathname = url.pathname.replace(/\/+$/, '') + '/'
        return url.href
      } catch {
        throw new SyncError('请提供预期的完整同步地址。')
      }
    }
    if (normalize(config.url) !== normalize(expectedUrl))
      throw new SyncError('连接文件地址与预期服务器不一致；未连接或修改设置。')
    signal.throwIfAborted()
    return this.configure({ ...config, enabled: true }, signal)
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
      try {
        this.ctx.nookSyncReplica.prepare()
        await remote.probe(signal)
      } finally {
        remote.dispose?.()
      }
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
    if (process.env.NOOK_UPDATE_VALIDATING === '1' || this.stopped || this.configuring || !this.settings.enabled)
      return Promise.resolve(this.status())
    clearTimeout(this.timer)
    this.controller = new AbortController()
    const controller = this.controller
    this.state = 'syncing'
    this.error = null
    this.running = (async () => {
      let remote: SyncStorage | undefined
      try {
        remote = this.ctx.nookSyncStorage.open(this.settings)
        await synchronize(this.ctx.nookSyncReplica, remote, this.settings.url, controller.signal)
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
        remote?.dispose?.()
        this.running = undefined
        this.controller = undefined
        this.schedule(
          this.failures
            ? Math.min(300000, 2000 * 2 ** Math.min(this.failures, 7)) * (0.8 + Math.random() * 0.4)
            : this.ctx.nookSyncReplica.stats().pending
              ? 1000
              : 5000,
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
