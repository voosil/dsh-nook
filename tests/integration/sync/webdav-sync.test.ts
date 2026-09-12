import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, mkdir, readFile, stat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import Registry from '@deepseek-ai/dsh-typert-registry'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import * as Notebook from '../../../packages/provider-notebook-local/src/index.ts'
import OldProjects from '../../../packages/provider-project-local/src/index.ts'
import Notes from '../../../packages/feature-notes/src/index.ts'
import Sync from '../../../packages/feature-sync/src/index.ts'
import Storage, { WebDavStorage } from '../../../packages/adapter-sync-webdav/src/index.ts'
import Rpc from '../../../packages/adapter-sync-dsh/src/index.ts'
import { synchronize } from '../../../packages/feature-sync/src/engine.ts'
import { startWebDav } from '../../helpers/services/webdav.mjs'
import { verifyBackup } from '../../../packages/storage-backup/src/index.ts'
function openWebDav(t: import('node:test').TestContext, config: ConstructorParameters<typeof WebDavStorage>[0]) {
  const storage = new WebDavStorage(config)
  t.after(() => storage.dispose())
  return storage
}
const note = (markdown: string) => ({
  id: randomUUID(),
  title: '',
  markdown,
  projectId: null,
  pinned: false,
  source: { kind: 'personal' as const, url: null, author: null, basedOn: [] },
})
const signal = () => new AbortController().signal

test('WebDAV verifies conditional writes, rejects incompatible or unauthorized endpoints', async t => {
  const good = await startWebDav(),
    bad = await startWebDav({ brokenConditions: true })
  t.after(async () => {
    await good.close()
    await bad.close()
  })
  await openWebDav(t, { url: good.url, username: 'tester', password: 'secret' }).probe(signal())
  await assert.rejects(openWebDav(t, { url: bad.url, username: 'tester', password: 'secret' }).probe(signal()), /原子/)
  await assert.rejects(
    openWebDav(t, { url: good.url, username: 'tester', password: 'wrong' }).probe(signal()),
    /拒绝访问/,
  )
  assert.throws(() => openWebDav(t, { url: 'http://example.com/', username: '', password: '' }), /HTTPS/)
  assert.equal([...good.data.keys()].filter(k => k.includes('/probes/')).length, 0)
})

