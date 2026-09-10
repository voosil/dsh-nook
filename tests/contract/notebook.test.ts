import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Context, Service } from '@deepseek-ai/cordis'
import Registry from '@deepseek-ai/dsh-typert-registry'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import * as Notebook from '../../packages/provider-notebook-local/src/index.ts'
import Projects from '../../packages/provider-project-local/src/index.ts'
import Feature from '../../packages/feature-notes/src/index.ts'
import Reflection from '../../packages/feature-reflection/src/index.ts'
import Video from '../../packages/feature-video/src/index.ts'
import VideoSource from '../../packages/adapter-video-platform/src/index.ts'
import * as VideoEditor from '../../packages/provider-video-editor/src/index.ts'
import { requests } from '../../packages/adapter-notes-dsh/src/rpc.ts'
import Rpc from '../../packages/adapter-notes-dsh/src/index.ts'
import { Autosave } from '../../packages/ui-notes/src/client/lib/autosave.ts'
import type { CreateNoteRequest, NoteDto } from '../../packages/capability-note/src/index.ts'

function input(markdown: string): CreateNoteRequest {
  return {
    id: randomUUID(),
    title: '',
    markdown,
    projectId: null,
    pinned: false,
    source: { kind: 'personal', url: null, author: null, basedOn: [] },
  }
}

