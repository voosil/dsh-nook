import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { launchUrl, lineReader, redact, safeHome, sameRuntimeUrl } from '../../apps/desktop/src/policy.ts'

test('authenticated launch URL parser rejects alternate authorities, paths and credentials', () => {
  const valid = 'http://127.0.0.1:45678/?token=synthetic-token'
  assert.equal(launchUrl(`dsh web: ${valid}`), valid)
  for (const url of [
    valid.replace('127.0.0.1', 'localhost'),
    valid.replace('45678', '99999'),
    valid.replace('/?', '/other?'),
    valid + '&extra=true',
    valid.replace('//', '//user@'),
    valid.replace('http:', 'https:'),
    'http://127.0.0.1:45678',
  ])
    assert.equal(launchUrl(`dsh web: ${url}`), undefined)
  assert.equal(sameRuntimeUrl('http://127.0.0.1:45678/page', 'http://127.0.0.1:45678'), true)
  assert.equal(sameRuntimeUrl('http://127.0.0.1:45679/', 'http://127.0.0.1:45678'), false)
  assert.equal(sameRuntimeUrl('http://127.0.0.1:45678/', undefined), false)
})

test('line buffering redacts tokens across every chunk split and bounds unterminated output', () => {
  const input = '日志 http://127.0.0.1:4321/?token=synthetic-secret\n'
  const bytes = Buffer.from(input)
  for (let split = 0; split < bytes.length; split++) {
    const lines: string[] = []
    const reader = lineReader(line => lines.push(redact(line)))
    reader.write(bytes.subarray(0, split))
    reader.write(bytes.subarray(split))
    reader.end()
    assert.deepEqual(lines, ['日志 http://127.0.0.1:4321/?token=<REDACTED>'])
  }
  const lines: string[] = []
  const reader = lineReader(line => lines.push(line), 20)
  reader.write(Buffer.from('a'.repeat(100_000) + '\nnormal\n'))
  reader.end()
  assert.deepEqual(lines, ['[oversized runtime log line omitted]', 'normal'])
})

test('real DSH home aliases are refused', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nook-home-test-'))
  try {
    const user = join(root, 'user')
    await mkdir(join(user, '.dsh'), { recursive: true })
    await symlink(join(user, '.dsh'), join(root, 'alias'))
    assert.throws(() => safeHome(join(root, 'alias', 'nested'), user), /real DSH/)
    assert.equal(safeHome(join(root, 'fresh'), user), join(await realpath(root), 'fresh'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