test('two notebooks migrate projects and sync notes, source versions, trash, conflicts and project deletion over HTTP', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nook-webdav-integration-')),
    server = await startWebDav(),
    contexts: Context[] = []
  t.after(async () => {
    for (const ctx of contexts) await ctx.fiber.dispose()
    await server.close()
    await rm(root, { recursive: true, force: true })
  })
  async function boot(name: string) {
    const dir = join(root, name, 'nook')
    await mkdir(dir, { recursive: true })
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(Notebook, { file: join(dir, 'notebook.sqlite'), projectsFile: join(dir, 'projects.json') })
    await ctx.plugin(Notes)
    return ctx
  }
  // Create an actual legacy JSON/SQLite store before enabling integrated storage.
  const dir = join(root, 'a', 'nook')
  await mkdir(dir, { recursive: true })
  const legacy = new Context()
  await legacy.plugin(OldProjects, { file: join(dir, 'projects.json') })
  await legacy.plugin(Notebook, { file: join(dir, 'notebook.sqlite') })
  const project = await legacy.nookProjects.create({ name: '研究' })
  const original = await legacy.nookNotes.create({ ...note('旧库中文内容'), projectId: project.id })
  await legacy.fiber.dispose()
  const a = await boot('a'),
    b = await boot('b'),
    remote = openWebDav(t, { url: server.url, username: 'tester', password: 'secret' })
  await remote.probe(signal())
  const run = (ctx: Context) => synchronize(ctx.nookSyncReplica, remote, server.url, signal())
  const backups = await readdir(join(root, 'a', 'nook.sync-backups'))
  assert.ok(backups.length)
  for (const backup of backups) verifyBackup(join(root, 'a', 'nook.sync-backups', backup))
  assert.equal((await a.nookProjects.list())[0]?.id, project.id)
  assert.ok(await readFile(join(dir, 'projects.json'), 'utf8'))
  await run(a)
  await run(b)
  const secondProject = await a.nookProjects.create({ name: '排序项目' })
  await a.nookProjects.reorder([secondProject.id, project.id])
  await run(a)
  await run(b)
  assert.deepEqual(
    (await b.nookProjects.list()).map(p => p.id),
    [secondProject.id, project.id],
  )
  await a.nookNotebook.deleteProject(secondProject.id)
  await run(a)
  await run(b)
  let bn = (await b.nookNotes.get(original.id))!
  assert.equal(bn.markdown, '旧库中文内容')
  assert.equal(bn.projectId, project.id)
  assert.match(bn.versionId!, /^[a-f0-9]{64}$/)
  await a.nookNotes.save({ ...(await a.nookNotes.get(original.id))!, markdown: '左端编辑' })
  await b.nookNotes.save({ ...bn, markdown: '右端编辑' })
  await Promise.all([run(a), run(b)])
  await run(a)
  await run(b)
  assert.equal(a.nookSyncReplica.conflicts().length, 0)
  assert.equal(b.nookSyncReplica.conflicts().length, 0)
  assert.equal((await b.nookNotes.list({})).total, 1)
  assert.equal((await a.nookNotes.get(original.id))!.markdown, (await b.nookNotes.get(original.id))!.markdown)
  const history = await b.nookNotes.history({ id: original.id })
  const oldVersions = await Promise.all(
    history.entries.map(v => b.nookNotes.getHistoryVersion(original.id, v.versionId)),
  )
  assert.ok(oldVersions.some(v => v.markdown === '左端编辑'))
  assert.ok(oldVersions.some(v => v.markdown === '右端编辑'))
  const restored = await a.nookNotes.restoreHistoryVersion({
    id: original.id,
    versionId: oldVersions.find(v => v.markdown === '左端编辑')!.versionId!,
    requestId: randomUUID(),
    copy: false,
  })
  await run(a)
  await run(b)
  const receivedHistory = await b.nookNotes.history({ id: original.id })
  assert.equal(receivedHistory.entries[0]!.versionId, restored.versionId)
  assert.equal(receivedHistory.entries[0]!.kind, 'restore')
  bn = (await b.nookNotes.get(original.id))!
  await b.nookNotes.setDeleted(bn.id, bn.revision, true)
  await run(b)
  await run(a)
  assert.equal((await a.nookNotes.list({ trash: true })).total, 1)
  let an = (await a.nookNotes.get(original.id))!
  await a.nookNotes.setDeleted(an.id, an.revision, false)
  await run(a)
  await run(b)
  await b.nookKnowledge.setSession('session', { enabled: true, projectId: project.id })
  await a.nookNotebook.deleteProject(project.id)
  await run(a)
  await run(b)
  assert.equal((await b.nookProjects.list()).length, 0)
  assert.ok((await b.nookNotes.list({})).notes.every(n => n.projectId === null))
  assert.equal((await b.nookKnowledge.session('session')).enabled, false)
  assert.equal((await b.nookKnowledge.search({ query: '编辑' })).length, 1)
})

test('sync RPC keeps credentials private, disabling preserves pending data, and disposal releases work', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nook-sync-rpc-')),
    server = await startWebDav(),
    ctx = new Context()
  t.after(async () => {
    await ctx.fiber.dispose()
    await server.close()
    await rm(root, { recursive: true, force: true })
  })
  const dir = join(root, 'nook')
  await mkdir(dir)
  await ctx.plugin(Registry)
  await ctx.plugin(Gateway)
  await ctx.plugin(Notebook, { file: join(dir, 'notebook.sqlite'), projectsFile: join(dir, 'projects.json') })
  await ctx.plugin(Storage)
  const settings = join(root, 'private', 'sync.json')
  const plugin = await ctx.plugin(Sync, { file: settings })
  const rpc = await ctx.plugin(Rpc)
  const invoke = (method: string, request: object) =>
    ctx.typertGateway.invoke({ namespace: 'nookSyncRpc', method, args: { request } }) as Promise<any>
  const enabled = await invoke('configure', { enabled: true, url: server.url, username: 'tester', password: 'secret' })
  assert.equal(enabled.ok, true, JSON.stringify(enabled))
  assert.equal(enabled.value.hasPassword, true)
  assert.ok(!JSON.stringify(enabled).includes('secret'))
  if (process.platform !== 'win32') assert.equal((await stat(settings)).mode & 0o777, 0o600)
  await ctx.nookNotes.create(note('RPC同步'))
  await invoke('run', {})
  assert.equal((await invoke('status', {})).value.pending, 0)
  await invoke('configure', { enabled: false, url: server.url, username: 'tester' })
  await ctx.nookNotes.create(note('关闭后本地保存'))
  assert.ok((await invoke('status', {})).value.pending > 0)
  await rpc.dispose()
  await assert.rejects(invoke('status', {}))
  await plugin.dispose()
  const count = server.methods.length
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(server.methods.length, count)
})

