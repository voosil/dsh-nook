import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { Refiner, semanticContent, paragraphChanges } from '../../../packages/feature-refinement/src/refiner.ts'
import { MemoryTaskStore } from '../../helpers/services/task-store.ts'
import { defaultSettings, taskInputSchema } from '../../../packages/capability-task/src/index.ts'
import type { NoteDto, NoteService } from '../../../packages/capability-note/src/index.ts'
import type { GenerationService } from '../../../packages/capability-generation/src/index.ts'
const knowledge = {
  search: async () => [],
  session: async () => ({ enabled: false, projectId: null }),
  setSession: async () => ({ enabled: false, projectId: null }),
}
function fixture() {
  const store = new MemoryTaskStore(),
    note: NoteDto = {
      id: randomUUID(),
      title: 'Pool',
      markdown: '需要统一 UI 组件',
      revision: 1,
      createdAt: '2026-09-10T00:00:00Z',
      updatedAt: '2026-09-10T00:00:00Z',
      deletedAt: null,
      pinned: false,
      projectId: null,
      source: { kind: 'personal', url: null, author: null, basedOn: [] },
    }
  store.write([
    {
      type: 'task-settings',
      value: {
        ...defaultSettings(),
        revision: 1,
        ownerId: store.deviceId,
        watchNotes: [note.id],
        routes: { planning: { provider: 'test', model: 'planner' } },
      },
    },
  ])
  const notes = {
    get: async () => ({ ...note }),
    list: async () => ({ notes: [{ ...note }], total: 1 }),
  } as unknown as NoteService
  let calls = 0,
    fail = false,
    during: (() => void) | undefined
  const generate: GenerationService = {
    models: async () => [],
    generate: async () => {
      calls++
      during?.()
      if (fail) throw new Error('offline')
      return JSON.stringify({
        summary: note.markdown,
        claims: [{ text: note.markdown, origin: 'user', relation: 'idea', related: [] }],
        proposals: [
          {
            topic: '组件统一',
            summary: note.markdown,
            scope: '组件库',
            consequences: '先规范后迁移',
            decision: '接受这个范围',
            ready: true,
            steps: [
              {
                key: 'build',
                after: [],
                task: taskInputSchema.parse({
                  title: '建立 UI 组件',
                  assignee: 'agent',
                  description: '统一基础组件',
                  acceptance: '页面可使用',
                }),
              },
            ],
          },
        ],
      })
    },
  }
  const refiner = new Refiner(store, notes, knowledge, generate)
  return {
    store,
    note,
    refiner,
    get calls() {
      return calls
    },
    fail(value: boolean) {
      fail = value
    },
    during(value: () => void) {
      during = value
    },
  }
}
test('initial understanding debounces, ignores formatting, and updates the same topic', async () => {
  const f = fixture(),
    now = Date.parse('2026-09-10T01:00:00Z')
  await f.refiner.tick(now)
  assert.equal(f.calls, 0)
  await f.refiner.tick(now + 120001)
  assert.equal(f.calls, 1)
  assert.equal(f.store.get('task-understanding', f.note.id)!.version, '1')
  const first = f.store.list('task-proposal')[0]!
  f.note.markdown = '  需要统一 UI 组件  '
  f.note.revision++
  await f.refiner.tick(now + 130000)
  assert.equal(f.calls, 1)
  assert.equal(f.store.get('task-proposal', first.id)!.sources[0]!.version, '2')
  assert.equal(f.store.list('task-notification').length, 1)
  f.note.markdown = '需要统一 UI 组件，但先不迁移旧页面'
  f.note.revision++
  await f.refiner.tick(now + 140000)
  await f.refiner.tick(now + 270001)
  assert.equal(f.calls, 2)
  assert.equal(f.store.list('task-proposal').length, 1)
  assert.equal(f.store.list('task-proposal')[0]!.id, first.id)
  assert.equal(f.store.list('task-proposal')[0]!.revision, 3)
  await f.refiner.dispose()
})
test('failed or stale generation does not advance understanding baseline', async () => {
  const f = fixture(),
    now = Date.parse('2026-09-10T01:00:00Z')
  f.fail(true)
  await f.refiner.tick(now, true)
  assert.equal(f.store.get('task-understanding', f.note.id)!.version, '')
  assert.equal(f.store.list('task-proposal').length, 0)
  f.fail(false)
  f.during(() => {
    f.note.revision++
  })
  await f.refiner.tick(now + 130000, true)
  assert.equal(f.store.get('task-understanding', f.note.id)!.version, '')
  await f.refiner.dispose()
})
test('approved proposals remain immutable and later changes become new proposals', async () => {
  const f = fixture(),
    now = Date.parse('2026-09-10T01:00:00Z')
  await f.refiner.tick(now, true)
  const old = f.store.list('task-proposal')[0]!
  f.store.write([{ type: 'task-proposal', value: { ...old, status: 'approved', planId: randomUUID() } }])
  f.note.markdown = '新方向：先设计规范，再构建组件'
  f.note.revision++
  await f.refiner.tick(now + 150000, true)
  assert.equal(f.store.list('task-proposal').length, 2)
  assert.equal(f.store.get('task-proposal', old.id)!.summary, old.summary)
  await f.refiner.dispose()
})
test('deleted input and removed paragraphs preserve the distinction from appended text', () => {
  assert.equal(semanticContent({ title: 'x', markdown: 'old', deletedAt: 'now' }), '[deleted]')
  assert.deepEqual(paragraphChanges('旧决定\n\n保留内容', '保留内容\n\n新决定'), {
    removed: ['旧决定'],
    added: ['新决定'],
    reordered: false,
  })
})

test('completed plans become versioned derived sources and do not repeat refinement after restart', async () => {
  const f = fixture(),
    now = Date.parse('2026-09-10T01:00:00Z')
  const { newTask } = await import('../../../packages/feature-tasks/src/engine.ts')
  const task = newTask(
    randomUUID(),
    taskInputSchema.parse({ title: '组件库', sources: [{ noteId: f.note.id, version: '1', excerpt: '统一组件' }] }),
    now,
    0,
  )
  task.status = 'done'
  task.artifactRevision = 1
  task.report = {
    summary: '完成组件库',
    artifacts: [{ name: '组件', uri: '/tmp/fixture-components', version: '1' }],
    checks: [{ name: '构建', passed: true, evidence: '通过' }],
  }
  f.store.write([{ type: 'task', value: task }])
  await f.refiner.tick(now, true)
  const sources = f.store.list('task-retrospective')
  assert.equal(sources.length, 1)
  assert.equal(f.store.get('task-understanding', sources[0]!.id)!.version, sources[0]!.version)
  const count = f.calls
  await f.refiner.tick(now + 150000)
  assert.equal(f.calls, count)
  assert.equal(f.store.list('task-retrospective').length, 1)
  await f.refiner.dispose()
})

test('incremental comparison preserves nested lists, indented code and repeated paragraph changes', () => {
  assert.notEqual(
    semanticContent({ title: '', markdown: '- a\n  - b', deletedAt: null }),
    semanticContent({ title: '', markdown: '- a\n- b', deletedAt: null }),
  )
  assert.notEqual(
    semanticContent({ title: '', markdown: '    code', deletedAt: null }),
    semanticContent({ title: '', markdown: 'code', deletedAt: null }),
  )
  assert.deepEqual(paragraphChanges('same\n\nsame', 'same'), { removed: ['same'], added: [], reordered: false })
})