test('notes persist, search Chinese, enforce revisions, and atomically update/remove/restore knowledge', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nook-notebook-'))
  const ctx = new Context()
  try {
    let plugin = await ctx.plugin(Notebook, { file: join(root, 'notes.sqlite') })
    const note = await ctx.nookNotes.create(input('劳动异化与自由实践，记录最初的想法。'))
    assert.equal((await ctx.nookNotes.list({ search: '异化' })).total, 1)
    assert.equal((await ctx.nookKnowledge.search({ query: '劳动异化' }))[0]?.documentId, note.id)
    assert.equal((await ctx.nookNotes.list({ search: '%' })).total, 0)
    const { note: saved } = await ctx.nookNotes.save({ ...note, markdown: '哲学学习的新问题' })
    await assert.rejects(ctx.nookNotes.save({ ...note, markdown: 'stale' }), /其他窗口/)
    assert.equal((await ctx.nookKnowledge.search({ query: '劳动异化' })).length, 0)
    assert.equal((await ctx.nookKnowledge.search({ query: '哲学' }))[0]?.revision, saved.revision)
    const deleted = await ctx.nookNotes.setDeleted(note.id, saved.revision, true)
    assert.equal((await ctx.nookNotes.list({})).total, 0)
    assert.equal((await ctx.nookNotes.list({ trash: true })).total, 1)
    assert.equal((await ctx.nookKnowledge.search({ query: '哲学' })).length, 0)
    await ctx.nookNotes.setDeleted(note.id, deleted.revision, false)
    await plugin.dispose()
    plugin = await ctx.plugin(Notebook, { file: join(root, 'notes.sqlite') })
    assert.equal((await ctx.nookNotes.get(note.id))?.markdown, '哲学学习的新问题')
    assert.equal((await ctx.nookKnowledge.search({ query: '哲学' })).length, 1)
    const titleOnly = await ctx.nookNotes.create({ ...input(''), title: '标题专有词' })
    assert.equal((await ctx.nookKnowledge.search({ query: '标题专有词' }))[0]?.documentId, titleOnly.id)
    await plugin.dispose()
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

test('strict DSH Gateway invokes Nook DTOs, rejects malformed calls, and withdraws with plugin', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nook-notebook-rpc-'))
  const ctx = new Context()
  try {
    await ctx.plugin(Registry)
    await ctx.plugin(Gateway)
    await ctx.plugin(Projects, { file: join(root, 'projects.json') })
    await ctx.plugin(Notebook, { file: join(root, 'notes.sqlite') })
    await ctx.plugin(Feature)
    await ctx.plugin(
      class Generation extends Service {
        constructor(ctx: Context) {
          super(ctx, 'nookGeneration')
        }
        async models() {
          return []
        }
        async generate() {
          return 'generated'
        }
      },
    )
    await ctx.plugin(Reflection)
    await ctx.plugin(VideoSource, { root, python: 'python3' })
    await ctx.plugin(VideoEditor, { cache: join(root, 'cache') })
    await ctx.plugin(Video)
    const plugin = await ctx.plugin(Rpc)
    const created = (await ctx.typertGateway.invoke({
      namespace: 'nookNotebookRpc',
      method: 'create',
      args: { request: input('跨界面保存中文笔记') },
    })) as { ok: true; value: NoteDto }
    assert.equal(created.ok, true)
    assert.equal(created.value.markdown, '跨界面保存中文笔记')
    await assert.rejects(
      ctx.typertGateway.invoke({
        namespace: 'nookNotebookRpc',
        method: 'save',
        args: { request: { id: created.value.id, markdown: 12 } },
      }),
      /boundary validation/,
    )
    const project = await ctx.nookNotebook.createProject({ name: '阅读' })
    const ordered = (await ctx.typertGateway.invoke({
      namespace: 'nookNotebookRpc',
      method: 'reorderProjects',
      args: { request: { ids: [project.id] } },
    })) as { ok: true; value: { id: string; sortOrder: number }[] }
    assert.equal(ordered.ok, true)
    assert.equal(ordered.value[0]?.sortOrder, 0)
    await assert.rejects(
      ctx.typertGateway.invoke({
        namespace: 'nookNotebookRpc',
        method: 'reorderProjects',
        args: { request: { ids: ['invalid'] } },
      }),
      /boundary validation/,
    )
    const { note: updated } = await ctx.nookNotebook.save({ ...created.value, projectId: project.id })
    assert.equal((await ctx.nookNotebook.search({ query: '中文', projectId: project.id })).length, 1)
    assert.equal((await ctx.nookNotebook.search({ query: '中文', projectId: randomUUID() })).length, 0)
    await ctx.nookKnowledge.setSession('scoped', { enabled: true, projectId: project.id })
    await ctx.nookNotebook.deleteProject(project.id)
    assert.deepEqual(await ctx.nookKnowledge.session('scoped'), { enabled: false, projectId: null })
    assert.equal((await ctx.nookNotebook.get(updated.id))?.projectId, null)
    await plugin.dispose()
    await assert.rejects(
      ctx.typertGateway.invoke({ namespace: 'nookNotebookRpc', method: 'projects', args: { request: {} } }),
      /withdrawn/,
    )
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

test('autosave serializes overlapping edits and preserves unsaved input on failure', async () => {
  const note: NoteDto = {
    ...input('初始正文'),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    revision: 1,
  }
  let release!: () => void
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const versions: number[] = []
  const controller = new Autosave(
    note,
    async request => {
      requests.save.parse(request)
      versions.push(request.revision)
      if (versions.length === 1) await gate
      return { note: { ...note, ...request, revision: request.revision + 1 }, submittedVersionId: null }
    },
    () => {},
  )
  controller.edit({ ...note, markdown: '第一段' })
  const pending = controller.flush()
  controller.edit({ ...note, markdown: '第一段和第二段' })
  release()
  assert.equal(await pending, true)
  assert.deepEqual(versions, [1, 2])
  assert.equal(controller.note.markdown, '第一段和第二段')
  assert.equal(controller.dirty, false)
  const failed = new Autosave(
    note,
    async () => {
      throw new Error('offline')
    },
    () => {},
  )
  failed.edit({ ...note, markdown: '不能丢失的草稿' })
  assert.equal(await failed.flush(), false)
  assert.equal(failed.current.markdown, '不能丢失的草稿')
  assert.equal(failed.dirty, true)
})

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
