import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { test } from 'node:test'
import { releasePort } from '../../../scripts/shared/release-port.mjs'

// Windows performs multiple separately bounded PowerShell inspections (10s
// each); the whole test must allow those checks and verify the actual rebind.
test('port release terminates a real listener owned by the test', { timeout: 45_000 }, async () => {
  const child = spawn(
    process.execPath,
    [
      '-e',
      "const server=require('node:net').createServer(); server.listen(0,'127.0.0.1',()=>process.stdout.write(String(server.address().port)))",
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  child.stdout.setEncoding('utf8')
  const exited = once(child, 'exit')

  try {
    const [chunk] = await once(child.stdout, 'data')
    const port = Number(String(chunk).trim())
    assert.ok(Number.isSafeInteger(port) && port > 0)
    assert.ok(child.pid !== undefined)

    const released = await releasePort(port)
    assert.deepEqual(released, [child.pid])
    await exited
    const replacement = createServer()
    try {
      replacement.listen(port, '127.0.0.1')
      await once(replacement, 'listening')
      assert.equal((replacement.address() as { port: number }).port, port)
    } finally {
      await new Promise<void>((resolve, reject) => replacement.close(error => (error ? reject(error) : resolve())))
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exited
  }
})
