import { readFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
export interface DesktopTaskSnapshot {
  isOwner: boolean
  settings: { keepAlive: boolean }
  notifications: { id: string; targetId: string; title: string; body: string; read: boolean; createdAt: string }[]
}
export async function taskSnapshot(file: string): Promise<DesktopTaskSnapshot> {
  const info = JSON.parse(await readFile(file, 'utf8'))
  if (!Number.isInteger(info.port) || info.port < 1 || info.port > 65535 || typeof info.token !== 'string')
    throw new Error('Task bridge unavailable')
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port: info.port })
    let buffer = ''
    let finished = false
    const done = (error?: Error, value?: DesktopTaskSnapshot) => {
      if (finished) return
      finished = true
      socket.destroy()
      if (error) reject(error)
      else resolve(value!)
    }
    socket.setTimeout(3000, () => done(new Error('Task bridge timed out')))
    socket.once('connect', () =>
      socket.write(JSON.stringify({ id: 'desktop', method: 'snapshot', token: info.token }) + '\n'),
    )
    socket.on('data', chunk => {
      buffer += chunk.toString()
      if (buffer.length > 8_000_000) return done(new Error('Task response too large'))
      if (buffer.includes('\n'))
        try {
          const response = JSON.parse(buffer.slice(0, buffer.indexOf('\n'))),
            value = response.result?.value
          if (
            !response.result?.ok ||
            typeof value?.isOwner !== 'boolean' ||
            typeof value.settings?.keepAlive !== 'boolean' ||
            !Array.isArray(value.notifications)
          )
            throw new Error('Invalid task response')
          done(undefined, value)
        } catch {
          done(new Error('Invalid task response'))
        }
    })
    socket.on('error', error => done(error))
    socket.once('end', () => done(new Error('Task bridge closed')))
  })
}
