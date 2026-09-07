import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context, Service } from '@deepseek-ai/cordis'
import Registry from '@deepseek-ai/dsh-typert-registry'
import SystemPrompt, { renderContextSnapshot } from '@deepseek-ai/dsh-system-prompt'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as Notebook from '../../packages/provider-notebook-local/src/index.ts'
import Projects from '../../packages/provider-project-local/src/index.ts'
import Knowledge from '../../packages/adapter-knowledge-dsh/src/index.ts'
import * as Generation from '../../packages/adapter-intelligence-dsh/src/index.ts'
import Reflection from '../../packages/feature-reflection/src/index.ts'
import Video from '../../packages/feature-video/src/index.ts'
import VideoSource from '../../packages/adapter-video-platform/src/index.ts'
import * as VideoEditor from '../../packages/provider-video-editor/src/index.ts'

test('standalone knowledge plugin follows session/project switch and safely renders literal template syntax', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nook-knowledge-'))
  const ctx = new Context()
  try {
    await ctx.plugin(Registry)
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
    await ctx.plugin(Projects, { file: join(root, 'projects.json') })
    await ctx.plugin(Notebook, { file: join(root, 'notes.sqlite') })
    const plugin = await ctx.plugin(Knowledge)
    const project = await ctx.nookProjects.create({ name: '哲学' })
    const note = await ctx.nookNotes.create({
      id: randomUUID(),
      title: '劳动异化',
      markdown: '劳动异化的例子，包含模板符号 {{not-a-variable}}。',
      projectId: project.id,
      pinned: false,
      source: { kind: 'personal', url: null, author: null, basedOn: [] },
    })
    const sessionId = 'fixture-session'
    const agent = {
      id: sessionId,
      session: {
        deriveMessages: () => [
          createUserMessage({ content: [{ type: 'text', text: '劳动异化' }], source: { kind: 'user' } }),
        ],
      },
    }
    const assembly = () => ctx.systemPrompt.assemble({ agent } as Parameters<typeof ctx.systemPrompt.assemble>[0])
    assert.equal(renderContextSnapshot(await assembly()), '')
    await ctx.nookKnowledge.setSession(sessionId, { enabled: true, projectId: project.id })
    const text = renderContextSnapshot(await assembly())
    assert.ok(text.includes(note.id))
    assert.ok(text.includes('{{not-a-variable}}'))
    await ctx.nookKnowledge.setSession(sessionId, { enabled: true, projectId: randomUUID() })
    assert.ok(!renderContextSnapshot(await assembly()).includes(note.id))
    await ctx.nookKnowledge.setSession(sessionId, { enabled: false, projectId: null })
    assert.equal(renderContextSnapshot(await assembly()), '')
    await plugin.dispose()
    assert.equal(renderContextSnapshot(await assembly()), '')
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

test('generation accepts only complete visible text and reflection retains source revisions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nook-reflection-'))
  const ctx = new Context()
  let finish = 'stop'
  try {
    await ctx.plugin(
      class Llm extends Service {
        constructor(ctx: Context) {
          super(ctx, 'llm')
        }
        listProviders() {
          return [{ id: 'fixture', name: 'Fixture' }]
        }
        async listModels() {
          return [{ provider: 'fixture', id: 'model', name: 'Model' }]
        }
        async *stream() {
          yield { type: 'reasoning-delta', index: 0, text: 'hidden' }
          yield { type: 'text-delta', index: 1, text: '学习复盘' }
          yield { type: 'block-end', index: 1, block: { type: 'text', text: '学习复盘' } }
          yield { type: 'finish', reason: { kind: finish } }
        }
      },
    )
    await ctx.plugin(Generation)
    await ctx.plugin(Notebook, { file: join(root, 'notes.sqlite') })
    await ctx.plugin(Reflection)
    const note = await ctx.nookNotes.create({
      id: randomUUID(),
      title: '学习',
      markdown: '完整的学习记录。',
      projectId: null,
      pinned: false,
      source: { kind: 'personal', url: null, author: null, basedOn: [] },
    })
    const preview = await ctx.nookReflection.summarize(
      {
        from: '2000-01-01T00:00:00.000Z',
        to: '2100-01-01T00:00:00.000Z',
        provider: 'fixture',
        model: 'model',
        projectId: null,
        title: '日总结',
      },
      new AbortController().signal,
    )
    assert.equal(preview.markdown, '学习复盘')
    assert.deepEqual(preview.basedOn, [{ noteId: note.id, revision: 1 }])
    assert.equal((await ctx.nookNotes.list({})).total, 1, 'preview does not silently become a note')
    finish = 'max-tokens'
    await assert.rejects(
      ctx.nookGeneration.generate(
        { provider: 'fixture', model: 'model', instruction: 'test', text: 'test' },
        new AbortController().signal,
      ),
      /完整/,
    )
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

test('real Python collector feeds video workflow from cached cards with source identity and retry deduplication', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nook-video-'))
  const ctx = new Context()
  try {
    const folder = join(root, 'videos', 'bilibili-BV1YV4y1L7rx')
    await mkdir(folder, { recursive: true })
    await writeFile(
      join(folder, 'metadata.json'),
      JSON.stringify({ title: '知识与实践', aid: 1, owner: { name: '作者' }, pages: [] }),
    )
    await writeFile(
      join(folder, 'comments.json'),
      JSON.stringify({
        items: [
          {
            id: '12',
            note_expanded: true,
            author: '笔记者',
            text: '原笔记的完整解释。'.repeat(40),
            markdown: '原笔记的完整解释。'.repeat(40),
            likes: 10,
          },
        ],
      }),
    )
    await ctx.plugin(Notebook, { file: join(root, 'notes.sqlite') })
    await ctx.plugin(Projects, { file: join(root, 'projects.json') })
    await ctx.plugin(
      class Gen extends Service {
        constructor(ctx: Context) {
          super(ctx, 'nookGeneration')
        }
        async models() {
          return []
        }
        async generate() {
          throw new Error('local acquisition must not call a model')
        }
      },
    )
    await ctx.plugin(VideoSource, { root: join(root, 'videos'), python: 'python3' })
    await ctx.plugin(VideoEditor, { cache: join(root, 'cache') })
    await ctx.plugin(Video)
    const request = {
      id: randomUUID(),
      url: 'BV1YV4y1L7rx',
      projectId: null,
      strategy: 'local' as const,
      write: false,
      skill: 'video-to-essay',
      provider: '',
      model: '',
    }
    async function run(id: string) {
      await ctx.nookVideo.start({ ...request, id })
      for (let i = 0; i < 200; i++) {
        const job = await ctx.nookVideo.get(id)
        if (job?.status !== 'running') return job
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      throw new Error('video job timed out')
    }
    const job = await run(request.id)
    assert.equal(job?.status, 'done', job?.error ?? '')
    const note = await ctx.nookNotes.get(job!.noteIds[0]!)
    assert.equal(note?.source.kind, 'comment-note')
    assert.equal(note?.source.author, '笔记者')
    assert.equal(note?.source.url, 'https://www.bilibili.com/video/BV1YV4y1L7rx')
    assert.equal((await run(randomUUID()))?.status, 'done')
    assert.equal((await ctx.nookNotes.list({})).total, 1)
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

test('video writer applies its skill, revises failed audits, caches successful steps and fails closed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nook-editor-'))
  const ctx = new Context()
  let calls = 0,
    audits = 0,
    invalid = false
  const instructions: string[] = []
  try {
    await ctx.plugin(
      class Gen extends Service {
        constructor(ctx: Context) {
          super(ctx, 'nookGeneration')
        }
        async models() {
          return []
        }
        async generate(request: { instruction: string; text: string }, signal: AbortSignal) {
          signal.throwIfAborted()
          calls++
          instructions.push(request.instruction)
          if (request.instruction.startsWith('建立本段')) return '概念、论证、例子和限定清单'
          if (request.instruction.startsWith('对照原文与信息清单')) {
            if (invalid) return 'not-json'
            return ++audits === 1 ? '{"pass":false,"issues":["例子遗漏"]}' : '{"pass":true,"issues":[]}'
          }
          return request.text.includes('对照原文修订') ? '正文保留了概念、推理和完整例子。' : '初稿遗漏例子。'
        }
      },
    )
    await ctx.plugin(VideoEditor, { cache: join(root, 'cache') })
    const request = {
      provider: 'fixture',
      model: 'model',
      title: '实践论',
      text: '实践的概念、具体推理和一个完整例子。',
      skill: 'video-to-essay',
    }
    const result = await ctx.nookVideoWriter.write(request, new AbortController().signal)
    assert.equal(result, '正文保留了概念、推理和完整例子。')
    assert.equal(audits, 2)
    assert.ok(instructions.some(value => value.includes('原文的“为什么”是否还在')))
    const previousCalls = calls
    assert.equal(await ctx.nookVideoWriter.write(request, new AbortController().signal), result)
    assert.equal(calls, previousCalls, 'identical retry reuses successful cached generation')
    invalid = true
    await assert.rejects(
      ctx.nookVideoWriter.write({ ...request, model: 'malformed' }, new AbortController().signal),
      /无效格式/,
    )
    const aborted = new AbortController()
    aborted.abort()
    await assert.rejects(ctx.nookVideoWriter.write(request, aborted.signal), { name: 'AbortError' })
    assert.equal(calls, previousCalls + 3, 'aborted generation never reaches the model')
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

test('video cancellation retains acquired source while preventing a completed AI article', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nook-video-cancel-'))
  const ctx = new Context()
  let writing!: () => void
  const enteredWriting = new Promise<void>(resolve => {
    writing = resolve
  })
  try {
    await ctx.plugin(Notebook, { file: join(root, 'notes.sqlite') })
    await ctx.plugin(Projects, { file: join(root, 'projects.json') })
    await ctx.plugin(
      class Source extends Service {
        constructor(ctx: Context) {
          super(ctx, 'nookVideoSource')
        }
        async collect() {
          return {
            url: 'https://www.youtube.com/watch?v=abcdefghijk',
            title: '学习',
            author: '作者',
            transcript: '一段完整来源',
            candidates: [],
            warnings: [],
          }
        }
      },
    )
    await ctx.plugin(
      class Review extends Service {
        constructor(ctx: Context) {
          super(ctx, 'nookVideoReview')
        }
        async select() {
          return null
        }
      },
    )
    await ctx.plugin(
      class Writer extends Service {
        constructor(ctx: Context) {
          super(ctx, 'nookVideoWriter')
        }
        async skills() {
          return []
        }
        async write(_request: unknown, signal: AbortSignal) {
          writing()
          return new Promise<string>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          })
        }
      },
    )
    const feature = await ctx.plugin(Video)
    const id = randomUUID()
    await ctx.nookVideo.start({
      id,
      url: 'https://www.youtube.com/watch?v=abcdefghijk',
      projectId: null,
      strategy: 'none',
      write: true,
      skill: 'fixture',
      provider: 'fixture',
      model: 'fixture',
    })
    await enteredWriting
    assert.equal((await ctx.nookNotes.list({})).notes[0]?.source.kind, 'transcript')
    await feature.dispose()
    assert.equal(
      (await ctx.nookNotes.list({})).total,
      1,
      'disposing an active workflow preserves sources without creating a partial article',
    )
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
