import { createServer } from 'node:net'

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

export async function selectWebPort(
  port,
  { explicit = false, platform = process.platform, check = checkWebPort, log = console.log, label = 'nook start' } = {},
) {
  if (platform !== 'win32' || port === 0) return port
  try {
    await check(port)
    return port
  } catch (error) {
    if (!['EACCES', 'EADDRINUSE'].includes(error.code)) throw error
    if (explicit)
      throw new Error(`Nook port ${port} is unavailable (${error.code}). Choose another --port or use --port 0.`, {
        cause: error,
      })
    log(
      `[${label}] Port ${port} is unavailable (${error.code}); selecting an available port. Open the URL printed below.`,
    )
    return 0
  }
}
