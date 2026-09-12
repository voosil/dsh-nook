import { createServer } from 'node:net'
import { findListeningPids } from '../shared/release-port.mjs'

/** Probe only our loopback binding; never stop the existing owner. */
export function checkWebPort(port) {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close(error => {
        server.off('error', reject)
        if (error) reject(error)
        else resolve()
      })
    })
  })
}

const CONFLICT_CODES = ['EACCES', 'EADDRINUSE']
const SCAN_ATTEMPTS = 10
const MAX_PORT = 65_535

/** Formal startup uses an exact port and reports its owner without terminating unrelated listeners. */
export async function requireStartPort(port) {
  try {
    return await selectWebPort(port, { explicit: true })
  } catch (error) {
    if (!CONFLICT_CODES.includes(error.cause?.code)) throw error
    let owners = []
    try {
      owners = await findListeningPids(port)
    } catch {
      /* The bind error remains actionable without process access. */
    }
    throw new Error(
      `${error.message}${owners.length ? ` Listener PID: ${owners.join(', ')}.` : ''} No unrelated process was stopped.`,
      { cause: error },
    )
  }
}

export async function selectWebPort(
  port,
  { explicit = false, check = checkWebPort, log = console.log, label = 'nook start' } = {},
) {
  if (port === 0) return port
  let unavailable
  try {
    await check(port)
    return port
  } catch (error) {
    if (!CONFLICT_CODES.includes(error.code)) throw error
    unavailable = error
  }
  if (explicit)
    throw new Error(`Nook port ${port} is unavailable (${unavailable.code}). Choose another --port or use --port 0.`, {
      cause: unavailable,
    })
  for (let candidate = port + 1; candidate <= Math.min(port + SCAN_ATTEMPTS, MAX_PORT); candidate += 1) {
    try {
      await check(candidate)
      log(`[${label}] Port ${port} is unavailable (${unavailable.code}); using ${candidate} instead.`)
      return candidate
    } catch (error) {
      if (!CONFLICT_CODES.includes(error.code)) throw error
    }
  }
  log(`[${label}] Port ${port} is unavailable (${unavailable.code}); letting the OS assign a free port.`)
  return 0
}
