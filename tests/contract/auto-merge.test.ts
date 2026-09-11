import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import * as Notebook from '../../packages/provider-notebook-local/src/index.ts'
import { MergeAlgorithm } from '../../packages/adapter-merge-automerge/src/algorithm.ts'
import { AutomergeAdapter } from '../../packages/adapter-merge-automerge/lib/index.js'
import { versionHash } from '../../packages/storage-sync/src/index.ts'
import { Autosave } from '../../packages/ui-notes/src/client/lib/autosave.ts'
import type { Json, RecordVersion, VersionItem } from '../../packages/capability-sync/src/index.ts'
import type { NoteDto, SaveNoteRequest } from '../../packages/capability-note/src/index.ts'

const original = () => ({
  id: randomUUID(),
  title: '历史笔记',
  markdown: '第一段\n第二段\n',
  pinned: false,
  projectId: null,
  source: { kind: 'personal' as const, url: null, author: null, basedOn: [] },
})
function graph() {
  const id = randomUUID(),
    versions: VersionItem[] = []
  function add(parents: VersionItem[], patch: Record<string, Json> = {}, deleted = false) {
    const data = {
      ...original(),
      id,
      createdAt: '2026-09-10T00:00:00.000Z',
      updatedAt: '2026-09-10T00:00:00.000Z',
      deletedAt: deleted ? '2026-09-10T00:00:00.000Z' : null,
      ...((parents[0]?.value.data as object) ?? {}),
      ...patch,
    }
    const value: RecordVersion = {
      format: 1,
      type: 'note',
      id,
      schema: 1,
      parents: parents.map(v => v.hash).sort(),
      data,
      deleted,
      blobs: [],
    }
    const item = { hash: versionHash(value), value }
    versions.push(item)
    return item
  }
  function merged(parents: VersionItem[], algorithm = new MergeAlgorithm()) {
    const result = algorithm.merge({ heads: parents.map(v => v.hash), versions })
    return add(parents, result.data as Record<string, Json>, result.deleted)
  }
  return { add, merged, versions }
}

test('CRDT replay converges for reversed delivery, same-position edits, and late branches', () => {
  const g = graph(),
    base = g.add([])
  const left = g.add([base], { markdown: '第一段甲\n第二段\n', pinned: true })
  const right = g.add([base], { markdown: '第一段乙\n第二段补充\n', title: '新标题' })
  const merge = g.merged([left, right])
  const other = g.merged([right, left])
  assert.equal(merge.hash, other.hash)
  const data = merge.value.data as Record<string, Json>
  assert.equal(data.pinned, true)
  assert.equal(data.title, '新标题')
  assert.match(String(data.markdown), /甲/)
  assert.match(String(data.markdown), /乙/)
  const late = g.add([left], { markdown: '第一段甲继续\n第二段\n' })
  const complete = g.merged([merge, late])
  const final = complete.value.data as Record<string, Json>
  assert.match(String(final.markdown), /甲继续/)
  assert.match(String(final.markdown), /第二段补充/)
  assert.equal((String(final.markdown).match(/甲/g) ?? []).length, 1)
  const cached = new MergeAlgorithm()
  assert.equal(g.merged([left, right], cached).hash, merge.hash)
  assert.equal(g.merged([right, left], cached).hash, merge.hash)
})

test('deletion is edit-wins, unrelated fields and independent roots preserve all history', () => {
  const g = graph(),
    base = g.add([])
  const removed = g.add([base], { deletedAt: '2026-09-10T00:00:00.000Z' }, true)
  const edited = g.add([base], { markdown: '编辑保留' })
  const merged = g.merged([removed, edited])
  assert.equal(merged.value.deleted, false)
  assert.equal((merged.value.data as Record<string, Json>).deletedAt, null)
  assert.equal((merged.value.data as Record<string, Json>).markdown, '编辑保留')
  const secondRoot = g.add([], { markdown: '另一个根' })
  assert.doesNotThrow(() => g.merged([merged, secondRoot]))
})

