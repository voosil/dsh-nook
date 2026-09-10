import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { Replica, digest } from '../../packages/storage-sync/src/index.ts'
import { synchronize } from '../../packages/feature-sync/src/engine.ts'
import type { SyncStorage, RecordVersion, Json } from '../../packages/capability-sync/src/index.ts'

class Memory implements SyncStorage {
  data = new Map<string, { bytes: Uint8Array; etag: string }>()
  hook: ((path: string) => void) | undefined
  lost = false
  async probe() {}
  async get(path: string) {
    const v = this.data.get(path)
    return v ? { bytes: v.bytes.slice(), etag: v.etag } : null
  }
  async put(path: string, bytes: Uint8Array, expected: string | null) {
    const old = this.data.get(path)
    if (expected === null ? !!old : old?.etag !== expected) return false
    this.data.set(path, { bytes: bytes.slice(), etag: `"${createHash('sha256').update(bytes).digest('hex')}"` })
    this.hook?.(path)
    if (this.lost && path === 'index.json' && old) {
      this.lost = false
      throw new Error('lost acknowledgement')
    }
    return true
  }
}
async function setup(t: import('node:test').TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'nook-sync-contract-'))
  const replicas: Replica[] = []
  t.after(async () => {
    for (const r of replicas) {
      r.dispose()
      r.db.close()
    }
    await rm(root, { recursive: true, force: true })
  })
  function replica(name: string, supported = true) {
    const db = new DatabaseSync(join(root, `${name}.sqlite`))
    const r = new Replica(db, join(root, name, 'files'), join(root, name, 'backups'), () => {})
    if (supported)
      r.register({
        type: 'task',
        schema: 1,
        validate: () => {},
        apply: () => {},
        copy: (v, id) => ({ ...(v.data as object), id }) as Json,
      })
    replicas.push(r)
    return r
  }
  const remote = new Memory()
  const run = (r: Replica) => synchronize(r, remote, 'https://test/dav/', new AbortController().signal)
  return { root, replica, remote, run }
}
const payload = (text: string) => ({ text })

test('generic records persist offline, sync incrementally and tolerate lost responses and concurrent local edits', async t => {
  const { replica, remote, run } = await setup(t),
    a = replica('a'),
    b = replica('b')
  a.capture('task', 'one', payload('first'))
  a.capture('task', 'one', payload('second'))
  assert.equal(a.stats().pending, 2)
  await run(a)
  await run(b)
  assert.deepEqual(b.version(b.working('task', 'one')!)?.data, payload('second'))
  assert.equal(a.stats().pending, 0)
  a.capture('task', 'one', payload('third'))
  remote.lost = true
  await assert.rejects(run(a), /lost/)
  await run(a)
  await run(b)
  assert.deepEqual(b.version(b.working('task', 'one')!)?.data, payload('third'))
  a.capture('task', 'one', payload('fourth'))
  remote.hook = path => {
    if (path === 'index.json') {
      remote.hook = undefined
      a.capture('task', 'one', payload('fifth'))
    }
  }
  await run(a)
  await run(b)
  assert.deepEqual(b.version(b.working('task', 'one')!)?.data, payload('fifth'))
  assert.equal(a.stats().pending, 0)
})

test('simultaneous writers preserve both branches, resolution and copies converge without duplicates', async t => {
  const { replica, run } = await setup(t),
    a = replica('a'),
    b = replica('b')
  a.capture('task', 'one', payload('base'))
  await run(a)
  await run(b)
  a.capture('task', 'one', payload('left'))
  b.capture('task', 'one', payload('right'))
  await Promise.all([run(a), run(b)])
  await run(a)
  await run(b)
  assert.equal(a.conflicts().length, 1)
  assert.equal(b.conflicts().length, 1)
  const c = a.conflicts()[0]!
  const picked = c.versions.find(v => (v.value.data as { text: string }).text === 'left')!
  a.resolve(
    c.key,
    c.versions.map(v => v.hash),
    picked.hash,
    true,
  )
  await run(a)
  await run(b)
  await run(a)
  assert.equal(a.conflicts().length, 0)
  assert.equal(b.conflicts().length, 0)
  assert.equal(Object.keys(b.snapshot().heads).length, 2)
  assert.deepEqual(b.version(b.working('task', 'one')!)?.data, payload('left'))
  await assert.rejects(
    async () =>
      a.resolve(
        c.key,
        c.versions.map(v => v.hash),
        picked.hash,
        false,
      ),
    /变化/,
  )
})

