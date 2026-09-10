import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { NoteHistoryEntry } from '../../packages/capability-note/src/index.ts'
import { historyStages } from '../../packages/ui-notes/src/client/lib/note-history.ts'

function entry(id: number, minutes: number, patch: Partial<NoteHistoryEntry> = {}): NoteHistoryEntry {
  return {
    versionId: String(id),
    title: '笔记',
    updatedAt: new Date(minutes * 60_000).toISOString(),
    parents: [String(id - 1)],
    deleted: false,
    merged: false,
    kind: 'save',
    branchPoint: false,
    ...patch,
  }
}
const ids = (entries: NoteHistoryEntry[]) => historyStages(entries).map(g => g.entries.map(e => e.versionId))

test('continuous edits collapse across raw pages without dropping versions or changing stage identity', () => {
  const versions = [entry(5, 10), entry(4, 9), entry(3, 8), entry(2, 3), entry(1, 0, { kind: 'create', parents: [] })]
  assert.deepEqual(ids(versions), [['5', '4', '3'], ['2'], ['1']])
  const first = historyStages(versions.slice(0, 2))
  const full = historyStages([...versions.slice(0, 2), ...versions.slice(1)])
  assert.equal(full[0]!.id, first[0]!.id)
  assert.deepEqual(
    full.flatMap(g => g.entries),
    versions,
  )
})

test('checkpoints, branch points and unrelated branches stay outside editing stages', () => {
  for (const patch of [
    { kind: 'create' as const },
    { kind: 'merge' as const, merged: true },
    { kind: 'delete' as const, deleted: true },
    { kind: 'restore' as const },
    { branchPoint: true },
  ])
    assert.deepEqual(ids([entry(3, 3), entry(2, 2, patch), entry(1, 1)]), [['3'], ['2'], ['1']])
  assert.deepEqual(ids([entry(3, 3, { parents: ['1'] }), entry(2, 2), entry(1, 1, { branchPoint: true })]), [
    ['3'],
    ['2'],
    ['1'],
  ])
})

test('five-minute pauses and reversed or invalid clocks split stages while equal timestamps can group', () => {
  assert.deepEqual(ids([entry(2, 5), entry(1, 0)]), [['2'], ['1']])
  assert.deepEqual(ids([entry(2, 0), entry(1, 1)]), [['2'], ['1']])
  assert.deepEqual(ids([entry(2, 0), entry(1, 0, { updatedAt: 'invalid' })]), [['2'], ['1']])
  assert.deepEqual(ids([entry(2, 0), entry(1, 0)]), [['2', '1']])
})
