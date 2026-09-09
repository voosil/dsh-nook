import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { inflateSync } from 'node:zlib'
import {
  installerArtifacts,
  dockerArtifacts,
  deploymentFiles,
  assistantArtifacts,
} from '../../scripts/sync-server/artifacts.mjs'
import { createHash } from 'node:crypto'
import { parseSyncConnection } from '../../packages/capability-sync/src/connection.ts'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('embedded one-line installer contains the exact downloadable source without shell interpolation', async () => {
  const { source, command } = await installerArtifacts()
  assert.ok(!command.includes('\n'))
  const payload = command.match(/b64decode\("([A-Za-z0-9+/=]+)"\)/)?.[1]
  assert.ok(payload)
  assert.equal(inflateSync(Buffer.from(payload, 'base64')).toString(), source)
  const python = command.slice("sudo python3 -c '".length, -1)
  const help = execFileSync('python3', ['-c', python, '--help'], { encoding: 'utf8' })
  assert.match(help, /vpn,ip,domain/)
})
test('installer validates targets, preserves backups and refuses occupied ports', () => {
  execFileSync('python3', ['tests/sync-server/test_setup.py'], { stdio: 'pipe' })
  execFileSync('python3', ['tests/sync-server/test_assistant.py'], { stdio: 'pipe' })
})

test('assistant pins the complete bootstrap/source/archive/image chain', async () => {
  const artifact = await assistantArtifacts()
  const digest = data => createHash('sha256').update(data).digest('hex')
  assert.ok(artifact.command.includes(digest(artifact.bootstrap)))
  assert.ok(artifact.bootstrap.includes(digest(artifact.source)))
  assert.ok(artifact.source.includes(digest(artifact.archive)))
  assert.match(artifact.source, /IMAGE = 'ghcr\.io\/voosil\/nook-sync@sha256:[a-f0-9]{64}'/)
  assert.ok(!artifact.command.includes('\n'))
  execFileSync('bash', ['-n'], { input: artifact.command })
  execFileSync('bash', ['-n'], { input: artifact.bootstrap })
})

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

test('downloaded Docker archive contains exact allowlisted build sources and no local credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nook-deployment-'))
  try {
    const artifact = await dockerArtifacts()
    assert.deepEqual(artifact.archive, (await dockerArtifacts()).archive)
    const archive = join(directory, artifact.filename)
    await writeFile(archive, artifact.archive)
    assert.deepEqual(execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n'), deploymentFiles)
    execFileSync('tar', ['-xzf', archive, '-C', directory])
    for (const name of deploymentFiles)
      assert.deepEqual(
        await readFile(join(directory, name)),
        await readFile(new URL('../../scripts/sync-server/' + name, import.meta.url)),
      )
    assert.match(await readFile(join(directory, 'compose.yaml'), 'utf8'), /ghcr\.io\/voosil\/nook-sync:0\.1\.0/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
