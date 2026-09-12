import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import * as Notebook from '../../../packages/provider-notebook-local/src/index.ts'
import Projects from '../../../packages/provider-project-local/src/index.ts'
import { migrateData, migrationComplete, resumeMigrations } from '../../../packages/storage-backup/src/migration.ts'
import { verifyBackup } from '../../../packages/storage-backup/src/index.ts'

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

test('migration preserves a complete sync library and refuses to combine distinct sync histories', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nook-sync-migration-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = join(root, 'source'),
    target = join(root, 'target'),
    other = join(root, 'other')
  async function create(dir: string) {
    const ctx = new Context()
    await ctx.plugin(Notebook, { file: join(dir, 'notebook.sqlite'), projectsFile: join(dir, 'projects.json') })
    await ctx.nookProjects.create({ name: dir })
    ctx.nookSyncReplica.bind('https://example.com/dav/', randomUUID())
    const snapshot = ctx.nookSyncReplica.snapshot(),
      binding = ctx.nookSyncReplica.binding()
    await ctx.fiber.dispose()
    return { snapshot, binding }
  }
  const expected = await create(source)
  migrateData(source, target, join(root, 'backups'))
  const ctx = new Context()
  await ctx.plugin(Notebook, { file: join(target, 'notebook.sqlite'), projectsFile: join(target, 'projects.json') })
  assert.deepEqual(ctx.nookSyncReplica.snapshot(), expected.snapshot)
  assert.deepEqual(ctx.nookSyncReplica.binding(), expected.binding)
  await ctx.fiber.dispose()
  await create(other)
  assert.throws(() => migrateData(other, target, join(root, 'backups')), /Cannot automatically merge/)
})

async function initializeSyncNotebook(directory: string) {
  const ctx = new Context()
  await ctx.plugin(Notebook, {
    file: join(directory, 'notebook.sqlite'),
    projectsFile: join(directory, 'projects.json'),
  })
  return ctx
}

test('legacy Web data migrates into an initialized empty sync notebook and upgrades on boot', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nook-empty-sync-migration-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = join(root, 'web'),
    target = join(root, 'desktop'),
    output = join(root, 'backups')
  const web = await populate(source, '旧网页笔记')
  await (await initializeSyncNotebook(target)).fiber.dispose()
  writeFileSync(join(target, 'desktop-bytes'), 'keep target files')
  const before = readFileSync(join(source, 'notebook.sqlite'))
  const receipt = migrateData(source, target, output)!
  for (const backup of [receipt.sourceBackup, receipt.targetBackup!, receipt.mergedBackup]) verifyBackup(backup)
  assert.equal(migrationComplete(source, output), true)
  assert.deepEqual(readFileSync(join(source, 'notebook.sqlite')), before)
  assert.equal(readFileSync(join(target, 'desktop-bytes'), 'utf8'), 'keep target files')
  const retained = new DatabaseSync(join(receipt.retained, 'notebook.sqlite'), { readOnly: true })
  assert.equal(retained.prepare('SELECT count(*) AS count FROM notes').get()!.count, 0)
  retained.close()
  const ctx = await initializeSyncNotebook(target)
  try {
    for (const note of [web.note, web.trash])
      assert.deepEqual(await ctx.nookNotes.get(note.id), {
        ...note,
        versionId: ctx.nookSyncReplica.records('note').find(item => item.value.id === note.id)!.hash,
      })
    assert.deepEqual(await ctx.nookProjects.get(web.project.id), web.project)
    assert.equal((await ctx.nookKnowledge.search({ query: web.note.title }))[0]?.documentId, web.note.id)
    assert.equal((await ctx.nookKnowledge.session(web.note.title)).projectId, web.project.id)
    assert.ok(ctx.nookSyncReplica.records('project').some(item => item.value.id === web.project.id))
    assert.ok(ctx.nookSyncReplica.records('note').some(item => item.value.id === web.note.id))
    assert.deepEqual(migrateData(source, target, output), receipt)
  } finally {
    await ctx.fiber.dispose()
  }
})

test('complete sync history and binding can migrate into an initialized empty target', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nook-empty-sync-history-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = join(root, 'source'),
    target = join(root, 'target')
  const incoming = await initializeSyncNotebook(source)
  await incoming.nookProjects.create({ name: 'synced project' })
  incoming.nookSyncReplica.bind('https://example.com/dav/', randomUUID())
  const snapshot = incoming.nookSyncReplica.snapshot(),
    binding = incoming.nookSyncReplica.binding()
  await incoming.fiber.dispose()
  await (await initializeSyncNotebook(target)).fiber.dispose()
  migrateData(source, target, join(root, 'backups'))
  const current = await initializeSyncNotebook(target)
  try {
    assert.deepEqual(current.nookSyncReplica.snapshot(), snapshot)
    assert.deepEqual(current.nookSyncReplica.binding(), binding)
  } finally {
    await current.fiber.dispose()
  }
})

test('an empty legacy notebook does not permit replacing projects held outside SQLite', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nook-legacy-target-migration-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = join(root, 'source'),
    target = join(root, 'target'),
    output = join(root, 'backups')
  await (await initializeSyncNotebook(source)).fiber.dispose()
  const ctx = new Context()
  try {
    await ctx.plugin(Projects, { file: join(target, 'projects.json') })
    await ctx.plugin(Notebook, { file: join(target, 'notebook.sqlite') })
    await ctx.nookProjects.create({ name: 'legacy target project' })
  } finally {
    await ctx.fiber.dispose()
  }
  const before = readFileSync(join(target, 'projects.json'))
  assert.throws(() => migrateData(source, target, output), /Cannot automatically merge/)
  assert.deepEqual(readFileSync(join(target, 'projects.json')), before)
  assert.equal(migrationComplete(source, output), false)
})

for (const [name, sql] of Object.entries({
  binding: "INSERT INTO sync_state VALUES('binding','{}')",
  history: "INSERT INTO sync_versions VALUES('retained','{}',0)",
  epochArchive: "INSERT INTO sync_epoch_archive VALUES('legacy','retained',X'01')",
  heads: "INSERT INTO sync_heads VALUES('retained','hash')",
  working: "INSERT INTO sync_working VALUES('retained','hash')",
  preferences: "INSERT INTO knowledge_sessions VALUES('session',1,NULL)",
  project: "INSERT INTO projects VALUES('retained','{}',1)",
  unknownState: "INSERT INTO sync_state VALUES('future-state','1')",
  nullState: "INSERT INTO sync_state VALUES(NULL,'1')",
  unfinishedProjectImport: "DELETE FROM sync_state WHERE key='projects-migrated'",
  unknownTable: 'CREATE TABLE future_user_data(value TEXT)',
})) {
  test(`empty-target migration refuses a target with ${name}`, async t => {
    const root = mkdtempSync(join(tmpdir(), 'nook-not-empty-migration-'))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const source = join(root, 'source'),
      target = join(root, 'target'),
      output = join(root, 'backups')
    await populate(source, 'legacy')
    await (await initializeSyncNotebook(target)).fiber.dispose()
    const db = new DatabaseSync(join(target, 'notebook.sqlite'))
    db.exec(sql)
    db.close()
    const before = readFileSync(join(target, 'notebook.sqlite'))
    assert.throws(() => migrateData(source, target, output), /Cannot automatically merge|Unsupported notebook table/)
    assert.deepEqual(readFileSync(join(target, 'notebook.sqlite')), before)
    assert.equal(migrationComplete(source, output), false)
    for (const backup of readdirSync(output)) verifyBackup(join(output, backup))
  })
}
