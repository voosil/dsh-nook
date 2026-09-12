import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { test } from 'node:test'
import { selectWebPort, checkWebPort, requireStartPort } from '../../../scripts/profile/web-port.mjs'

function conflictError(code: string) {
  return Object.assign(new Error('fixture port conflict'), { code })
}

test('unavailable defaults scan upward for a free port, explicit requests fail loudly', async () => {
  const busyOnlyFirst: typeof checkWebPort = async port => {
    if (port === 3081) throw conflictError('EADDRINUSE')
  }
  const messages: string[] = []
  const log = (line: string) => messages.push(line)
  assert.equal(await selectWebPort(3081, { check: busyOnlyFirst, log }), 3082)
  assert.match(messages[0]!, /EADDRINUSE/)
  assert.match(messages[0]!, /using 3082 instead/)
  await assert.rejects(selectWebPort(3081, { check: busyOnlyFirst, explicit: true }), /Choose another --port/)

  const alwaysBusy: typeof checkWebPort = async () => {
    throw conflictError('EACCES')
  }
  messages.length = 0
  assert.equal(await selectWebPort(3081, { check: alwaysBusy, log }), 0)
  assert.match(messages[0]!, /EACCES/)
  assert.match(messages[0]!, /letting the OS assign a free port/)

  assert.equal(await selectWebPort(0, { check: alwaysBusy, explicit: true }), 0)
  assert.equal(await selectWebPort(3081, { check: async () => {} }), 3081)
  await assert.rejects(
    selectWebPort(3081, {
      check: async () => {
        throw new Error('unexpected failure')
      },
    }),
    /unexpected failure/,
  )
})

test('a real conflicting listener yields a bindable port and the probe releases its socket', async () => {
  const owner = createServer()
  owner.listen({ host: '127.0.0.1', port: 0, exclusive: true })
  await once(owner, 'listening')
  const port = (owner.address() as { port: number }).port
  try {
    await assert.rejects(requireStartPort(port), /unavailable.*No unrelated process was stopped/)
    assert.ok(owner.listening, 'Strict formal startup must preserve an unrelated listener')
    const selected = await selectWebPort(port, { log: () => {} })
    assert.notEqual(selected, port)
    assert.ok(owner.listening)
    if (selected !== 0) await checkWebPort(selected)
  } finally {
    await new Promise<void>(resolve => owner.close(() => resolve()))
  }
  await checkWebPort(port)
  await checkWebPort(port)
})
