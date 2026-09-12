import assert from 'node:assert/strict'

import { randomUUID } from 'node:crypto'

import { mkdtemp, rm } from 'node:fs/promises'

import { tmpdir } from 'node:os'

import { join } from 'node:path'

import { test } from 'node:test'

import { Context } from '@deepseek-ai/cordis'

import * as Notebook from '../../../packages/provider-notebook-local/src/index.ts'

import Projects from '../../../packages/provider-project-local/src/index.ts'

for (const integrated of [false, true]) {
  test(`project order survives restart and rejects stale or duplicate lists (${integrated ? 'SQLite' : 'JSON'})`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'nook-project-order-'))
    const contexts: Context[] = []
    t.after(async () => {
      for (const ctx of contexts) await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    })
    async function boot() {
      const ctx = new Context()
      contexts.push(ctx)
      if (integrated)
        await ctx.plugin(Notebook, { file: join(root, 'notes.sqlite'), projectsFile: join(root, 'projects.json') })
      else await ctx.plugin(Projects, { file: join(root, 'projects.json') })
      return ctx
    }
    let ctx = await boot()
    const a = await ctx.nookProjects.create({ name: '甲' }),
      b = await ctx.nookProjects.create({ name: '乙' }),
      c = await ctx.nookProjects.create({ name: '丙' })
    const ids = [c.id, a.id, b.id]
    await ctx.nookProjects.reorder(ids)
    await ctx.nookProjects.update(a.id, { name: '改名', description: '保留排序' })
    await assert.rejects(ctx.nookProjects.reorder([a.id, a.id, b.id]), /列表已变化/)
    await assert.rejects(ctx.nookProjects.reorder([a.id, b.id]), /列表已变化/)
    await assert.rejects(ctx.nookProjects.reorder([a.id, b.id, randomUUID()]), /列表已变化/)
    assert.deepEqual(
      (await ctx.nookProjects.list()).map(p => p.id),
      ids,
    )
    await ctx.fiber.dispose()
    ctx = await boot()
    assert.deepEqual(
      (await ctx.nookProjects.list()).map(p => p.id),
      ids,
    )
    assert.equal((await ctx.nookProjects.get(a.id))?.name, '改名')
    const d = await ctx.nookProjects.create({ name: '新项目' })
    assert.deepEqual(
      (await ctx.nookProjects.list()).map(p => p.id),
      [...ids, d.id],
    )
  })
}
