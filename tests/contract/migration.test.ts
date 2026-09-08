import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import * as Notebook from '../../packages/provider-notebook-local/src/index.ts'
import Projects from '../../packages/provider-project-local/src/index.ts'
import { migrateData, migrationComplete, resumeMigrations } from '../../packages/storage-backup/src/migration.ts'
import { verifyBackup } from '../../packages/storage-backup/src/index.ts'

async function populate(root: string, title: string, id = randomUUID()) {
  const ctx = new Context()
  try {
    await ctx.plugin(Projects, { file: join(root, 'projects.json') })
    await ctx.plugin(Notebook, { file: join(root, 'notebook.sqlite') })
    const project = await ctx.nookProjects.create({ name: title })
    const note = await ctx.nookNotes.create({
      id,
      title,
      markdown: `${title}完整正文`,
      pinned: true,
      projectId: project.id,
      source: { kind: 'personal', url: null, author: null, basedOn: [] },
    })
    await ctx.nookKnowledge.setSession(title, { enabled: true, projectId: project.id })
    const trash = await ctx.nookNotes.create({ ...note, id: randomUUID() })
    const deleted = await ctx.nookNotes.setDeleted(trash.id, trash.revision, true)
    return { project, note, trash: deleted }
  } finally {
    await ctx.fiber.dispose()
  }
}

test('migration merges Web and desktop notes, FTS, projects, trash and files without overwriting originals', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nook-migration-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = join(root, 'web')
  const target = join(root, 'desktop')
  const output = join(root, 'backups')
  const web = await populate(source, '网页笔记')
  const desktop = await populate(target, '桌面笔记')
  writeFileSync(join(source, 'web-bytes'), 'web')
  writeFileSync(join(target, 'desktop-bytes'), 'desktop')
  const receipt = migrateData(source, target, output)!
  assert.equal(receipt.status, 'complete')
  assert.equal(migrationComplete(source, output), true)
  verifyBackup(receipt.sourceBackup)
  verifyBackup(receipt.targetBackup!)
  verifyBackup(receipt.mergedBackup)
  assert.equal(readFileSync(join(source, 'web-bytes'), 'utf8'), 'web')
  assert.equal(readFileSync(join(receipt.retained, 'desktop-bytes'), 'utf8'), 'desktop')
  assert.equal(readFileSync(join(target, 'web-bytes'), 'utf8'), 'web')
  assert.equal(readFileSync(join(target, 'desktop-bytes'), 'utf8'), 'desktop')
  const ctx = new Context()
  try {
    await ctx.plugin(Projects, { file: join(target, 'projects.json') })
    await ctx.plugin(Notebook, { file: join(target, 'notebook.sqlite') })
    for (const value of [web, desktop]) {
      assert.deepEqual(await ctx.nookNotes.get(value.note.id), value.note)
      assert.equal((await ctx.nookNotes.get(value.trash.id))?.deletedAt, value.trash.deletedAt)
      assert.deepEqual(await ctx.nookProjects.get(value.project.id), value.project)
      assert.equal((await ctx.nookKnowledge.search({ query: value.note.title }))[0]?.documentId, value.note.id)
      assert.equal((await ctx.nookKnowledge.session(value.note.title)).projectId, value.project.id)
    }
  } finally {
    await ctx.fiber.dispose()
  }
  assert.deepEqual(migrateData(source, target, output), receipt, 'Completed migration must not reimport old data')
})

test('divergent note IDs abort before publication and keep both verified backups', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nook-migration-conflict-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = join(root, 'web')
  const target = join(root, 'desktop')
  const output = join(root, 'backups')
  const id = randomUUID()
  await populate(source, 'source', id)
  const desktop = await populate(target, 'target', id)
  assert.throws(() => migrateData(source, target, output), /Migration conflict/)
  assert.equal(migrationComplete(source, output), false)
  for (const name of readdirSync(output)) verifyBackup(join(output, name))
  const ctx = new Context()
  try {
    await ctx.plugin(Notebook, { file: join(target, 'notebook.sqlite') })
    assert.deepEqual(await ctx.nookNotes.get(id), desktop.note)
  } finally {
    await ctx.fiber.dispose()
  }
})

test('prepared migration resumes the directory handoff after interruption', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nook-migration-resume-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = join(root, 'web')
  const target = join(root, 'desktop')
  const output = join(root, 'backups')
  mkdirSync(source)
  mkdirSync(target)
  writeFileSync(join(source, 'web'), 'retained')
  writeFileSync(join(target, 'desktop'), 'retained too')
  const receipt = migrateData(source, target, output)!
  renameSync(target, receipt.staging)
  const path = join(output, 'migrations', readdirSync(join(output, 'migrations'))[0]!)
  writeFileSync(path, JSON.stringify({ ...receipt, status: 'prepared' }))
  resumeMigrations(target, output)
  assert.equal(migrationComplete(source, output), true)
  assert.equal(readFileSync(join(target, 'web'), 'utf8'), 'retained')
  assert.equal(readFileSync(join(target, 'desktop'), 'utf8'), 'retained too')
})

test('migration refuses unknown notebook tables before replacing the desktop store', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nook-migration-schema-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = join(root, 'web')
  const target = join(root, 'desktop')
  await populate(source, 'web')
  const db = new DatabaseSync(join(source, 'notebook.sqlite'))
  db.exec("CREATE TABLE future_user_data(value TEXT); INSERT INTO future_user_data VALUES ('preserve')")
  db.close()
  assert.throws(() => migrateData(source, target, join(root, 'backups')), /Unsupported notebook table/)
  assert.throws(() => readdirSync(target), { code: 'ENOENT' })
})
