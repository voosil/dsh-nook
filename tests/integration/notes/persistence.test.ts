import assert from 'node:assert/strict'

import { randomUUID } from 'node:crypto'

import { mkdtemp, rm } from 'node:fs/promises'

import { tmpdir } from 'node:os'

import { join } from 'node:path'

import { test } from 'node:test'

import { Context } from '@deepseek-ai/cordis'

import * as Notebook from '../../../packages/provider-notebook-local/src/index.ts'

import type { CreateNoteRequest } from '../../../packages/capability-note/src/index.ts'

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
