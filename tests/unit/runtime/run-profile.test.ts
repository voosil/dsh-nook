import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { createProfileArgs, resolveDevPort } from '../../../scripts/profile/run-profile-args.mjs'
import { releasePort } from '../../../scripts/shared/release-port.mjs'

const ROOT = '/tmp/nook-workspace'
const BIN = '/tmp/nook-workspace/node_modules/@deepseek-ai/dsh/lib/bin.js'

test('development launcher defaults to port 3080', () => {
  assert.deepEqual(createProfileArgs(BIN, ROOT, []), [BIN, '--profile', 'nook', '--no-open', '--port', '3080'])
  assert.equal(resolveDevPort([]), 3080)
})

test('development launcher can select an ephemeral default without replacing an explicit port', () => {
  assert.deepEqual(createProfileArgs(BIN, ROOT, [], { defaultPort: 0 }), [
    BIN,
    '--profile',
    'nook',
    '--no-open',
    '--port',
    '0',
  ])
  assert.equal(createProfileArgs(BIN, ROOT, ['--port=4000'], { defaultPort: 0 }).at(-1), '--port=4000')
})

test('development launcher accepts a port override and Safe UI mode', () => {
  assert.deepEqual(createProfileArgs(BIN, ROOT, ['--', '--safe-ui', '--port', '4000']), [
    BIN,
    '--profile',
    'nook',
    '--patch',
    resolve(ROOT, 'dev/patches/safe-ui.cordis.yml'),
    '--no-open',
    '--port',
    '4000',
  ])
  assert.equal(resolveDevPort(['--', '--port', '4000']), 4000)
  assert.equal(resolveDevPort(['--port=0']), 0)
})

test('port release first terminates gracefully', async () => {
  const signals: Array<[number, string]> = []
  let inspections = 0
  const released = await releasePort(3080, {
    find: async () => (++inspections === 1 ? [1234] : []),
    signal: (pid: number, signal: string) => signals.push([pid, signal]),
    wait: async () => undefined,
  })
  assert.deepEqual(released, [1234])
  assert.deepEqual(signals, [[1234, 'SIGTERM']])
})

test('port release force-kills a listener after the grace period', async () => {
  const signals: Array<[number, string]> = []
  let killed = false
  const released = await releasePort(3080, {
    find: async () => (killed ? [] : [5678]),
    signal: (pid: number, signal: string) => {
      signals.push([pid, signal])
      if (signal === 'SIGKILL') killed = true
    },
    wait: async () => undefined,
    graceMs: 0,
  })
  assert.deepEqual(released, [5678])
  assert.deepEqual(signals, [
    [5678, 'SIGTERM'],
    [5678, 'SIGKILL'],
  ])
})
