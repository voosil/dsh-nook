import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'node:test'
import { releasePort } from '../../scripts/shared/release-port.mjs'

test('port release terminates a real listener owned by the test', { timeout: 10_000 }, async () => {
  const child = spawn(
    process.execPath,
    [
      '-e',
      "const server=require('node:net').createServer(); server.listen(0,'127.0.0.1',()=>console.log(server.address().port))",
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  child.stdout.setEncoding('utf8')

  try {
    const [chunk] = await once(child.stdout, 'data')
    const port = Number(String(chunk).trim())
    assert.ok(Number.isSafeInteger(port) && port > 0)
    assert.ok(child.pid !== undefined)

    const exited = once(child, 'exit')
    const released = await releasePort(port)
    assert.deepEqual(released, [child.pid])
    await exited
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
})
