import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Autosave } from '../../../packages/ui-notes/src/client/lib/autosave.ts'
import type { NoteDto, SaveNoteRequest } from '../../../packages/capability-note/src/index.ts'

const note: NoteDto = {
  id: 'test',
  title: '',
  markdown: '',
  pinned: false,
  projectId: null,
  source: { kind: 'personal', url: null, author: null, basedOn: [] },
  createdAt: '2026-09-11T00:00:00Z',
  updatedAt: '2026-09-11T00:00:00Z',
  deletedAt: null,
  revision: 1,
  versionId: 'a'.repeat(64),
}
const settle = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}

test('continuous Chinese confirmations coalesce, a quiet pause saves once, unchanged input is silent', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 })
  const calls: SaveNoteRequest[] = []
  const controller = new Autosave(
    note,
    async request => {
      calls.push(request)
      return { note: { ...note, ...request }, submittedVersionId: note.versionId! }
    },
    () => {},
  )
  t.after(() => controller.dispose())
  for (let i = 1; i <= 20; i++) {
    controller.pause()
    controller.edit({ ...note, markdown: '文'.repeat(i) })
    controller.schedule()
    controller.resume()
    t.mock.timers.tick(500)
    await settle()
  }
  assert.equal(calls.length, 0)
  t.mock.timers.tick(2500)
  await settle()
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.markdown.length, 20)
  controller.pause()
  controller.resume()
  controller.edit(controller.current)
  controller.schedule()
  t.mock.timers.tick(30000)
  await settle()
  assert.equal(calls.length, 1)
})

test('continuous typing saves within 30 seconds, navigation flushes immediately and disposal cancels timers', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 })
  const calls: SaveNoteRequest[] = []
  const controller = new Autosave(
    note,
    async request => {
      calls.push(request)
      return { note: { ...note, ...request }, submittedVersionId: note.versionId! }
    },
    () => {},
  )
  for (let i = 0; i < 30; i++) {
    controller.edit({ ...note, markdown: String(i) })
    controller.schedule()
    t.mock.timers.tick(1000)
    await settle()
  }
  assert.equal(calls.length, 1)
  controller.edit({ ...note, markdown: 'navigation' })
  controller.schedule()
  assert.equal(await controller.flush(), true)
  assert.equal(calls.length, 2)
  controller.edit({ ...note, markdown: 'recoverable draft' })
  controller.schedule()
  controller.dispose()
  t.mock.timers.tick(30000)
  await settle()
  assert.equal(calls.length, 2)
  assert.equal(controller.draft.input.markdown, 'recoverable draft')
})

test('automatic saves wait for quiet input again after an in-flight edit; manual flush drains it', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 })
  let release!: () => void
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const calls: SaveNoteRequest[] = []
  const controller = new Autosave(
    note,
    async request => {
      calls.push(request)
      if (calls.length === 1) await gate
      return { note: { ...note, ...request }, submittedVersionId: 'b'.repeat(64) }
    },
    () => {},
  )
  t.after(() => controller.dispose())
  controller.edit({ ...note, markdown: 'first' })
  controller.schedule()
  t.mock.timers.tick(3000)
  await settle()
  controller.edit({ ...note, markdown: 'second' })
  controller.schedule()
  release()
  await settle()
  assert.equal(calls.length, 1)
  assert.equal(controller.dirty, true)
  await controller.flush()
  assert.equal(calls.length, 2)
  assert.equal(calls[1]!.versionId, 'b'.repeat(64))
})

test('a recovered lost request retries its exact identity even when the current note already shows its text', async () => {
  const requests: SaveNoteRequest[] = []
  const request: SaveNoteRequest = { ...note, versionId: 'b'.repeat(64), requestId: crypto.randomUUID() }
  const controller = new Autosave(
    note,
    async input => {
      requests.push(input)
      return { note, submittedVersionId: note.versionId! }
    },
    () => {},
  )
  controller.recover({ revision: 1, input: note, versionId: request.versionId, pending: request })
  assert.equal(await controller.flush(), true)
  assert.deepEqual(requests, [request])
  assert.equal(controller.dirty, false)
})
