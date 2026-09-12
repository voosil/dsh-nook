import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test, type TestContext } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import {
  acquireDataLock,
  createBackup,
  restoreBackup,
  verifyBackup,
} from '../../../packages/storage-backup/src/index.ts'
import Projects from '../../../packages/provider-project-local/src/index.ts'
import Artifacts from '../../../packages/provider-artifact-local/src/index.ts'
import * as Notebook from '../../../packages/provider-notebook-local/src/index.ts'
import Feature from '../../../packages/feature-notes/src/index.ts'

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'nook-backup-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

function records(directory: string) {
  return readdirSync(directory)
    .filter(name => !name.startsWith('.'))
    .map(name => {
      const path = join(directory, name)
      const manifest = verifyBackup(path)
      return { manifest, value: JSON.parse(readFileSync(join(path, 'data', 'record.json'), 'utf8')), path }
    })
}

test('backup can repeatedly snapshot a cleanly closed WAL database and restore its contents', t => {
  const root = fixture(t)
  const source = join(root, 'source')
  mkdirSync(source)
  const file = join(source, 'notes.sqlite')
  const db = new DatabaseSync(file)
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE notes (body TEXT); INSERT INTO notes VALUES ('保留正文')")
  db.close()
  assert.deepEqual(readdirSync(source), ['notes.sqlite'])
  for (let attempt = 0; attempt < 2; attempt++) {
    const backup = createBackup(source, join(root, 'backups'))
    const manifest = verifyBackup(backup)
    assert.deepEqual(
      manifest.files.map(entry => entry.path),
      ['notes.sqlite'],
    )
    const restored = join(root, `restored-${attempt}`)
    restoreBackup(backup, restored)
    const snapshot = new DatabaseSync(join(restored, 'notes.sqlite'), { readOnly: true })
    try {
      assert.equal(snapshot.prepare('SELECT body FROM notes').get()?.body, '保留正文')
    } finally {
      snapshot.close()
    }
  }
})

test('backup restores committed WAL, FTS, projects, trash, preferences, and artifact bytes into a usable store', async t => {
  const root = fixture(t)
  const source = join(root, 'nook')
  const ctx = new Context()
  const restored = new Context()
  try {
    await ctx.plugin(Projects, { file: join(source, 'projects.json') })
    await ctx.plugin(Artifacts, { root: join(source, 'artifacts'), maxBytes: 1024 })
    await ctx.plugin(Notebook, { file: join(source, 'notebook.sqlite') })
    const project = await ctx.nookProjects.create({ name: '不可丢失的项目' })
    const request = {
      id: randomUUID(),
      title: '劳动异化',
      markdown: '需要恢复的中文正文',
      pinned: true,
      projectId: project.id,
      source: { kind: 'personal' as const, url: null, author: null, basedOn: [] },
    }
    const note = await ctx.nookNotes.create(request)
    const trash = await ctx.nookNotes.create({ ...request, id: randomUUID() })
    await ctx.nookNotes.setDeleted(trash.id, trash.revision, true)
    await ctx.nookKnowledge.setSession('session', { enabled: true, projectId: project.id })
    const artifact = await ctx.nookArtifacts.write({
      projectId: project.id,
      name: 'file',
      mediaType: 'text/plain',
      dataBase64: Buffer.from('bytes').toString('base64'),
    })
    mkdirSync(join(source, 'empty'))
    writeFileSync(join(source, 'ordinary-wal'), 'not a sqlite sidecar')
    assert.ok(statSync(join(source, 'notebook.sqlite-wal')).size > 0)
    const backup = createBackup(source, join(root, 'backups'))
    const manifest = verifyBackup(backup)
    assert.ok(!manifest.files.some(file => file.path === 'notebook.sqlite-wal'))
    if (process.platform !== 'win32') assert.equal(statSync(join(backup, 'data', 'projects.json')).mode & 0o777, 0o600)
    // A later write must not alter the captured snapshot.
    await ctx.nookNotes.save({ ...note, markdown: 'after backup' })
    const target = join(root, 'restored')
    restoreBackup(backup, target)
    assert.equal(readFileSync(join(target, 'ordinary-wal'), 'utf8'), 'not a sqlite sidecar')
    assert.ok(statSync(join(target, 'empty')).isDirectory())
    await restored.plugin(Projects, { file: join(target, 'projects.json') })
    await restored.plugin(Artifacts, { root: join(target, 'artifacts'), maxBytes: 1024 })
    await restored.plugin(Notebook, { file: join(target, 'notebook.sqlite') })
    assert.deepEqual(await restored.nookNotes.get(note.id), note)
    assert.equal((await restored.nookNotes.list({ trash: true })).notes[0]?.id, trash.id)
    assert.equal((await restored.nookKnowledge.search({ query: '劳动异化' }))[0]?.documentId, note.id)
    assert.deepEqual(await restored.nookKnowledge.session('session'), { enabled: true, projectId: project.id })
    assert.equal((await restored.nookProjects.get(project.id))?.name, project.name)
    assert.equal((await restored.nookArtifacts.read(artifact.id))?.dataBase64, Buffer.from('bytes').toString('base64'))
    assert.throws(() => restoreBackup(backup, target), /EEXIST/)
    assert.equal((await restored.nookNotes.get(note.id))?.markdown, note.markdown)
  } finally {
    await restored.fiber.dispose()
    await ctx.fiber.dispose()
  }
})

