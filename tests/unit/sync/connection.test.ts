import { test } from 'node:test'

import assert from 'node:assert/strict'

import { parseSyncConnection } from '../../../packages/capability-sync/src/connection.ts'

import { join } from 'node:path'

test('portable connection accepts versioned and legacy exports without leaking malformed secrets', () => {
  const legacy = {
    url: 'https://sync.example.test/nook/',
    username: 'nook',
    password: 'private-test-password',
    caCert: '',
  }
  const versioned = { ...legacy, format: 'nook-sync-connection', version: 1 }
  assert.deepEqual(parseSyncConnection(JSON.stringify(legacy)), versioned)
  assert.deepEqual(parseSyncConnection('\uFEFF' + JSON.stringify(versioned)), versioned)
  const encoded = Buffer.from(JSON.stringify({ ...versioned, password: '中文密码🔒' })).toString('base64')
  assert.deepEqual(parseSyncConnection('NOOK-SYNC-1:' + encoded.match(/.{1,60}/g)!.join('\n')), {
    ...versioned,
    password: '中文密码🔒',
  })
  for (const invalid of ['NOOK-SYNC-1:!!!!', 'NOOK-SYNC-2:e30=', 'NOOK-SYNC-1:/w==', 'NOOK-SYNC-1:e30=']) {
    assert.throws(() => parseSyncConnection(invalid))
  }
  for (const value of [
    null,
    [],
    { ...versioned, version: 2 },
    { ...versioned, format: undefined },
    { ...versioned, enabled: true },
    { ...versioned, password: 0 },
    { ...versioned, url: 'http://example.test/' },
    { ...versioned, url: 'https://user:secret@example.test/' },
    { ...versioned, url: 'https://example.test/?password=secret' },
    { ...versioned, caCert: '-----BEGIN PRIVATE KEY----- secret' },
    { ...versioned, caCert: 'x'.repeat(16001) },
  ]) {
    assert.throws(
      () => parseSyncConnection(JSON.stringify(value)),
      error => error instanceof Error && !error.message.includes(legacy.password),
    )
  }
  assert.throws(() => parseSyncConnection(' '.repeat(32769)))
  assert.throws(() => parseSyncConnection('{"password":"private-test-password"'))
})
