import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { test } from 'node:test'
import { selectWebPort, checkWebPort } from '../../scripts/profile/web-port.mjs'

test('Windows defaults fall back for denied or occupied ports, preserving explicit requests', async () => {
  for (const code of ['EACCES', 'EADDRINUSE']) {
    const error = Object.assign(new Error('fixture port conflict'), { code })
    const messages: string[] = []
    const options = {
      platform: 'win32',
      check: async () => {
        throw error
      },
      log: (line: string) => messages.push(line),
    }
    assert.equal(await selectWebPort(3081, options), 0)
    assert.match(messages[0]!, new RegExp(code))
    await assert.rejects(selectWebPort(3081, { ...options, explicit: true }), /--port 0/)
    assert.equal(await selectWebPort(0, { ...options, explicit: true }), 0)
    assert.equal(await selectWebPort(3081, { ...options, platform: 'darwin' }), 3081)
  }
  assert.equal(await selectWebPort(3081, { platform: 'win32', check: async () => {} }), 3081)
  await assert.rejects(
    selectWebPort(3081, {
      platform: 'win32',
      check: async () => {
        throw new Error('unexpected failure')
      },
    }),
    /unexpected failure/,
  )
})

test('a real conflicting listener is preserved and the probe releases its socket', async () => {
  const owner = createServer()
  owner.listen({ host: '127.0.0.1', port: 0, exclusive: true })
  await once(owner, 'listening')
  const port = (owner.address() as { port: number }).port
  try {
    assert.equal(await selectWebPort(port, { platform: 'win32', log: () => {} }), 0)
    assert.ok(owner.listening)
  } finally {
    await new Promise<void>(resolve => owner.close(() => resolve()))
  }
  await checkWebPort(port)
  await checkWebPort(port)
})
