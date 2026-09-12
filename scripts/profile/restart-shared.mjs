import { setTimeout as delay } from 'node:timers/promises'
import { connectSocket } from '../../apps/desktop/dist/shared-client.mjs'

async function waitForExit(pid, signal) {
  for (let i = 0; i < 300; i++) {
    signal?.throwIfAborted()
    try {
      process.kill(pid, 0)
    } catch (error) {
      if (error.code === 'ESRCH') return
      throw error
    }
    await delay(100, undefined, { signal })
  }
  throw new Error(`Nook backend ${pid} did not exit; refusing to start a second backend.`)
}

/** Stop the formal backend via its private control connection and wait for cleanup. */
export async function stopSharedRuntime(state, { signal, log = console.log } = {}) {
  signal?.throwIfAborted()
  const socket = await connectSocket(state)
  if (signal?.aborted) {
    socket?.destroy()
    signal.throwIfAborted()
  }
  if (!socket) return false
  log('[nook start] New runtime prepared. Stopping the previous Nook backend…')
  const result = await new Promise((resolveResult, reject) => {
    let buffer = '',
      acknowledged = false,
      pid
    const timer = setTimeout(() => {
      reject(new Error('Nook shutdown timed out; the new backend was not started.'))
      socket.destroy()
    }, 60_000)
    const cancel = () => {
      reject(signal.reason)
      socket.destroy()
    }
    signal?.addEventListener('abort', cancel, { once: true })
    socket.on('data', chunk => {
      buffer += chunk.toString()
      if (buffer.length > 64_000) {
        socket.destroy()
        return
      }
      let newline
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        try {
          const value = JSON.parse(line)
          if (value.type === 'stopping') acknowledged = true
          if (value.type === 'released' && Number.isSafeInteger(value.finalPid) && value.finalPid > 1)
            pid = value.finalPid
        } catch {
          socket.destroy()
        }
      }
    })
    socket.on('error', error => {
      if (error.code !== 'ECONNRESET') reject(error)
    })
    socket.once('close', () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      resolveResult({ acknowledged, pid })
    })
    socket.write(JSON.stringify({ version: 1, type: 'shutdown' }) + '\n')
  })
  if (!result.acknowledged || !result.pid)
    throw new Error('Nook shutdown ended without confirmation; the new backend was not started.')
  await waitForExit(result.pid, signal)
  return true
}