test('worker runs off the Host thread and cancellation leaves its next invocation usable', async t => {
  const adapter = new AutomergeAdapter()
  t.after(() => adapter.dispose())
  const g = graph(),
    base = g.add([]),
    a = g.add([base], { markdown: 'a'.repeat(20000) }),
    b = g.add([base], { title: 'changed' })
  const controller = new AbortController()
  const task = adapter.merge({ heads: [a.hash, b.hash], versions: g.versions }, controller.signal)
  const assertion = assert.rejects(task)
  const survivorGraph = graph(),
    survivorBase = survivorGraph.add([])
  const survivorEdit = survivorGraph.add([survivorBase], { title: 'unrelated autosave' })
  const survivor = adapter.merge(
    { heads: [survivorBase.hash, survivorEdit.hash], versions: survivorGraph.versions },
    new AbortController().signal,
  )
  await new Promise(resolve => setTimeout(resolve, 20))
  controller.abort()
  await assertion
  assert.equal((await survivor).deleted, false)
  const small = graph(),
    x = small.add([]),
    y = small.add([x], { title: 'after cancellation' })
  assert.equal(
    (await adapter.merge({ heads: [x.hash, y.hash], versions: small.versions }, new AbortController().signal)).deleted,
    false,
  )
})

async function setup(t: import('node:test').TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'nook-auto-merge-'))
  const ctx = new Context()
  await ctx.plugin(Notebook, { file: join(root, 'notes.sqlite'), projectsFile: join(root, 'projects.json') })
  t.after(async () => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  return { ctx, root }
}

test('stale saves merge, idempotent retries retain input identity, history and restore are durable', async t => {
  const { ctx } = await setup(t)
  const base = await ctx.nookNotes.create(original())
  const left = await ctx.nookNotes.save({ ...base, markdown: '第一段补充\n第二段\n', requestId: randomUUID() })
  const request = { ...base, markdown: '第一段\n第二段补充\n', requestId: randomUUID() }
  const right = await ctx.nookNotes.save(request)
  assert.equal(right.note.markdown, '第一段补充\n第二段补充\n')
  assert.notEqual(right.submittedVersionId, right.note.versionId)
  assert.equal(ctx.nookSyncReplica.stats().conflicts, 0)
  const before = ctx.nookSyncReplica.snapshot()
  assert.deepEqual(await ctx.nookNotes.save(request), right)
  assert.deepEqual(ctx.nookSyncReplica.snapshot(), before)
  await assert.rejects(ctx.nookNotes.save({ ...request, markdown: 'different' }), /标识/)
  const continued = await ctx.nookNotes.save({
    ...right.note,
    versionId: right.submittedVersionId!,
    markdown: '第一段\n第二段补充继续\n',
    requestId: randomUUID(),
  })
  assert.equal(continued.note.markdown, '第一段补充\n第二段补充继续\n')
  const page = await ctx.nookNotes.history({ id: base.id, limit: 2 })
  assert.equal(page.entries.length, 2)
  assert.ok(page.cursor)
  const second = await ctx.nookNotes.history({ id: base.id, cursor: page.cursor!, limit: 100 })
  assert.ok(second.entries.some(v => v.versionId === base.versionId))
  assert.equal((await ctx.nookNotes.getHistoryVersion(base.id, left.submittedVersionId!)).markdown, left.note.markdown)
  const restore = { id: base.id, versionId: base.versionId!, requestId: randomUUID(), copy: false }
  const restored = await ctx.nookNotes.restoreHistoryVersion(restore)
  assert.equal(restored.markdown, base.markdown)
  assert.notEqual(restored.versionId, base.versionId)
  assert.deepEqual(await ctx.nookNotes.restoreHistoryVersion(restore), restored)
  const restoredHistory = await ctx.nookNotes.history({ id: base.id })
  assert.equal(restoredHistory.entries[0]!.kind, 'restore')
  assert.ok(restoredHistory.entries.some(v => v.kind === 'merge'))
  assert.ok(restoredHistory.entries.some(v => v.branchPoint))
  assert.equal(restoredHistory.entries.at(-1)!.kind, 'create')
  assert.equal(ctx.nookSyncReplica.records('note-checkpoint').length, 1)
  const copy = { ...restore, requestId: randomUUID(), copy: true }
  const copied = await ctx.nookNotes.restoreHistoryVersion(copy)
  assert.notEqual(copied.id, base.id)
  assert.equal((await ctx.nookNotes.restoreHistoryVersion(copy)).id, copied.id)
  assert.equal((await ctx.nookNotes.history({ id: copied.id })).entries[0]!.kind, 'create')
  assert.equal(ctx.nookSyncReplica.records('note-checkpoint').length, 1)
  assert.equal((await ctx.nookNotes.list({})).total, 2)
  await assert.rejects(ctx.nookNotes.getHistoryVersion(copied.id, base.versionId!), /不存在/)
})