test('verification rejects corrupt, extra, linked, traversing and unsupported backup contents before restore', t => {
  const root = fixture(t)
  const source = join(root, 'source')
  mkdirSync(source)
  writeFileSync(join(source, 'user.txt'), 'original')
  for (const fault of ['checksum', 'extra', 'symlink', 'traversal', 'version']) {
    const backup = createBackup(source, join(root, 'backups'))
    const manifestPath = join(backup, 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (fault === 'checksum') writeFileSync(join(backup, 'data', 'user.txt'), 'changed!')
    if (fault === 'extra') writeFileSync(join(backup, 'data', 'extra'), 'unlisted')
    if (fault === 'symlink') symlinkSync(source, join(backup, 'data', 'linked'))
    if (fault === 'traversal') {
      manifest.files[0].path = '../outside'
      writeFileSync(manifestPath, JSON.stringify(manifest))
    }
    if (fault === 'version') {
      manifest.version = 2
      writeFileSync(manifestPath, JSON.stringify(manifest))
    }
    assert.throws(() => verifyBackup(backup))
    assert.throws(() => restoreBackup(backup, join(root, `restore-${fault}`)))
    assert.throws(() => statSync(join(root, `restore-${fault}`)), { code: 'ENOENT' })
  }
  assert.equal(readFileSync(join(source, 'user.txt'), 'utf8'), 'original')
})

test('backup refuses nested outputs including aliased paths, symlinks and missing sources', t => {
  const root = fixture(t)
  const source = join(root, 'source')
  mkdirSync(source)
  symlinkSync(source, join(root, 'alias'))
  assert.throws(() => createBackup(source, join(root, 'alias', 'backups')), /non-nested/)
  assert.throws(() => createBackup(source, source), /non-nested/)
  assert.throws(() => createBackup(join(root, 'missing'), join(root, 'backups')), /ENOENT/)
  symlinkSync(join(root, 'alias'), join(source, 'linked'))
  assert.throws(() => createBackup(source, join(root, 'backups')), /symlinks/)
})

test('recovery records precede project, artifact, note and project-association deletion', async t => {
  const root = fixture(t)
  const ctx = new Context()
  try {
    await ctx.plugin(Projects, { file: join(root, 'projects.json') })
    await ctx.plugin(Artifacts, { root: join(root, 'artifacts'), maxBytes: 1024 })
    await ctx.plugin(Notebook, { file: join(root, 'notebook.sqlite') })
    await ctx.plugin(Feature)
    const project = await ctx.nookProjects.create({ name: '项目', description: '详情' })
    const note = await ctx.nookNotes.create({
      id: randomUUID(),
      title: '笔记',
      markdown: '正文',
      projectId: project.id,
      pinned: false,
      source: { kind: 'personal', url: null, author: null, basedOn: [] },
    })
    const artifact = await ctx.nookArtifacts.write({
      projectId: project.id,
      name: 'asset',
      mediaType: 'text/plain',
      dataBase64: 'aGk=',
    })
    await ctx.nookKnowledge.setSession('scoped', { enabled: true, projectId: project.id })
    await ctx.nookNotes.setDeleted(note.id, note.revision, true)
    assert.deepEqual(records(join(root, 'notebook.sqlite.backups'))[0]!.value.notes, [note])
    await ctx.nookNotebook.deleteProject(project.id)
    assert.deepEqual(records(join(root, 'projects.json.backups'))[0]!.value.projects, [project])
    const detached = records(join(root, 'notebook.sqlite.backups')).find(
      record => record.manifest.reason === 'detach-project',
    )!
    assert.equal(detached.value.notes[0].projectId, project.id)
    assert.deepEqual(detached.value.sessions, [{ id: 'scoped', enabled: 1, project_id: project.id }])
    await ctx.nookArtifacts.delete(artifact.id)
    const artifactBackup = records(join(root, 'artifacts.backups'))[0]!
    assert.equal(artifactBackup.value.dataBase64, 'aGk=')
    const extracted = join(root, 'extracted')
    restoreBackup(artifactBackup.path, extracted)
    assert.equal(JSON.parse(readFileSync(join(extracted, 'record.json'), 'utf8')).id, artifact.id)
    assert.equal(await ctx.nookArtifacts.read(artifact.id), undefined)
    assert.equal(await ctx.nookProjects.get(project.id), undefined)
  } finally {
    await ctx.fiber.dispose()
  }
})

test('backup write failures preserve projects, artifact bytes, notes, indexes and project associations', async t => {
  const root = fixture(t)
  const ctx = new Context()
  try {
    await ctx.plugin(Projects, { file: join(root, 'projects.json') })
    await ctx.plugin(Artifacts, { root: join(root, 'artifacts'), maxBytes: 1024 })
    await ctx.plugin(Notebook, { file: join(root, 'notebook.sqlite') })
    await ctx.plugin(Feature)
    const project = await ctx.nookProjects.create({ name: '保留' })
    const note = await ctx.nookNotes.create({
      id: randomUUID(),
      title: '保留索引',
      markdown: '保留正文',
      projectId: project.id,
      pinned: false,
      source: { kind: 'personal', url: null, author: null, basedOn: [] },
    })
    const artifact = await ctx.nookArtifacts.write({
      projectId: project.id,
      name: 'asset',
      mediaType: 'text/plain',
      dataBase64: 'aGk=',
    })
    for (const name of ['projects.json', 'artifacts', 'notebook.sqlite'])
      writeFileSync(join(root, `${name}.backups`), 'block backup directory')
    await assert.rejects(ctx.nookProjects.delete(project.id))
    await assert.rejects(ctx.nookArtifacts.delete(artifact.id))
    await assert.rejects(ctx.nookNotes.setDeleted(note.id, note.revision, true))
    await assert.rejects(ctx.nookNotebook.deleteProject(project.id))
    assert.deepEqual(await ctx.nookProjects.get(project.id), project)
    assert.deepEqual(await ctx.nookNotes.get(note.id), note)
    assert.equal((await ctx.nookKnowledge.search({ query: '保留索引' }))[0]?.documentId, note.id)
    assert.equal((await ctx.nookArtifacts.read(artifact.id))?.dataBase64, 'aGk=')
  } finally {
    await ctx.fiber.dispose()
  }
})

test('data lock is exclusive, survives alias paths and disposes idempotently', t => {
  const root = fixture(t)
  const source = join(root, 'nook')
  mkdirSync(source)
  symlinkSync(source, join(root, 'alias'))
  const release = acquireDataLock(source)
  assert.throws(() => acquireDataLock(join(root, 'alias')), /locked/)
  release()
  release()
  acquireDataLock(source)()
})

test('data lock recovers a dead legacy owner without removing metadata or user data', t => {
  const root = fixture(t)
  const source = join(root, 'nook')
  mkdirSync(source)
  writeFileSync(join(source, 'keep'), 'saved')
  const lock = `${source}.lock`
  mkdirSync(lock)
  const exited = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' })
  assert.equal(exited.status, 0)
  const owner = JSON.stringify({ pid: Number(exited.stdout.trim()), createdAt: '2026-09-12T01:57:18.881Z' })
  writeFileSync(join(lock, 'owner.json'), owner)
  const release = acquireDataLock(source)
  try {
    assert.throws(() => acquireDataLock(source), /locked/)
    const archived = readdirSync(lock).filter(name => name.startsWith('legacy-owner-'))
    assert.equal(archived.length, 1)
    assert.equal(readFileSync(join(lock, archived[0]), 'utf8'), owner)
    assert.equal(readFileSync(join(source, 'keep'), 'utf8'), 'saved')
  } finally {
    release()
  }
  acquireDataLock(source)()
})

test('data lock refuses a live or unverified legacy owner and releases its native handle on failure', t => {
  const root = fixture(t)
  const source = join(root, 'nook')
  const lock = `${source}.lock`
  mkdirSync(lock)
  const owner = JSON.stringify({ pid: process.pid })
  writeFileSync(join(lock, 'owner.json'), owner)
  assert.throws(() => acquireDataLock(source), /locked by legacy process/)
  assert.equal(readFileSync(join(lock, 'owner.json'), 'utf8'), owner)
  writeFileSync(join(lock, 'owner.json'), '{broken')
  assert.throws(() => acquireDataLock(source), /JSON/)
  writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid }))
  assert.throws(() => acquireDataLock(source), /locked by legacy process/)
})
