import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { withWebRuntime } from '../../helpers/runtime/web.mjs'

test(
  'runtime preparation does not run product scenarios and releases its port after a failed case',
  { timeout: 30_000 },
  async t => {
    const directory = await mkdtemp(join(tmpdir(), 'nook-runtime-helper-'))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const bin = join(directory, 'server.mjs')
    await writeFile(
      bin,
      `import { createServer } from 'node:http'
    const server = createServer((request, response) => response.end('fixture'))
    server.listen(0, '127.0.0.1', () => console.log('dsh web: http://127.0.0.1:' + server.address().port + '/?token=test-token '))
    process.once('SIGTERM', () => server.close(() => process.exit(0)))
  `,
    )
    let port
    await assert.rejects(
      withWebRuntime({ bin, cwd: directory, env: { DSH_HOME: directory } }, async url => {
        port = Number(new URL(url).port)
        assert.equal(await (await fetch(url)).text(), 'fixture')
        throw new Error('EXPECTED_CASE_FAILURE')
      }),
      /EXPECTED_CASE_FAILURE/,
    )
    assert.ok(port, 'Preparation must reach the case without implicit business assertions')
    const probe = createServer()
    try {
      const listening = once(probe, 'listening')
      probe.listen({ host: '127.0.0.1', port, exclusive: true })
      await listening
    } finally {
      if (probe.listening)
        await new Promise((resolve, reject) => probe.close(error => (error ? reject(error) : resolve())))
    }
  },
)
