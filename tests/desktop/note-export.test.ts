import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { test } from 'node:test'
import { NoteExports } from '../../apps/desktop/src/note-export.ts'

test('note exports preserve existing files, mint reveal receipts, validate input and confine filenames', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nook-export-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const exports = new NoteExports(root)
  await writeFile(join(root, '笔记.md'), 'existing')
  const receipts = await Promise.all([
    exports.save({ name: '笔记.md', markdown: '一' }),
    exports.save({ name: '笔记.md', markdown: '二' }),
  ])
  assert.notEqual(receipts[0]!.name, receipts[1]!.name)
  assert.equal(await readFile(join(root, '笔记.md'), 'utf8'), 'existing')
  assert.equal(await readFile(exports.path(receipts[0]!.id), 'utf8'), '一')
  const escaped = await exports.save({ name: '../../路径\u0000.md', markdown: 'safe' })
  assert.equal(dirname(exports.path(escaped.id)), root)
  assert.throws(() => exports.path(join(root, '笔记.md')), /过期/)
  await assert.rejects(exports.save({ name: 'bad', markdown: 'x'.repeat(501_001) }), /无效/)
  exports.dispose()
  assert.throws(() => exports.path(receipts[0]!.id), /过期/)
  const blocked = new NoteExports(join(root, '笔记.md'))
  await assert.rejects(blocked.save({ name: 'bad.md', markdown: 'failed' }))
})
