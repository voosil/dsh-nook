import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import type { UpdateCommand, UpdateStatus } from '../../../packages/capability-update/src/index.js'
import type { BrokerLaunch } from './shared-client.js'

export interface UpdateSource {
  repo: string
  remote: string
  branch: string
  current: string
}
export interface Candidate {
  protocol: 1
  commit: string
  snapshot: { seedProfile: string; node: string; supervisor: string }
  broker: string
}
export interface ActiveUpdate {
  protocol: 1
  launch: BrokerLaunch
}
export async function saveJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true, mode: 0o700 })
  const temp = `${path}.${randomUUID()}.tmp`
  await writeFile(temp, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx', flush: true })
  await rename(temp, path)
}
export async function readActiveUpdate(state: string): Promise<ActiveUpdate | undefined> {
  let committed: ActiveUpdate | undefined
  try {
    const recovery = JSON.parse(await readFile(join(state, 'updates/recovery.json'), 'utf8'))
    if (recovery.stage === 'committed') committed = recovery.active
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  try {
    const value = committed ?? (JSON.parse(await readFile(join(state, 'updates/active.json'), 'utf8')) as ActiveUpdate)
    if (value.protocol !== 1 || value.launch.options.state !== state || !value.launch.options.snapshot)
      throw new Error('Unsupported active update')
    return value
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
}

export class Updater {
  private value: UpdateStatus
  private job: Promise<void> | undefined
  private abort = new AbortController()
  private commandInFlight = false
  constructor(
    private state: string,
    private source: UpdateSource | undefined,
    private log: (line: string) => void,
    private switchRuntime: (candidate: Candidate, source: UpdateSource) => Promise<void>,
  ) {
    this.value = {
      phase: source ? 'idle' : 'unavailable',
      current: source?.current ?? '',
      target: null,
      summary: null,
      message: source ? '可检查此设备的应用更新。' : '请从源码运行 pnpm start 以启用更新。',
      task: null,
    }
  }
  get active(): boolean {
    return Boolean(this.job)
  }
  private async publish(patch: Partial<UpdateStatus>) {
    this.value = { ...this.value, ...patch }
    await saveJson(join(this.state, 'updates/status.json'), this.value)
  }
  private run(command: string, args: string[], timeout = 1800000): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32',
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      })
      let output = '',
        cancelled = false,
        force: ReturnType<typeof setTimeout> | undefined
      const consume = (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-32000)
      }
      const signalGroup = (signal: NodeJS.Signals) => {
        if (!child.pid) return
        try {
          process.kill(-child.pid, signal)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') this.log(String(error))
        }
      }
      const stop = () => {
        if (cancelled || child.exitCode !== null || child.signalCode !== null) return
        cancelled = true
        if (process.platform === 'win32') {
          // taskkill /T also owns Corepack and native build subprocesses.
          const killer = spawn(
            join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/taskkill.exe'),
            ['/PID', String(child.pid), '/T', '/F'],
            { windowsHide: true, stdio: 'ignore' },
          )
          killer.once('error', error => {
            this.log(String(error))
            child.kill()
          })
        } else {
          signalGroup('SIGTERM')
          force = setTimeout(() => signalGroup('SIGKILL'), 6000)
        }
      }
      const timer = setTimeout(stop, timeout)
      this.abort.signal.addEventListener('abort', stop, { once: true })
      const cleanup = () => {
        clearTimeout(timer)
        clearTimeout(force)
        this.abort.signal.removeEventListener('abort', stop)
        child.stdout.off('data', consume)
        child.stderr.off('data', consume)
        if (cancelled && process.platform !== 'win32') signalGroup('SIGKILL')
      }
      child.stdout.on('data', consume)
      child.stderr.on('data', consume)
      child.once('error', error => {
        cleanup()
        reject(error)
      })
      child.once('close', code => {
        cleanup()
        if (code === 0 && !cancelled) resolve(output.trim())
        else {
          this.log(output.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1<REDACTED>@'))
          reject(
            new Error(
              cancelled
                ? '更新已中止或超时，旧版本保留。'
                : `更新命令失败（${command}，${code}）；详情见本地后端日志。`,
            ),
          )
        }
      })
      if (this.abort.signal.aborted) stop()
    })
  }
  private startJob(action: () => Promise<void>) {
    this.job = action()
      .catch(async error => {
        this.log(String(error))
        await this.publish({
          phase: 'failed',
          message: error instanceof Error ? error.message : '更新失败，旧版本保留。',
        }).catch(error => this.log(`更新状态无法写入：${String(error)}`))
      })
      .finally(() => {
        this.job = undefined
      })
  }
  async command(command: UpdateCommand): Promise<UpdateStatus> {
    if (command === 'status') return this.execute(command)
    if (this.commandInFlight) throw new Error('已有更新操作正在进行。')
    this.commandInFlight = true
    try {
      return await this.execute(command)
    } finally {
      this.commandInFlight = false
    }
  }
  private async execute(command: UpdateCommand): Promise<UpdateStatus> {
    if (!this.source) {
      try {
        this.source = JSON.parse(await readFile(join(this.state, 'updates/source.json'), 'utf8'))
        this.value.phase = 'idle'
        this.value.current = this.source?.current ?? ''
        this.value.message = '可检查此设备的应用更新。'
      } catch {
        /* Packaged-only and development launches have no source updater. */
      }
    }
    if (command === 'status') return { ...this.value }
    if (!this.source) throw new Error(this.value.message)
    if (this.job) throw new Error('已有更新操作正在进行。')
    const source = this.source
    if (command === 'check') {
      await this.publish({ phase: 'checking', message: '正在检查更新。' })
      this.startJob(async () => {
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(source.remote) || !source.branch || source.branch.startsWith('-'))
          throw new Error('更新来源配置无效。')
        await this.run('git', ['-C', source.repo, 'check-ref-format', `refs/heads/${source.branch}`])
        const ref = `refs/nook-updates/${randomUUID()}`
        await this.run(
          'git',
          ['-C', source.repo, 'fetch', '--no-tags', source.remote, `refs/heads/${source.branch}:${ref}`],
          120000,
        )
        const commit = await this.run('git', ['-C', source.repo, 'rev-parse', '--verify', `${ref}^{commit}`])
        if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('远端提交无效。')
        const summary = await this.run('git', ['-C', source.repo, 'show', '-s', '--format=%s', commit])
        await this.publish({
          phase: commit === this.value.current ? 'idle' : 'available',
          target: commit,
          summary,
          message: commit === this.value.current ? '当前已是最新版本。' : '有新版本可用。',
        })
      })
    } else if (command === 'start') {
      if (!this.value.target || this.value.target === this.value.current) throw new Error('请先检查更新。')
      const task = randomUUID(),
        commit = this.value.target
      const directory = join(this.state, 'runtimes', `update-${task}`)
      await this.publish({ phase: 'preparing', task, message: '正在下载、安装依赖并构建新版本，当前应用继续运行。' })
      this.startJob(async () => {
        await this.run(process.execPath, [
          join(source.repo, 'scripts/update/prepare-update.mjs'),
          JSON.stringify({ repo: source.repo, commit, directory, state: this.state }),
        ])
        const candidate = JSON.parse(await readFile(join(directory, 'candidate.json'), 'utf8')) as Candidate
        if (candidate.protocol !== 1 || candidate.commit !== commit) throw new Error('新版本不支持当前更新协议。')
        await this.publish({ phase: 'switching', message: '正在备份并重启应用，进行中的任务会停止。' })
        await this.switchRuntime(candidate, source)
        this.source = { ...source, current: candidate.commit }
        await this.publish({ phase: 'succeeded', current: candidate.commit, message: '更新完成。' })
      })
    }

    return { ...this.value }
  }
  async dispose() {
    this.abort.abort()
    await this.job
  }
}

export function candidateLaunch(state: string, candidate: Candidate, source: UpdateSource, port: number): BrokerLaunch {
  return {
    node: candidate.snapshot.node,
    broker: candidate.broker,
    options: { state, snapshot: candidate.snapshot, port, update: { ...source, current: candidate.commit } },
  }
}