test('unknown schemas and binary dependencies survive another client and later writes', async t => {
  const { replica, remote, run } = await setup(t),
    a = replica('a'),
    b = replica('b', false)
  const content = Buffer.from('binary\0attachment'),
    ref = { hash: digest(content), bytes: content.length, mediaType: 'application/octet-stream' }
  a.receiveBlob(ref, content)
  a.capture('task', 'one', payload('attached'), false, [ref])
  await run(a)
  await run(b)
  assert.equal(b.stats().unsupported, 1)
  assert.equal(b.working('task', 'one'), null)
  assert.deepEqual(b.blob(ref.hash), content)
  b.capture('future', 'two', { future: true })
  await run(b)
  await run(a)
  assert.ok(a.snapshot().heads['future/two'])
  assert.ok(remote.data.has(`blobs/${ref.hash}`))
  const index = JSON.parse(Buffer.from(remote.data.get('index.json')!.bytes).toString())
  assert.ok(index.heads['task/one'])
  assert.ok(index.heads['future/two'])
})

test('remote rollback, missing blobs and corrupted objects do not advance the replica', async t => {
  const { replica, remote, run } = await setup(t),
    a = replica('a'),
    b = replica('b')
  a.capture('task', 'one', payload('base'))
  await run(a)
  await run(b)
  const old = remote.data.get('index.json')!
  a.capture('task', 'one', payload('new'))
  await run(a)
  await run(b)
  remote.data.set('index.json', old)
  await assert.rejects(run(b), /回退/)
  assert.deepEqual(b.version(b.working('task', 'one')!)?.data, payload('new'))
  remote.data.delete('index.json')
  await assert.rejects(run(a), /不存在/)
})

test('a failed recovery backup leaves conflict resolution and pending changes untouched', async t => {
  const { root, replica, run } = await setup(t),
    a = replica('a'),
    b = replica('b')
  a.capture('task', 'one', payload('base'))
  await run(a)
  await run(b)
  a.capture('task', 'one', payload('a'))
  b.capture('task', 'one', payload('b'))
  await run(a)
  await run(b)
  await run(a)
  const c = a.conflicts()[0]!,
    snapshot = a.snapshot()
  // Disposable fixture prevents creation of a recovery directory.
  await rm(a.backups, { recursive: true, force: true })
  await import('node:fs/promises').then(fs => fs.writeFile(a.backups, 'blocked'))
  assert.throws(() =>
    a.resolve(
      c.key,
      c.versions.map(v => v.hash),
      c.versions[0]!.hash,
      false,
    ),
  )
  assert.deepEqual(a.snapshot(), snapshot)
  assert.equal(a.conflicts().length, 1)
})

test('new types use capability writes, atomic validation and optimistic revisions without engine changes', async t => {
  const { replica, run } = await setup(t),
    a = replica('a', false),
    b = replica('b', false)
  const handler = {
    type: 'bookmark',
    schema: 2,
    validate(v: RecordVersion) {
      if (!(v.data && typeof v.data === 'object' && 'url' in v.data)) throw new Error('invalid bookmark')
    },
  }
  const release = a.registerType(handler)
  const make = (id: string, data: Json) => ({
    type: 'bookmark',
    id,
    schema: 2,
    expected: null,
    deleted: false,
    blobs: [],
    data,
  })
  assert.throws(
    () => a.writeRecords([make('one', { url: 'https://example.com' }), make('bad', {})]),
    /invalid bookmark/,
  )
  assert.equal(a.records('bookmark').length, 0)
  const [first] = a.writeRecords([make('one', { url: 'https://example.com' })])
  assert.throws(() => a.writeRecords([make('one', { url: 'https://stale.example' })]), /变化/)
  await run(a)
  await run(b)
  assert.equal(b.stats().unsupported, 1)
  b.registerType(handler)
  await run(b)
  assert.equal(b.stats().unsupported, 0)
  assert.deepEqual(b.records('bookmark'), [first])
  b.writeRecords([{ ...make('one', { url: 'https://next.example' }), expected: first!.hash }])
  await run(b)
  await run(a)
  assert.deepEqual(a.records('bookmark')[0]!.value.data, { url: 'https://next.example' })
  release()
  assert.throws(() => a.writeRecords([make('two', { url: 'https://example.com' })]), /尚未注册/)
})