test('a checkpoint failure rolls back the restored note, versions and request receipt together', async t => {
  const { DatabaseSync } = await import('node:sqlite')
  const { ctx, root } = await setup(t)
  const base = await ctx.nookNotes.create(original())
  const saved = await ctx.nookNotes.save({ ...base, markdown: '保留当前内容' })
  const before = ctx.nookSyncReplica.snapshot()
  const db = new DatabaseSync(join(root, 'notes.sqlite'))
  try {
    db.exec(`CREATE TRIGGER reject_checkpoint BEFORE INSERT ON sync_versions
      WHEN json_extract(NEW.body, '$.type') = 'note-checkpoint'
      BEGIN SELECT RAISE(ABORT, 'checkpoint blocked'); END`)
    const request = { id: base.id, versionId: base.versionId!, requestId: randomUUID(), copy: false }
    await assert.rejects(ctx.nookNotes.restoreHistoryVersion(request), /checkpoint blocked/)
    assert.deepEqual(await ctx.nookNotes.get(base.id), saved.note)
    assert.deepEqual(ctx.nookSyncReplica.snapshot(), before)
    db.exec('DROP TRIGGER reject_checkpoint')
    const restored = await ctx.nookNotes.restoreHistoryVersion(request)
    assert.equal(restored.markdown, base.markdown)
    assert.equal((await ctx.nookNotes.history({ id: base.id })).entries[0]!.kind, 'restore')
  } finally {
    db.close()
  }
})

test('checkpoint records reject malformed identity and mutation, and trash boundaries remain explicit', async t => {
  const { ctx } = await setup(t)
  const base = await ctx.nookNotes.create(original())
  assert.throws(
    () =>
      ctx.nookSyncReplica.writeRecords([
        {
          type: 'note-checkpoint',
          id: base.versionId!,
          schema: 1,
          expected: null,
          deleted: false,
          data: { noteId: base.id, versionId: 'bad', kind: 'restore' },
        },
      ]),
    /历史标记格式/,
  )
  const deleted = await ctx.nookNotes.setDeleted(base.id, base.revision, true)
  const recovered = await ctx.nookNotes.setDeleted(base.id, deleted.revision, false)
  assert.deepEqual(
    (await ctx.nookNotes.history({ id: base.id })).entries.map(v => v.kind),
    ['restore', 'delete', 'create'],
  )
  await ctx.nookNotes.restoreHistoryVersion({
    id: base.id,
    versionId: recovered.versionId!,
    requestId: randomUUID(),
    copy: false,
  })
  const marker = ctx.nookSyncReplica.records('note-checkpoint')[0]!
  assert.throws(
    () =>
      ctx.nookSyncReplica.writeRecords([
        {
          ...marker.value,
          expected: marker.hash,
        },
      ]),
    /历史标记格式/,
  )
})

test('backup failure aborts a stale write without changing the working note or its heads', async t => {
  const { ctx, root } = await setup(t)
  const base = await ctx.nookNotes.create(original())
  await rm(join(root, 'notes.sqlite.backups'), { recursive: true, force: true })
  await writeFile(join(root, 'notes.sqlite.backups'), 'blocked')
  const before = ctx.nookSyncReplica.snapshot()
  await assert.rejects(ctx.nookNotes.save({ ...base, markdown: 'new', requestId: randomUUID() }))
  assert.equal((await ctx.nookNotes.get(base.id))!.markdown, base.markdown)
  assert.deepEqual(ctx.nookSyncReplica.snapshot(), before)
})

