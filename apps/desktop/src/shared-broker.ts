import { createWriteStream } from 'node:fs'
import { chmod, lstat, mkdir, unlink } from 'node:fs/promises'
import { createServer, type Socket } from 'node:net'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { installPayload } from './payload.js'
import { DesktopRuntime } from './runtime.js'
import { claimRuntime } from './native-lock.js'
import { lineReader, redact } from './policy.js'
import { runtimeSocket } from './shared-paths.js'
import type { BrokerOptions } from './shared-client.js'

async function serve(options: BrokerOptions) {
  const previousMask = process.umask(0o077)
  const { state, seed } = options
  if (!state || (!seed && !options.config)) throw new Error('Missing shared runtime configuration')
  await mkdir(join(state, 'logs'), { recursive: true, mode: 0o700 })
  const profile = seed
    ? join(seed, 'payload/home/profiles/nook')
    : join(options.config!.home, 'profiles', options.config!.profile)
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
  let runtime: DesktopRuntime | undefined
  let url: string | undefined
  let stopping: Promise<void> | undefined
  let starting: Promise<void> | undefined
  const abort = new AbortController()
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
        if (value.type === 'attach' && value.version === 1 && !leases.has(socket)) {
          clearTimeout(timer)
          clearTimeout(unclaimed)
          leases.add(socket)
          if (url) send(socket, { type: 'ready', url })
        } else if (value.type === 'release' && leases.delete(socket)) {
          if (leases.size) {
            send(socket, { type: 'released' })
            socket.end()
          } else void stop()
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
      if (held && !leases.size) void stop()
    })
  })
  const unclaimed = setTimeout(() => {
    if (!leases.size) void stop()
  }, 15_000)
  const stop = (): Promise<void> =>
    (stopping ??= (async () => {
      clearTimeout(unclaimed)
      abort.abort()
      const closed = new Promise<void>(resolve => server.close(() => resolve()))
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
    if (stopping) return
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
    try {
      const info = await lstat(path)
      if (!info.isSocket() || info.uid !== process.getuid!()) throw new Error('Refusing a foreign Nook control socket')
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
    await chmod(path, 0o600)
    starting = (async () => {
      const config = seed ? await installPayload(seed, state, abort.signal) : options.config!
      if (stopping) return
      const require = createRequire(join(config.home, 'profiles', config.profile, 'package.json'))
      const { resumeMigrations } = await import(
        pathToFileURL(require.resolve('@nook-dsh/storage-backup/migration')).href
      )
      resumeMigrations(join(config.home, 'nook'), join(state, 'backups'))
      if (stopping) return
      config.port = options.port ?? 0
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
