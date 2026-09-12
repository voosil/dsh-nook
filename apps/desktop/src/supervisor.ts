import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchUrl, lineReader, redact, runtimeEnvironment } from './policy.js'
import type { RuntimeConfig } from './payload.js'
import { windowsJob } from './windows-job.js'

async function supervise() {
  const config = JSON.parse(process.argv[2] ?? '{}') as RuntimeConfig
  if (!config.home || !config.bin || !config.profile || !process.send)
    throw new Error('Missing desktop supervisor configuration or parent IPC')
  const env = runtimeEnvironment(config.home, dirname(process.execPath))
  if (config.updateControl) {
    env.NOOK_UPDATE_SOCKET = config.updateControl.socket
    env.NOOK_UPDATE_TOKEN = config.updateControl.token
  } else {
    delete env.NOOK_UPDATE_SOCKET
    delete env.NOOK_UPDATE_TOKEN
  }
  if (config.updateValidating) env.NOOK_UPDATE_VALIDATING = '1'
  else delete env.NOOK_UPDATE_VALIDATING
  let child: ChildProcess | undefined
  let release: ((() => void) & { fd?: number }) | undefined
  let stopping: Promise<void> | undefined
  let ready = false
  let job: ReturnType<typeof windowsJob> | undefined
  const send = (value: object) => {
    if (process.connected) process.send?.(value, undefined, undefined, () => {})
  }
  const stop = (code = 0): Promise<void> =>
    (stopping ??= (async () => {
      if (child?.pid) {
        const pid = child.pid
        const signal = (name: NodeJS.Signals) => {
          if (process.platform === 'win32') {
            if (name === 'SIGTERM' && child?.connected) child.send({ type: 'stop' }, () => {})
            else job?.dispose()
            return
          }
          try {
            process.kill(-pid, name)
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
          }
        }
        const exited = new Promise<void>(resolveExit => {
          if (child!.exitCode !== null || child!.signalCode !== null) resolveExit()
          else child!.once('exit', () => resolveExit())
        })
        signal('SIGTERM')
        const timer = setTimeout(() => signal('SIGKILL'), 5000)
        try {
          await exited
          signal('SIGKILL')
        } finally {
          clearTimeout(timer)
        }
      }
      release?.()
      job?.dispose()
      process.off('disconnect', disconnected)
      process.off('message', message)
      process.off('SIGTERM', terminated)
      process.off('SIGINT', terminated)
      process.exitCode = code
      if (process.connected) process.disconnect()
    })())
  const disconnected = () => {
    void stop()
  }
  const terminated = () => {
    void stop()
  }
  const message = (value: unknown) => {
    if (typeof value === 'object' && value !== null && 'type' in value && value.type === 'stop') void stop()
  }
  process.on('disconnect', disconnected)
  process.on('message', message)
  process.once('SIGTERM', terminated)
  process.once('SIGINT', terminated)
  try {
    const require = createRequire(join(config.home, 'profiles', config.profile, 'package.json'))
    const backup = await import(pathToFileURL(require.resolve('@nook-dsh/storage-backup')).href)
    if (stopping || !process.connected) return
    const data = join(config.home, 'nook')
    release = backup.acquireDataLock(data)
    if (existsSync(data)) {
      backup.createBackup(data, join(config.home, '..', 'backups'), 'before-desktop-start')
      send({ type: 'log', text: 'Verified Nook data backup before startup.' })
    }
    if (!process.connected) {
      await stop()
      return
    }
    if (process.platform === 'win32') job = windowsJob(join(config.home, 'profiles', config.profile))
    child = spawn(
      process.execPath,
      [
        ...(process.platform === 'win32' ? ['--import', new URL('./windows-shutdown.mjs', import.meta.url).href] : []),
        config.bin,
        '--profile',
        config.profile,
        '--no-open',
        '--host',
        '127.0.0.1',
        '--port',
        String(config.port ?? 0),
      ],
      {
        cwd: config.cwd,
        env,
        detached: true,
        windowsHide: true,
        // POSIX flock follows the inherited open file description, keeping
        // backups excluded while an orphaned Host still uses this data.
        stdio:
          process.platform === 'win32'
            ? ['ignore', 'pipe', 'pipe', 'ipc']
            : ['ignore', 'pipe', 'pipe', ...(release?.fd === undefined ? [] : [release.fd])],
      },
    )
    if (child.pid && job) {
      try {
        job.assign(child.pid)
        child.send({ type: 'start' }, () => {})
      } catch (error) {
        child.kill('SIGKILL')
        throw error
      }
    }
    send({ type: 'pid', pid: child.pid })
    const consume = (line: string) => {
      const url = launchUrl(line)
      if (url && !ready && !stopping) {
        ready = true
        send({ type: 'ready', url })
      }
      send({ type: 'log', text: redact(line) })
    }
    for (const stream of [child.stdout, child.stderr]) {
      const reader = lineReader(consume)
      stream!.on('data', reader.write)
      stream!.once('end', () => {
        stream!.off('data', reader.write)
        reader.end()
      })
    }
    child.once('error', error => {
      send({ type: 'failure', message: redact(error.message) })
      void stop(1)
    })
    child.once('exit', (code, signal) => {
      if (!stopping) {
        send({ type: 'failure', message: `DSH exited (${code ?? signal})` })
        void stop(1)
      }
    })
  } catch (error) {
    send({ type: 'failure', message: redact(String(error)) })
    await stop(1)
  }
}

await supervise()
