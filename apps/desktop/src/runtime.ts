import { spawn, type ChildProcess } from 'node:child_process'
import { dirname } from 'node:path'
import type { RuntimeConfig } from './payload.js'
import { launchUrl, lineReader, redact, runtimeEnvironment } from './policy.js'

/** The supervisor owns DSH's process group and observes parent IPC disconnect. */
export class DesktopRuntime {
  private child: ChildProcess
  private stopped = false
  private stopping: Promise<void> | undefined
  private dshPid: number | undefined
  private closed: Promise<void>
  readonly ready: Promise<string>

  constructor(config: RuntimeConfig, log: (text: string) => void, failed: (error: Error) => void, timeoutMs = 60_000) {
    this.child = spawn(config.node, [config.supervisor, JSON.stringify(config)], {
      cwd: config.cwd,
      env: runtimeEnvironment(config.home, dirname(config.node)),
      detached: true,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    })
    const child = this.child
    this.closed = new Promise(resolveClosed => {
      child.once('exit', () => resolveClosed())
      child.once('error', () => resolveClosed())
    })
    this.ready = new Promise((resolveReady, rejectReady) => {
      const timer = setTimeout(() => rejectReady(new Error('DSH startup timed out')), timeoutMs)
      const reject = (error: Error) => {
        clearTimeout(timer)
        rejectReady(error)
        if (!this.stopped) failed(error)
      }
      const message = (value: unknown) => {
        if (!value || typeof value !== 'object' || !('type' in value)) return
        if (value.type === 'ready' && 'url' in value && typeof value.url === 'string') {
          const url = launchUrl(`dsh web: ${value.url}`)
          if (!url) {
            reject(new Error('Invalid DSH authentication URL'))
            return
          }
          clearTimeout(timer)
          resolveReady(url)
        } else if (value.type === 'log' && 'text' in value && typeof value.text === 'string') log(redact(value.text))
        else if (value.type === 'failure' && 'message' in value && typeof value.message === 'string')
          reject(new Error(redact(value.message)))
        else if (value.type === 'pid' && 'pid' in value && Number.isSafeInteger(value.pid) && Number(value.pid) > 1)
          this.dshPid = Number(value.pid)
      }
      child.on('message', message)
      child.once('error', reject)
      child.once('exit', (code, signal) => {
        child.off('message', message)
        reject(new Error(`Runtime stopped (${code ?? signal})`))
      })
      const stderr = lineReader(line => log(redact(line)))
      child.stderr!.on('data', stderr.write)
      void this.closed.then(() => {
        child.stderr!.off('data', stderr.write)
        stderr.end()
        clearTimeout(timer)
      })
    })
    // Shutdown during installation/startup must not leave an unhandled rejection.
    void this.ready.catch(() => {})
  }

  stop(): Promise<void> {
    this.stopped = true
    return (this.stopping ??= (async () => {
      if (this.child.connected) this.child.send({ type: 'stop' }, () => {})
      const timer = setTimeout(() => {
        for (const pid of [this.dshPid, this.child.pid])
          if (pid) {
            try {
              process.kill(process.platform === 'win32' ? pid : -pid, 'SIGKILL')
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
            }
          }
      }, 8000)
      try {
        await this.closed
      } finally {
        clearTimeout(timer)
      }
    })())
  }
}