test('incomplete or corrupt remote objects never publish business projections', async t => {
  const { replica, remote, run } = await setup(t),
    a = replica('a'),
    b = replica('b')
  const content = Buffer.from('attachment'),
    ref = { hash: digest(content), bytes: content.length, mediaType: 'text/plain' }
  assert.throws(() => a.capture('task', 'missing', {}, false, [ref]), /附件缺失/)
  a.receiveBlob(ref, content)
  const h = a.capture('task', 'one', {}, false, [ref])
  await run(a)
  const savedBlob = remote.data.get(`blobs/${ref.hash}`)!
  remote.data.delete(`blobs/${ref.hash}`)
  await assert.rejects(run(b), /附件尚不完整/)
  assert.equal(b.records('task').length, 0)
  remote.data.set(`blobs/${ref.hash}`, savedBlob)
  const savedObject = remote.data.get(`objects/${h}`)!
  remote.data.set(`objects/${h}`, { ...savedObject, bytes: Buffer.from('{}') })
  await assert.rejects(run(b), /校验失败/)
  assert.equal(b.records('task').length, 0)
  remote.data.set(`objects/${h}`, savedObject)
  await run(b)
  assert.equal(b.records('task').length, 1)
})

test('offline versions survive process reopen and reject oversized records before committing', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nook-sync-reopen-'))
  const make = () => {
    const r = new Replica(
      new DatabaseSync(join(root, 'replica.sqlite')),
      join(root, 'files'),
      join(root, 'backups'),
      () => {},
    )
    r.registerType({ type: 'task', schema: 1, validate: () => {} })
    return r
  }
  let r = make()
  t.after(async () => {
    r.dispose()
    r.db.close()
    await rm(root, { recursive: true, force: true })
  })
  r.capture('task', 'one', { text: 'offline' })
  const snapshot = r.snapshot()
  assert.throws(() => r.capture('task', 'big', { text: 'x'.repeat(4_000_000) }), /大小限制/)
  assert.deepEqual(r.snapshot(), snapshot)
  r.dispose()
  r.db.close()
  r = make()
  assert.deepEqual(r.snapshot(), snapshot)
  assert.deepEqual(r.records('task')[0]!.value.data, { text: 'offline' })
  await synchronize(r, new Memory(), 'https://test/dav/', new AbortController().signal)
  assert.equal(r.stats().pending, 0)
})

/** Simulate round-trip latency and observe work left in flight on failure. */
function measured(remote: Memory, delay = 10) {
  const state = { active: 0, peak: 0, calls: new Map<string, number>() }
  async function request<T>(method: string, path: string, signal: AbortSignal, action: () => Promise<T>) {
    const { setTimeout } = await import('node:timers/promises')
    state.active++
    state.peak = Math.max(state.peak, state.active)
    const key = `${method} ${path}`
    state.calls.set(key, (state.calls.get(key) ?? 0) + 1)
    try {
      await setTimeout(delay, undefined, { signal })
      return await action()
    } finally {
      state.active--
    }
  }
  const storage: SyncStorage = {
    probe: () => remote.probe(),
    get: (path, signal) => request('GET', path, signal, () => remote.get(path)),
    put: (path, bytes, expected, signal) => request('PUT', path, signal, () => remote.put(path, bytes, expected)),
  }
  return { state, storage }
}