test(
  'independent Apache mod_dav single-worker reference converges two replicas',
  { skip: process.platform !== 'darwin' },
  async t => {
    const { startApacheWebDav } = await import('../../helpers/services/apache-webdav.mjs')
    const { Replica } = await import('../../../packages/storage-sync/src/index.ts')
    const { DatabaseSync } = await import('node:sqlite')
    const server = await startApacheWebDav(),
      root = await mkdtemp(join(tmpdir(), 'nook-apache-replicas-'))
    const a = new Replica(new DatabaseSync(join(root, 'a.sqlite')), join(root, 'a'), join(root, 'a-backup'), () => {})
    const b = new Replica(new DatabaseSync(join(root, 'b.sqlite')), join(root, 'b'), join(root, 'b-backup'), () => {})
    t.after(async () => {
      a.dispose()
      b.dispose()
      a.db.close()
      b.db.close()
      await server.close()
      await rm(root, { recursive: true, force: true })
    })
    for (const r of [a, b]) r.registerType({ type: 'task', schema: 1, validate: () => {} })
    const remote = openWebDav(t, { url: server.url, username: '', password: '' })
    await remote.probe(signal())
    const run = (r: typeof a) => synchronize(r, remote, server.url, signal())
    a.capture('task', 'one', { text: 'base' })
    await run(a)
    await run(b)
    a.capture('task', 'one', { text: 'left' })
    b.capture('task', 'one', { text: 'right' })
    await Promise.all([run(a), run(b)])
    await run(a)
    await run(b)
    assert.equal(a.conflicts().length, 1)
    const c = a.conflicts()[0]!
    a.resolve(
      c.key,
      c.versions.map(v => v.hash),
      c.versions[0]!.hash,
      false,
    )
    await run(a)
    await run(b)
    assert.deepEqual(a.records('task'), b.records('task'))
    assert.equal(b.stats().pending, 0)
  },
)

test('private CA trust is connection-scoped and rejects missing trust or wrong certificate host before sending credentials', async t => {
  const { execFileSync } = await import('node:child_process')
  const { writeFileSync, readFileSync } = await import('node:fs')
  const root = await mkdtemp(join(tmpdir(), 'nook-ca-integration-'))
  const openssl = (...args: string[]) => execFileSync('openssl', args, { cwd: root, stdio: 'ignore' })
  openssl(
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-sha256',
    '-days',
    '2',
    '-subj',
    '/CN=Nook test CA',
    '-addext',
    'basicConstraints=critical,CA:TRUE',
    '-keyout',
    'ca.key',
    '-out',
    'ca.pem',
  )
  openssl(
    'req',
    '-new',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-subj',
    '/CN=Nook test server',
    '-keyout',
    'server.key',
    '-out',
    'server.csr',
  )
  writeFileSync(
    join(root, 'server.ext'),
    'subjectAltName=IP:127.0.0.1\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n',
  )
  openssl(
    'x509',
    '-req',
    '-in',
    'server.csr',
    '-CA',
    'ca.pem',
    '-CAkey',
    'ca.key',
    '-set_serial',
    '1',
    '-days',
    '2',
    '-extfile',
    'server.ext',
    '-out',
    'server.pem',
  )
  const caCert = readFileSync(join(root, 'ca.pem'), 'utf8')
  const server = await startWebDav({
    tls: { key: readFileSync(join(root, 'server.key')), cert: readFileSync(join(root, 'server.pem')) },
  })
  t.after(async () => {
    await server.close()
    await rm(root, { recursive: true, force: true })
  })
  const base = { url: server.url, username: 'tester', password: 'secret' }
  await assert.rejects(openWebDav(t, base).probe(signal()), /证书/)
  assert.equal(server.methods.length, 0)
  await assert.rejects(
    openWebDav(t, { ...base, url: server.url.replace('127.0.0.1', 'localhost'), caCert }).probe(signal()),
    /证书/,
  )
  assert.equal(server.methods.length, 0)
  await openWebDav(t, { ...base, caCert }).probe(signal())
  const calls = server.methods.length
  await assert.rejects(openWebDav(t, base).probe(signal()), /证书/)
  assert.equal(server.methods.length, calls)
  assert.throws(
    () => openWebDav(t, { ...base, caCert: readFileSync(join(root, 'server.key'), 'utf8') }),
    /不要粘贴私钥/,
  )
})

