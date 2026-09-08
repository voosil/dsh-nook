import { spawn } from 'node:child_process'
import { connect, type Socket } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { launchUrl, lineReader, redact, runtimeEnvironment } from './policy.js'
import { runtimeSocket } from './shared-paths.js'
import { dirname, join } from 'node:path'
import type { RuntimeConfig } from './payload.js'

export interface BrokerOptions {
  state: string
  seed?: string
  config?: RuntimeConfig
  port?: number
}
export interface BrokerLaunch {
  node: string
  broker: string
  options: BrokerOptions
}

export function connectSocket(state: string): Promise<Socket | undefined> {
  return new Promise((resolveSocket, reject) => {
    const socket = connect(runtimeSocket(state))
    const timer = setTimeout(() => socket.destroy(new Error('Local Nook connection timed out')), 2000)
    const error = (error: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      socket.destroy()
      if (['ENOENT', 'ECONNREFUSED'].includes(error.code ?? '')) resolveSocket(undefined)
      else reject(error)
    }
    socket.once('error', error)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.off('error', error)
      resolveSocket(socket)
    })
  })
}

export async function sharedRuntimeRunning(state: string): Promise<boolean> {
  const socket = await connectSocket(state)
  socket?.destroy()
  return Boolean(socket)
}

/** Each frontend owns a lease; the broker stops only after the last lease ends. */
export class SharedRuntime {
  readonly ready: Promise<string>
  private socket: Socket | undefined
  private stopped = false
  private stopping: Promise<void> | undefined
  private closed: Promise<void> = Promise.resolve()
  private startup: Promise<void>
  private finalPid: number | undefined
  private cancelReady: () => void = () => {}
  private abort = new AbortController()

  constructor(
    state: string,
    prepare: () => Promise<BrokerLaunch>,
    log: (line: string) => void,
    failed: (error: Error) => void,
  ) {
    let resolveReady!: (url: string) => void
    let rejectReady!: (error: Error) => void
    this.ready = new Promise((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    void this.ready.catch(() => {})
    let rejected = false
    const reject = (error: Error) => {
      if (rejected) return
      rejected = true
      rejectReady(error)
      if (!this.stopped) failed(error)
    }
    this.cancelReady = () => reject(new Error('Shared Nook startup cancelled'))
    const timer = setTimeout(() => {
      reject(new Error('Shared Nook startup timed out'))
      void this.stop()
    }, 180_000)
    this.startup = (async () => {
      let socket = await connectSocket(state)
      if (!socket && !this.stopped) {
        const launch = await prepare()
        if (this.stopped) return
        const child = spawn(launch.node, [launch.broker, JSON.stringify(launch.options)], {
          detached: true,
          stdio: 'ignore',
          env: runtimeEnvironment(join(state, 'harness'), dirname(launch.node)),
        })
        const spawned = new Promise<void>((resolve, reject) => {
          child.once('spawn', resolve)
          child.once('error', reject)
        })
        child.unref()
        await spawned
        const deadline = Date.now() + 15_000
        while (!socket && !this.stopped && Date.now() < deadline) {
          await delay(100, undefined, { signal: this.abort.signal })
          socket = await connectSocket(state)
        }
      }
      if (!socket) {
        if (!this.stopped) throw new Error('Shared Nook broker could not start; inspect backend logs')
        return
      }
      this.socket = socket
      this.closed = new Promise(resolve => socket!.once('close', resolve))
      const reader = lineReader(line => {
        try {
          const value = JSON.parse(line)
          if (value.type === 'ready' && typeof value.url === 'string') {
            const url = launchUrl(`dsh web: ${value.url}`)
            if (!url) throw new Error('Invalid shared Nook URL')
            clearTimeout(timer)
            resolveReady(url)
          } else if (value.type === 'log' && typeof value.text === 'string') log(redact(value.text))
          else if (value.type === 'failure' && typeof value.message === 'string')
            reject(new Error(redact(value.message)))
          else if (value.type === 'released') {
            if (Number.isSafeInteger(value.finalPid) && value.finalPid > 1) this.finalPid = value.finalPid
            socket!.end()
          }
        } catch (error) {
          reject(new Error(redact(String(error))))
          socket!.destroy()
        }
      })
      socket.on('data', reader.write)
      socket.on('error', reject)
      void this.closed.then(() => {
        clearTimeout(timer)
        socket!.off('data', reader.write)
        socket!.off('error', reject)
        reader.end()
        reject(new Error('Shared Nook connection closed'))
      })
      if (this.stopped) socket.destroy()
      else socket.write(JSON.stringify({ version: 1, type: 'attach' }) + '\n')
    })().catch(error => {
      clearTimeout(timer)
      reject(error instanceof Error ? error : new Error(String(error)))
    })
    void this.startup.then(() => {
      if (this.stopped) clearTimeout(timer)
    })
  }

  stop(): Promise<void> {
    this.stopped = true
    this.cancelReady()
    this.abort.abort()
    return (this.stopping ??= (async () => {
      await this.startup
      const socket = this.socket
      if (!socket || socket.destroyed) return
      socket.write('{"type":"release"}\n')
      const timer = setTimeout(() => socket.destroy(), 15_000)
      try {
        await this.closed
        if (this.finalPid) {
          for (let attempt = 0; attempt < 100; attempt++) {
            try {
              process.kill(this.finalPid, 0)
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === 'ESRCH') return
              throw error
            }
            await delay(20)
          }
          throw new Error('Shared Nook broker did not exit after releasing its last client')
        }
      } finally {
        clearTimeout(timer)
      }
    })())
  }
}
