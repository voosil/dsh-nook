import assert from 'node:assert/strict'

import { randomUUID } from 'node:crypto'

import { mkdtemp, rm } from 'node:fs/promises'

import { tmpdir } from 'node:os'

import { join } from 'node:path'

import { test } from 'node:test'

import { Context, Service } from '@deepseek-ai/cordis'

import Registry from '@deepseek-ai/dsh-typert-registry'

import Gateway from '@deepseek-ai/dsh-api-gateway'

import * as Notebook from '../../../packages/provider-notebook-local/src/index.ts'

import Projects from '../../../packages/provider-project-local/src/index.ts'

import Feature from '../../../packages/feature-notes/src/index.ts'

import Reflection from '../../../packages/feature-reflection/src/index.ts'

import Video from '../../../packages/feature-video/src/index.ts'

import VideoSource from '../../../packages/adapter-video-platform/src/index.ts'

import * as VideoEditor from '../../../packages/provider-video-editor/src/index.ts'

import Rpc from '../../../packages/adapter-notes-dsh/src/index.ts'

import type { CreateNoteRequest, NoteDto } from '../../../packages/capability-note/src/index.ts'

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
