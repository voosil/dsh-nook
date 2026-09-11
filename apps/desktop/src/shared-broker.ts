import { taskSnapshot } from './task-connection.js'
import { randomUUID } from 'node:crypto'
import { Updater, candidateLaunch, type Candidate, type UpdateSource } from './update.js'
import { retainHome, recoverHome, commitHome } from './update-backup.js'
import type { RuntimeConfig } from './payload.js'
import { createWriteStream } from 'node:fs'
import { chmod, lstat, mkdir, unlink } from 'node:fs/promises'
import { createServer, type Socket } from 'node:net'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { activateProfile, installPayload } from './payload.js'
import { DesktopRuntime } from './runtime.js'
import { claimRuntime } from './native-lock.js'
import { lineReader, redact } from './policy.js'
import { runtimeSocket } from './shared-paths.js'
import type { BrokerOptions } from './shared-client.js'

async function serve(options: BrokerOptions) {
  const previousMask = process.umask(0o077)
  const { state, seed } = options
  if (!state || (!seed && !options.config && !options.snapshot)) throw new Error('Missing shared runtime configuration')
  await mkdir(join(state, 'logs'), { recursive: true, mode: 0o700 })
  const profile = seed
    ? join(seed, 'payload/home/profiles/nook')
    : (options.snapshot?.seedProfile ?? join(options.config!.home, 'profiles', options.config!.profile))
  const releaseLock = claimRuntime(state, profile)
  if (!releaseLock) return
  const log = createWriteStream(join(state, 'logs', `backend-${Date.now()}-${process.pid}.log`), {
    flags: 'wx',
    mode: 0o600,
  })
  log.on('error', () => {})
  let written = 0
  const sockets = new Set<Socket>()
  const leases = new Set<Socket>()
  let config: RuntimeConfig | undefined
  const updateToken = randomUUID()
  let runtime: DesktopRuntime | undefined
  let url: string | undefined
  let stopping: Promise<void> | undefined
  let starting: Promise<void> | undefined
  const abort = new AbortController()
  let keepAlive = false
  let checkingTasks = false
  const refreshRetention = async () => {
    if (!config || checkingTasks || stopping) return
    checkingTasks = true
    try {
      const tasks = await taskSnapshot(join(config.home, 'task-connection.json'))
      keepAlive = tasks.isOwner && tasks.settings.keepAlive
    } catch {
      /* A transient bridge restart must not drop an established background owner. */
    } finally {
      checkingTasks = false
    }
  }
  const retentionTimer = setInterval(() => {
    void refreshRetention().then(() => {
      if (url && !leases.size && !keepAlive && !switching) void stop()
    })
  }, 5000)

  const path = runtimeSocket(state)
  const send = (socket: Socket, value: object) => {
    if (!socket.destroyed) socket.write(JSON.stringify(value) + '\n')
  }
  const writeLog = (line: string) => {
    const text = redact(line)
    if (written < 5_000_000) {
      log.write(text + '\n')
      written += Buffer.byteLength(text) + 1
    }
    for (const socket of leases) send(socket, { type: 'log', text })
  }
  const backupModule = createRequire(join(profile, 'package.json')).resolve('@nook-dsh/storage-backup')
  const backup = await import(pathToFileURL(backupModule).href)
  let switching = false
  const health = async (address: string) => {
    const response = await fetch(address, { redirect: 'manual', signal: AbortSignal.timeout(10000) })
    if (response.status !== 302 && response.status !== 303) throw new Error('更新后鉴权检查失败。')
    const cookie = response.headers
      .getSetCookie()
      .map(value => value.split(';')[0])
      .join('; ')
    const page = await fetch(new URL('/', address), { headers: { cookie }, signal: AbortSignal.timeout(10000) })
    if (!page.ok) throw new Error('更新后页面检查失败。')
  }
  const switchRuntime = async (candidate: Candidate, source: UpdateSource) => {
    if (!config || !url) throw new Error('后端尚未就绪。')
    switching = true
    const previous = config,
      port = Number(new URL(url).port)
    previous.port = port
    try {
      await runtime!.stop()
      await retainHome(state, backup)
      config = await activateProfile({ state, ...candidate.snapshot })
      config.updateControl = { socket: path, token: updateToken }
      config.updateValidating = true
      config.port = 0
      runtime = new DesktopRuntime(config, writeLog, failure)
      await health(await runtime.ready)
      await runtime.stop()
      config.updateValidating = false
      config.port = port
      runtime = new DesktopRuntime(config, writeLog, failure)
      url = await runtime.ready
      await health(url)
      const launch = candidateLaunch(state, candidate, source, port)
      await commitHome(state, { protocol: 1, launch })
      for (const socket of leases) send(socket, { type: 'ready', url })
    } catch (error) {
      await runtime?.stop()
      await recoverHome(state, backup)
      config = previous
      runtime = new DesktopRuntime(config, writeLog, failure)
      url = await runtime.ready
      for (const socket of leases) send(socket, { type: 'ready', url })
      throw error
    } finally {
      switching = false
    }
  }
  const updater = new Updater(state, options.update, writeLog, switchRuntime)
  const server = createServer(socket => {
    if (stopping) {
      socket.destroy()
      return
    }
    sockets.add(socket)
    const timer = setTimeout(() => socket.destroy(), 2000)
    const reader = lineReader(line => {
      try {
        const value = JSON.parse(line)
        if (
          value.type === 'update' &&
          value.token === updateToken &&
          ['status', 'check', 'start'].includes(value.command)
        ) {
          clearTimeout(timer)
          void updater
            .command(value.command)
            .then(
              status => send(socket, { type: 'update', status }),
              () => send(socket, { error: '更新操作不可用，请稍后重试。' }),
            )
            .finally(() => socket.end())
        } else if (value.type === 'attach' && value.version === 1 && !leases.has(socket)) {
          clearTimeout(timer)
          clearTimeout(unclaimed)
          leases.add(socket)
          if (url) send(socket, { type: 'ready', url })
        } else if (value.type === 'release' && leases.delete(socket)) {
          void (async () => {
            await refreshRetention()
            if (leases.size || (keepAlive && value.stopBackground !== true)) {
              send(socket, { type: 'released' })
              socket.end()
            } else void stop()
          })()
        } else socket.destroy()
      } catch {
        socket.destroy()
      }
    })
    socket.on('data', reader.write)
    socket.on('error', () => socket.destroy())
    socket.once('close', () => {
      clearTimeout(timer)
      socket.off('data', reader.write)
      sockets.delete(socket)
      const held = leases.delete(socket)
      if (held && !leases.size)
        void refreshRetention().then(() => {
          if (!keepAlive && !leases.size) void stop()
        })
    })
  })
  const unclaimed = setTimeout(() => {
    if (!leases.size) void stop()
  }, 15_000)
  const stop = (): Promise<void> =>
    (stopping ??= (async () => {
      clearTimeout(unclaimed)
      clearInterval(retentionTimer)
      abort.abort()
      const closed = new Promise<void>(resolve => server.close(() => resolve()))
      await updater.dispose()
      await runtime?.stop()
      await starting
      await runtime?.stop()
      for (const socket of sockets) {
        send(socket, { type: 'released', finalPid: process.pid })
        socket.end()
      }
      const timer = setTimeout(() => {
        for (const socket of sockets) socket.destroy()
      }, 1000)
      try {
        await closed
      } finally {
        clearTimeout(timer)
      }
      process.off('SIGINT', terminated)
      process.off('SIGTERM', terminated)
      await new Promise<void>(resolve => log.end(resolve))
      releaseLock()
      process.umask(previousMask)
    })())
  const failure = (error: Error) => {
    if (stopping || switching) return
    writeLog(String(error))
    for (const socket of leases) send(socket, { type: 'failure', message: redact(error.message) })
    void stop()
  }
  const terminated = () => {
    void stop()
  }
  process.once('SIGINT', terminated)
  process.once('SIGTERM', terminated)
  server.on('error', failure)
  try {
    // The advisory lock grants exclusive ownership, including stale socket cleanup.
    if (process.platform !== 'win32')
      try {
        const info = await lstat(path)
        if (!info.isSocket() || info.uid !== process.getuid!())
          throw new Error('Refusing a foreign Nook control socket')
        await unlink(path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(path, () => {
        server.off('error', reject)
        resolve()
      })
    })
    if (process.platform !== 'win32') await chmod(path, 0o600)
    starting = (async () => {
      await recoverHome(state, backup)
      config = seed
        ? await installPayload(seed, state, abort.signal)
        : options.snapshot
          ? await activateProfile({ state, ...options.snapshot })
          : options.config!
      if (stopping) return
      const require = createRequire(join(config.home, 'profiles', config.profile, 'package.json'))
      const { resumeMigrations } = await import(
        pathToFileURL(require.resolve('@nook-dsh/storage-backup/migration')).href
      )
      resumeMigrations(join(config.home, 'nook'), join(state, 'backups'))
      if (stopping) return
      config.port = options.port ?? 0
      config.updateControl = { socket: path, token: updateToken }
      runtime = new DesktopRuntime(config, writeLog, failure)
      url = await runtime.ready
      if (!stopping) for (const socket of leases) send(socket, { type: 'ready', url })
    })().catch(error => {
      if (!stopping) failure(error instanceof Error ? error : new Error(String(error)))
    })
  } catch (error) {
    failure(error instanceof Error ? error : new Error(String(error)))
  }
}

await serve(JSON.parse(process.argv[2] ?? '{}') as BrokerOptions)
