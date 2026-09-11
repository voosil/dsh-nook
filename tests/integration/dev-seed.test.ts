import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import * as Notebook from '../../packages/provider-notebook-local/src/index.ts'
import TaskProvider from '../../packages/provider-task-sync/src/index.ts'
import { seedDevData } from '../../scripts/profile/dev-seed.mjs'

test('real development fixtures persist, remain editable, and repeated seeding preserves edits and deletions', async t => {
  const home = await mkdtemp(join(tmpdir(), 'nook-seed-test-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  await seedDevData(home)
  const inspect = async (action: (ctx: Context) => Promise<void>) => {
    const ctx = new Context()
    try {
      await ctx.plugin(Notebook, {
        file: join(home, 'nook/notebook.sqlite'),
        projectsFile: join(home, 'nook/projects.json'),
      })
      await ctx.plugin(TaskProvider, { identity: join(home, 'nook-task-device-id') })
      await action(ctx)
    } finally {
      await ctx.fiber.dispose()
    }
  }
  let noteId = '',
    projectId = '',
    revision = 0
  await inspect(async ctx => {
    const notes = await ctx.nookNotes.list({})
    assert.equal(notes.total, 7)
    assert.equal((await ctx.nookNotes.list({ trash: true })).total, 1)
    assert.equal((await ctx.nookProjects.list()).length, 3)
    assert.ok((await ctx.nookKnowledge.search({ query: '阅读节奏' })).length)
    const note = notes.notes.find(note => note.pinned)!
    noteId = note.id
    projectId = note.projectId!
    const saved = await ctx.nookNotes.save({ ...note, markdown: '这是我手动修改的内容' })
    revision = saved.note.revision
    await ctx.nookProjects.update(projectId, { name: '我改过的项目名称' })
    const removed = notes.notes.find(note => note.title === '今天的小发现')!
    await ctx.nookNotes.setDeleted(removed.id, removed.revision, true)
    const tasks = ctx.nookTaskStore.list('task')
    assert.deepEqual(tasks.map(task => task.status).sort(), ['done', 'paused', 'todo', 'unscheduled'])
    assert.ok(tasks.every(task => task.assignee !== 'agent' && task.timing.repeat === 'none'))
    assert.equal(ctx.nookTaskStore.list('task-run').length, 0)
    const task = tasks[0]!
    ctx.nookTaskStore.write([{ type: 'task', value: { ...task, title: '手动修改任务' } }])
  })
  await seedDevData(home)
  await seedDevData(home, { force: true })
  await inspect(async ctx => {
    assert.equal((await ctx.nookNotes.get(noteId))?.markdown, '这是我手动修改的内容')
    assert.equal((await ctx.nookNotes.get(noteId))?.revision, revision)
    assert.equal((await ctx.nookProjects.get(projectId))?.name, '我改过的项目名称')
    assert.equal((await ctx.nookProjects.list()).length, 3)
    assert.equal((await ctx.nookNotes.list({})).total, 6)
    assert.equal((await ctx.nookNotes.list({ trash: true })).total, 2)
    assert.equal(ctx.nookTaskStore.list('task').length, 4)
    assert.ok(ctx.nookTaskStore.list('task').some(task => task.title === '手动修改任务'))
    assert.equal(ctx.nookTaskStore.list('task-run').length, 0)
  })
  await assert.rejects(readFile(join(home, 'nook-sync/settings.json')), { code: 'ENOENT' })
})