test('autosave follows submitted branches while typing and retries the exact lost request', async () => {
  const base: NoteDto = {
    ...original(),
    versionId: 'a'.repeat(64),
    revision: 1,
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
    deletedAt: null,
  }
  const requests: SaveNoteRequest[] = []
  let release!: () => void
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const controller = new Autosave(
    base,
    async request => {
      requests.push(request)
      if (requests.length === 1) await gate
      return {
        note: { ...base, markdown: request.markdown + 'remote', versionId: 'c'.repeat(64), revision: 2 },
        submittedVersionId: 'b'.repeat(64),
      }
    },
    () => {},
  )
  controller.edit({ ...base, markdown: 'one' })
  const pending = controller.flush()
  controller.edit({ ...base, markdown: 'two' })
  release()
  assert.equal(await pending, true)
  assert.equal(requests[1]!.versionId, 'b'.repeat(64))
  assert.equal(controller.current.markdown, 'tworemote')
  let lost = true
  const retryRequests: SaveNoteRequest[] = []
  const retry = new Autosave(
    base,
    async request => {
      retryRequests.push(request)
      if (lost) {
        lost = false
        throw new Error('lost response')
      }
      return { note: { ...base, ...request, versionId: 'd'.repeat(64) }, submittedVersionId: 'd'.repeat(64) }
    },
    () => {},
  )
  retry.edit({ ...base, markdown: 'retained' })
  assert.equal(await retry.flush(), false)
  const draft = retry.draft
  assert.ok(draft.pending?.requestId)
  assert.equal(await retry.flush(), true)
  assert.deepEqual(retryRequests[0], retryRequests[1])
})