test('bounded transfers converge full histories, deduplicate blobs and reuse verified objects on CAS retry', async t => {
  const { replica, remote } = await setup(t),
    a = replica('a'),
    b = replica('b')
  const content = Buffer.from('shared attachment')
  const ref = { hash: digest(content), bytes: content.length, mediaType: 'text/plain' }
  a.receiveBlob(ref, content)
  for (let record = 0; record < 18; record++)
    for (let version = 0; version < 3; version++) a.capture('task', `record-${record}`, { version }, false, [ref])
  const pending = a.snapshot().pending
  const originalPut = remote.put.bind(remote)
  let raced = false
  remote.put = async (path, bytes, expected) => {
    if (path === 'index.json' && expected !== null) {
      // Publication can only occur after every pending object and dependency is readable.
      for (const id of pending) assert.ok(remote.data.has(`objects/${id}`))
      assert.ok(remote.data.has(`blobs/${ref.hash}`))
      if (!raced) {
        raced = true
        return false
      }
    }
    return originalPut(path, bytes, expected)
  }
  const upload = measured(remote)
  const start = performance.now()
  await synchronize(a, upload.storage, 'https://test/dav/', new AbortController().signal)
  t.diagnostic(
    `54 versions, 10 ms/request: upload ${Math.round(performance.now() - start)} ms; serial request-delay floor ${(pending.length * 2 + 2) * 10} ms`,
  )
  assert.equal(upload.state.peak, 6)
  assert.equal(upload.state.active, 0)
  assert.equal(upload.state.calls.get(`PUT blobs/${ref.hash}`), 1)
  for (const id of pending) assert.equal(upload.state.calls.get(`PUT objects/${id}`), 1)
  assert.equal(a.stats().pending, 0)
  const download = measured(remote)
  await synchronize(b, download.storage, 'https://test/dav/', new AbortController().signal)
  assert.equal(download.state.peak, 6)
  assert.equal(download.state.active, 0)
  assert.equal(download.state.calls.get(`GET blobs/${ref.hash}`), 1)
  assert.deepEqual(a.records('task'), b.records('task'))
  for (let record = 0; record < 18; record++) assert.equal(b.history('task', `record-${record}`).length, 3)
})

test('failed parallel upload drains requests, leaves the index unpublished and can retry safely', async t => {
  const { replica, remote } = await setup(t),
    a = replica('a')
  for (let n = 0; n < 18; n++) a.capture('task', `record-${n}`, { n })
  const original = remote.get.bind(remote)
  remote.get = async path =>
    path.startsWith('objects/') ? { bytes: Buffer.from('corrupt'), etag: '"bad"' } : original(path)
  const upload = measured(remote)
  await assert.rejects(synchronize(a, upload.storage, 'https://test/dav/', new AbortController().signal), /校验失败/)
  assert.equal(upload.state.active, 0)
  assert.equal(a.stats().pending, 18)
  assert.deepEqual(JSON.parse(Buffer.from(remote.data.get('index.json')!.bytes).toString()).heads, {})
  remote.get = original
  await synchronize(a, upload.storage, 'https://test/dav/', new AbortController().signal)
  assert.equal(a.stats().pending, 0)
})

test('failed or cancelled parallel download never applies a partial batch and leaves no active requests', async t => {
  const { replica, remote, run } = await setup(t),
    a = replica('a'),
    b = replica('b')
  for (let n = 0; n < 18; n++) a.capture('task', `record-${n}`, { n })
  await run(a)
  const original = remote.get.bind(remote)
  const first = a.working('task', 'record-0')!
  remote.get = async path => (path === `objects/${first}` ? null : original(path))
  const download = measured(remote)
  await assert.rejects(synchronize(b, download.storage, 'https://test/dav/', new AbortController().signal), /校验失败/)
  assert.equal(download.state.active, 0)
  assert.equal(b.records('task').length, 0)
  remote.get = original
  const controller = new AbortController()
  remote.get = async path => {
    if (path.startsWith('objects/')) controller.abort(new Error('cancelled by test'))
    return original(path)
  }
  await assert.rejects(synchronize(b, download.storage, 'https://test/dav/', controller.signal), /cancelled by test/)
  assert.equal(download.state.active, 0)
  assert.equal(b.records('task').length, 0)
})
