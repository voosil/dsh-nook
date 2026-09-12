import assert from 'node:assert/strict'

import { mkdtemp, rm } from 'node:fs/promises'

import { tmpdir } from 'node:os'

import { join } from 'node:path'

import { test } from 'node:test'

import { Context } from '@deepseek-ai/cordis'

import LocalProjectProvider from '../../../packages/provider-project-local/src/index.ts'

test('local project provider persists across unmount and remount', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nook-project-provider-'))
  const file = join(root, 'projects.json')
  const ctx = new Context()
  try {
    const first = await ctx.plugin(LocalProjectProvider, { file })
    ctx.nookProjects.subscribe(() => {
      throw new Error('broken subscriber')
    })
    const project = await ctx.nookProjects.create({ name: 'Window seat' })
    await first.dispose()

    const second = await ctx.plugin(LocalProjectProvider, { file })
    assert.equal((await ctx.nookProjects.get(project.id))?.name, 'Window seat')
    await second.dispose()
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