test('three devices converge without copies, recover after restart and synchronize restored history', async t => {
  const { synchronize } = await import('../../packages/feature-sync/src/engine.ts')
  const root = await mkdtemp(join(tmpdir(), 'nook-three-devices-'))
  const contexts: Context[] = []
  t.after(async () => {
    for (const ctx of contexts) await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  async function boot(name: string) {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(Notebook, {
      file: join(root, name, 'notes.sqlite'),
      projectsFile: join(root, name, 'projects.json'),
    })
    return ctx
  }
  const a = await boot('a'),
    b = await boot('b'),
    c = await boot('c')
  const objects = new Map<string, { bytes: Uint8Array; etag: string }>()
  let revision = 0,
    loseAcknowledgement = false
  const remote = {
    async probe() {},
    async get(path: string) {
      return objects.get(path) ?? null
    },
    async put(path: string, bytes: Uint8Array, expected: string | null) {
      const old = objects.get(path)
      if (expected === null ? !!old : expected !== old?.etag) return false
      objects.set(path, { bytes, etag: `"${++revision}"` })
      if (loseAcknowledgement && path === 'index.json') {
        loseAcknowledgement = false
        throw new Error('lost acknowledgement')
      }
      return true
    },
  }
  const run = (ctx: Context) =>
    synchronize(ctx.nookSyncReplica, remote, 'https://example.test/dav/', new AbortController().signal)
  const base = await a.nookNotes.create(original())
  await run(a)
  await run(b)
  await run(c)
  await a.nookNotes.save({ ...base, markdown: '第一段左\n第二段\n' })
  await b.nookNotes.save({ ...(await b.nookNotes.get(base.id))!, markdown: '第一段\n第二段右\n' })
  await c.nookNotes.save({ ...(await c.nookNotes.get(base.id))!, title: '三设备合并' })
  await Promise.all([run(a), run(b), run(c)])
  for (const ctx of [c, b, a, c]) await run(ctx)
  const merged = (await a.nookNotes.get(base.id))!
  assert.equal(merged.markdown, '第一段左\n第二段右\n')
  assert.equal(merged.title, '三设备合并')
  for (const ctx of [a, b, c]) {
    assert.equal((await ctx.nookNotes.list({})).total, 1)
    assert.equal((await ctx.nookNotes.get(base.id))!.versionId, merged.versionId)
    assert.equal(ctx.nookSyncReplica.stats().conflicts, 0)
    assert.equal(ctx.nookSyncReplica.stats().pending, 0)
  }
  const stable = a.nookSyncReplica.snapshot()
  await run(a)
  await run(b)
  assert.deepEqual(a.nookSyncReplica.snapshot(), stable)
  await a.fiber.dispose()
  const reopened = await boot('a')
  assert.equal((await reopened.nookNotes.get(base.id))!.versionId, merged.versionId)
  await b.nookNotes.setDeleted(base.id, (await b.nookNotes.get(base.id))!.revision, true)
  await reopened.nookNotes.save({
    ...(await reopened.nookNotes.get(base.id))!,
    markdown: merged.markdown + '删除同时继续编辑',
  })
  await run(b)
  await run(reopened)
  await run(b)
  assert.equal((await b.nookNotes.get(base.id))!.deletedAt, null)
  assert.match((await b.nookNotes.get(base.id))!.markdown, /删除同时继续编辑/)
  const restored = await reopened.nookNotes.restoreHistoryVersion({
    id: base.id,
    versionId: base.versionId!,
    requestId: randomUUID(),
    copy: false,
  })
  loseAcknowledgement = true
  await assert.rejects(run(reopened), /lost acknowledgement/)
  await run(reopened)
  await run(c)
  await run(b)
  assert.equal((await c.nookNotes.get(base.id))!.versionId, restored.versionId)
  assert.equal((await c.nookNotes.get(base.id))!.markdown, base.markdown)
  assert.equal((await c.nookNotes.getHistoryVersion(base.id, merged.versionId!)).markdown, merged.markdown)
  assert.equal((await c.nookNotes.history({ id: base.id })).entries[0]!.kind, 'restore')
  await c.fiber.dispose()
  const restarted = await boot('c')
  assert.equal((await restarted.nookNotes.history({ id: base.id })).entries[0]!.kind, 'restore')
})

test('merge rechecks heads after background computation and rolls back if its recovery backup fails', async t => {
  const { DatabaseSync } = await import('node:sqlite')
  const { Replica } = await import('../../packages/storage-sync/src/index.ts')
  const root = await mkdtemp(join(tmpdir(), 'nook-merge-race-'))
  const db = new DatabaseSync(join(root, 'db.sqlite'))
  const replica = new Replica(db, join(root, 'files'), join(root, 'backups'), () => {})
  t.after(async () => {
    replica.dispose()
    db.close()
    await rm(root, { recursive: true, force: true })
  })
  const g = graph(),
    base = g.add([]),
    left = g.add([base], { markdown: '第一段左\n第二段\n' }),
    right = g.add([base], { markdown: '第一段\n第二段右\n' })
  const algorithm = new MergeAlgorithm()
  let entered!: () => void, release!: () => void
  const started = new Promise<void>(resolve => {
    entered = resolve
  })
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  let calls = 0
  replica.registerType({
    type: 'note',
    schema: 1,
    validate: () => {},
    merge: async input => {
      if (++calls === 1) {
        entered()
        await gate
      }
      return algorithm.merge(input)
    },
  })
  const index = {
    format: 1 as const,
    vaultId: randomUUID(),
    generation: '1',
    heads: { [`note/${base.value.id}`]: [left.hash, right.hash] },
  }
  replica.receive(g.versions, index)
  const task = replica.reconcile()
  await started
  const latest = replica.capture(
    'note',
    base.value.id,
    { ...(left.value.data as object), markdown: '第一段左继续\n第二段\n' } as Json,
    false,
    [],
    [left.hash],
  )
  release()
  await task
  assert.equal(calls, 2)
  assert.equal((replica.records('note')[0]!.value.data as Record<string, Json>).markdown, '第一段左继续\n第二段右\n')
  assert.ok(replica.history('note', base.value.id).some(v => v.hash === latest))
  replica.capture(
    'note',
    base.value.id,
    { ...(right.value.data as object), title: 'another branch' } as Json,
    false,
    [],
    [right.hash],
  )
  const before = replica.snapshot(),
    working = replica.working('note', base.value.id)
  await rm(join(root, 'backups'), { recursive: true, force: true })
  await writeFile(join(root, 'backups'), 'blocked')
  await assert.rejects(replica.reconcile())
  assert.deepEqual(replica.snapshot(), before)
  assert.equal(replica.working('note', base.value.id), working)
})

test('IME composition pauses in-flight autosave adoption until its input is complete', async () => {
  const note: NoteDto = {
    ...original(),
    versionId: 'a'.repeat(64),
    revision: 1,
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
    deletedAt: null,
  }
  const requests: SaveNoteRequest[] = []
  let release!: () => void
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const autosave = new Autosave(
    note,
    async request => {
      requests.push(request)
      if (requests.length === 1) await gate
      return {
        note: { ...note, markdown: request.markdown + ' remote', versionId: 'c'.repeat(64) },
        submittedVersionId: 'b'.repeat(64),
      }
    },
    () => {},
  )
  autosave.edit({ ...note, markdown: 'before composition' })
  const pending = autosave.flush()
  autosave.pause()
  release()
  assert.equal(await pending, false)
  assert.equal(requests.length, 1)
  assert.equal(autosave.current.markdown, 'before composition')
  autosave.edit({ ...note, markdown: '中文输入完成' })
  autosave.resume()
  assert.equal(requests.length, 1, 'IME confirmation waits for the ordinary autosave schedule')
  assert.equal(await autosave.flush(), true)
  assert.equal(requests[1]!.versionId, 'b'.repeat(64))
  assert.equal(autosave.current.markdown, '中文输入完成 remote')
})

test('project text capacity fallback is deterministic and leaves source versions intact', () => {
  const id = randomUUID()
  const make = (description: string, parents: readonly string[]): VersionItem => {
    const value: RecordVersion = {
      type: 'project',
      id,
      schema: 1,
      format: 1,
      parents,
      blobs: [],
      deleted: false,
      data: {
        id,
        name: '项目',
        description,
        createdAt: '2026-09-10T00:00:00.000Z',
        updatedAt: '2026-09-10T00:00:00.000Z',
      },
    }
    return { hash: versionHash(value), value }
  }
  const base = make('', []),
    left = make('甲'.repeat(1500), [base.hash]),
    right = make('乙'.repeat(1500), [base.hash])
  const input = { heads: [left.hash, right.hash], versions: [base, left, right] }
  const result = new MergeAlgorithm().merge(input)
  assert.equal(String((result.data as Record<string, Json>).description).length, 1500)
  assert.deepEqual(new MergeAlgorithm().merge({ ...input, heads: [...input.heads].reverse() }), result)
  assert.equal((left.value.data as Record<string, Json>).description, '甲'.repeat(1500))
})

test('unchanged saves do not add history or timestamp-only branches, including stale baselines and retries', async t => {
  const { ctx } = await setup(t)
  const base = await ctx.nookNotes.create(original())
  const before = ctx.nookSyncReplica.snapshot()
  const requestId = randomUUID()
  const unchanged = await ctx.nookNotes.save({ ...base, requestId })
  assert.equal(unchanged.submittedVersionId, base.versionId)
  assert.deepEqual(ctx.nookSyncReplica.snapshot(), before)
  const edited = await ctx.nookNotes.save({ ...base, markdown: 'remote edit', requestId: randomUUID() })
  const after = ctx.nookSyncReplica.snapshot()
  const stale = await ctx.nookNotes.save({ ...base, requestId: randomUUID() })
  assert.equal(stale.note.markdown, edited.note.markdown)
  await ctx.nookNotes.save({ ...base, requestId })
  assert.deepEqual(ctx.nookSyncReplica.snapshot(), after)
})
