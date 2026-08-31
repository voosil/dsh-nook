import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import LocalArtifactProvider from '../../packages/provider-artifact-local/src/index.ts'

const PROJECT_ID = '48c233ad-0f6d-4fba-8971-65ed879b0525'

test('local artifact provider persists, validates, deletes, and remounts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nook-artifact-provider-'))
  const ctx = new Context()
  try {
    const first = await ctx.plugin(LocalArtifactProvider, { root, maxBytes: 1024 })
    const dataBase64 = Buffer.from('nook preview').toString('base64')
    const artifact = await ctx.nookArtifacts.write({
      projectId: PROJECT_ID,
      name: 'preview.png',
      mediaType: 'image/png',
      dataBase64,
    })
    assert.equal((await ctx.nookArtifacts.read(artifact.id))?.dataBase64, dataBase64)
    await assert.rejects(
      ctx.nookArtifacts.write({
        projectId: PROJECT_ID,
        name: 'bad.bin',
        mediaType: 'application/octet-stream',
        dataBase64: '***',
      }),
      /canonical base64/,
    )
    await first.dispose()

    const second = await ctx.plugin(LocalArtifactProvider, { root, maxBytes: 1024 })
    assert.equal((await ctx.nookArtifacts.list(PROJECT_ID))[0]?.id, artifact.id)
    await ctx.nookArtifacts.delete(artifact.id)
    assert.equal(await ctx.nookArtifacts.read(artifact.id), undefined)
    await second.dispose()
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
