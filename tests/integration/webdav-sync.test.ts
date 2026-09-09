import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, mkdir, readFile, stat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import Registry from '@deepseek-ai/dsh-typert-registry'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import * as Notebook from '../../packages/provider-notebook-local/src/index.ts'
import OldProjects from '../../packages/provider-project-local/src/index.ts'
import Notes from '../../packages/feature-notes/src/index.ts'
import Sync from '../../packages/feature-sync/src/index.ts'
import Storage, { WebDavStorage } from '../../packages/adapter-sync-webdav/src/index.ts'
import Rpc from '../../packages/adapter-sync-dsh/src/index.ts'
import { synchronize } from '../../packages/feature-sync/src/engine.ts'
import { startWebDav } from '../helpers/webdav.mjs'
import { verifyBackup } from '../../packages/storage-backup/src/index.ts'
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
  await new WebDavStorage({ url: good.url, username: 'tester', password: 'secret' }).probe(signal())
  await assert.rejects(
    new WebDavStorage({ url: bad.url, username: 'tester', password: 'secret' }).probe(signal()),
    /原子/,
  )
  await assert.rejects(
    new WebDavStorage({ url: good.url, username: 'tester', password: 'wrong' }).probe(signal()),
    /拒绝访问/,
  )
  assert.throws(() => new WebDavStorage({ url: 'http://example.com/', username: '', password: '' }), /HTTPS/)
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
    remote = new WebDavStorage({ url: server.url, username: 'tester', password: 'secret' })
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
  const conflict = a.nookSyncReplica.conflicts()[0]!
  assert.equal(conflict.type, 'note')
  a.nookSyncReplica.resolve(
    conflict.key,
    conflict.versions.map(v => v.hash),
    conflict.versions[0]!.hash,
    true,
  )
  await run(a)
  await run(b)
  assert.equal((await b.nookNotes.list({})).total, 2)
  assert.equal(b.nookSyncReplica.conflicts().length, 0)
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
  assert.equal((await b.nookKnowledge.search({ query: '编辑' })).length, 2)
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
    const { startApacheWebDav } = await import('../helpers/apache-webdav.mjs')
    const { Replica } = await import('../../packages/storage-sync/src/index.ts')
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
    const remote = new WebDavStorage({ url: server.url, username: '', password: '' })
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
  await assert.rejects(new WebDavStorage(base).probe(signal()), /证书/)
  assert.equal(server.methods.length, 0)
  await assert.rejects(
    new WebDavStorage({ ...base, url: server.url.replace('127.0.0.1', 'localhost'), caCert }).probe(signal()),
    /证书/,
  )
  assert.equal(server.methods.length, 0)
  await new WebDavStorage({ ...base, caCert }).probe(signal())
  const calls = server.methods.length
  await assert.rejects(new WebDavStorage(base).probe(signal()), /证书/)
  assert.equal(server.methods.length, calls)
  assert.throws(
    () => new WebDavStorage({ ...base, caCert: readFileSync(join(root, 'server.key'), 'utf8') }),
    /不要粘贴私钥/,
  )
})
