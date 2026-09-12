import assert from 'node:assert/strict'

import { randomUUID } from 'node:crypto'

import { test } from 'node:test'

import { requests } from '../../../packages/adapter-notes-dsh/src/rpc.ts'

import { Autosave } from '../../../packages/ui-notes/src/client/lib/autosave.ts'

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