test('WebDAV reuses connections within a run and closes them on disposal', async t => {
  const server = await startWebDav()
  t.after(() => server.close())
  const remote = openWebDav(t, { url: server.url, username: 'tester', password: 'secret' })
  const body = Buffer.from('connection reuse')
  await remote.put('objects/reuse', body, null, signal())
  for (let n = 0; n < 12; n++) assert.deepEqual((await remote.get('objects/reuse', signal()))?.bytes, body)
  assert.equal(server.connections(), 1)
  await Promise.all(Array.from({ length: 18 }, () => remote.get('objects/reuse', signal())))
  assert.ok(server.connections() <= 6)
  remote.dispose()
  const count = server.methods.length
  await assert.rejects(remote.get('objects/reuse', signal()), /关闭/)
  assert.equal(server.methods.length, count)
})

test('same-directory epochs preserve note sources, offline edits, search and late browser drafts over WebDAV', async t => {
  const { publishEpoch } = await import('../../../packages/feature-sync/src/epochs.ts')
  const root = await mkdtemp(join(tmpdir(), 'nook-epoch-http-')),
    server = await startWebDav(),
    contexts: Context[] = []
  t.after(async () => {
    for (const ctx of contexts) await ctx.fiber.dispose()
    await server.close()
    await rm(root, { recursive: true, force: true })
  })
  const boot = async (name: string) => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(Notebook, {
      file: join(root, name, 'notebook.sqlite'),
      projectsFile: join(root, name, 'projects.json'),
    })
    return ctx
  }
  const a = await boot('a'),
    b = await boot('b'),
    remote = openWebDav(t, { url: server.url, username: 'tester', password: 'secret' })
  await remote.probe(signal())
  const run = (ctx: Context) => synchronize(ctx.nookSyncReplica, remote, server.url, signal())
  const original = await a.nookNotes.create(note('base'))
  const firstRequest = { ...original, markdown: 'middle 中文', requestId: randomUUID() }
  const first = (await a.nookNotes.save(firstRequest)).note
  const referenced = (await a.nookNotes.save({ ...first, markdown: 'referenced 中文' })).note
  const sourceNote = await a.nookNotes.create({
    ...note('来源笔记'),
    source: {
      kind: 'personal',
      url: null,
      author: null,
      basedOn: [{ noteId: original.id, revision: referenced.revision, versionId: referenced.versionId! }],
    },
  })
  await run(a)
  await run(b)
  const local = await b.nookNotes.get(original.id)
  await b.nookNotes.save({ ...local!, markdown: 'offline 中文' })
  await a.nookNotes.save({ ...referenced, markdown: 'remote 中文' })
  await run(a)
  const plan = a.nookSyncReplica.planHistoryRewrite!([first.versionId!, referenced.versionId!])
  const mapping = (plan.migration.data as { mapping: Record<string, string | null> }).mapping
  assert.equal(mapping[first.versionId!], null)
  assert.ok(mapping[referenced.versionId!], 'explicitly referenced snapshots survive, with remapped identifiers')
  await publishEpoch(remote, plan, signal())
  await run(a)
  const beforeRetry = a.nookSyncReplica.snapshot().heads
  const currentBeforeRetry = await a.nookNotes.get(original.id)
  const retried = await a.nookNotes.save(firstRequest)
  assert.deepEqual(
    a.nookSyncReplica.snapshot().heads,
    beforeRetry,
    'lost responses never resubmit an already saved edit',
  )
  assert.equal(retried.note.markdown, currentBeforeRetry!.markdown)
  assert.equal(
    a.nookSyncReplica.version(retried.submittedVersionId!)!.data &&
      (a.nookSyncReplica.version(retried.submittedVersionId!)!.data as { markdown: string }).markdown,
    'middle 中文',
  )
  await assert.rejects(a.nookNotes.save({ ...firstRequest, markdown: 'different request body' }), /其他内容/)
  const migratedSource = await a.nookNotes.get(sourceNote.id)
  assert.equal(migratedSource!.source.basedOn[0]!.versionId, mapping[referenced.versionId!])
  assert.equal(
    (await a.nookNotes.getHistoryVersion(original.id, mapping[referenced.versionId!]!)).markdown,
    referenced.markdown,
  )
  // A still-open editor submits a draft using a version removed by the migration.
  await a.nookNotes.save({ ...first, markdown: 'late browser 中文', requestId: randomUUID() })
  await run(a)
  await run(b)
  await run(a)
  await run(b)
  assert.equal((await a.nookNotes.get(original.id))!.markdown, (await b.nookNotes.get(original.id))!.markdown)
  const history = await a.nookNotes.history({ id: original.id, limit: 100 })
  const contents = await Promise.all(history.entries.map(e => a.nookNotes.getHistoryVersion(original.id, e.versionId)))
  assert.ok(contents.some(n => n.markdown === 'late browser 中文'))
  assert.ok(contents.some(n => n.markdown === 'offline 中文'))
  assert.ok((await a.nookKnowledge.search({ query: '中文' })).length)
})
