import { test } from 'node:test'

import assert from 'node:assert/strict'

import { execFileSync } from 'node:child_process'

import { dockerArtifacts, deploymentFiles, assistantArtifacts } from '../../../scripts/sync-server/artifacts.mjs'

import { createHash } from 'node:crypto'

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'

import { tmpdir } from 'node:os'

import { join } from 'node:path'

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

test('downloaded Docker archive contains exact allowlisted build sources and no local credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nook-deployment-'))
  try {
    const artifact = await dockerArtifacts()
    assert.deepEqual([...artifact.archive.subarray(0, 10)], [31, 139, 8, 0, 0, 0, 0, 0, 2, 3])
    assert.deepEqual(artifact.archive, (await dockerArtifacts()).archive)
    const archive = join(directory, artifact.filename)
    await writeFile(archive, artifact.archive)
    assert.deepEqual(
      execFileSync('tar', ['-tzf', artifact.filename], { cwd: directory, encoding: 'utf8' }).trim().split(/\r?\n/),
      deploymentFiles,
    )
    execFileSync('tar', ['-xzf', artifact.filename], { cwd: directory })
    for (const name of deploymentFiles)
      assert.deepEqual(
        await readFile(join(directory, name)),
        Buffer.from(
          (await readFile(new URL('../../../scripts/sync-server/' + name, import.meta.url), 'utf8')).replaceAll(
            '\r\n',
            '\n',
          ),
        ),
      )
    assert.match(await readFile(join(directory, 'compose.yaml'), 'utf8'), /ghcr\.io\/voosil\/nook-sync:0\.1\.0/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
