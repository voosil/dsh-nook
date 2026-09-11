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
import { canonicalJson } from '../../packages/capability-sync/src/index.ts'

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
  const path = [...remote.data.keys()].find(p => p.endsWith('.pack'))!
  const savedObject = remote.data.get(path)!
  remote.data.set(path, { ...savedObject, bytes: Buffer.from('{}') })
  await assert.rejects(run(b), /校验失败/)
  assert.equal(b.records('task').length, 0)
  remote.data.set(path, savedObject)
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
  const first = [...remote.data.keys()].find(p => p.endsWith('.pack'))!
  remote.get = async path => (path === first ? null : original(path))
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

function seedChain(replica: Replica, length: number) {
  let parent: string | undefined
  replica.transaction(() => {
    for (let n = 0; n < length; n++) {
      const value: RecordVersion = {
        format: 1,
        type: 'task',
        id: 'long',
        schema: 1,
        deleted: false,
        parents: parent ? [parent] : [],
        blobs: [],
        data: { text: 'repeated content '.repeat(100), n },
      }
      // Large disposable history fixture; avoid measuring capture's ancestor reduction here.
      const body = canonicalJson(value),
        hash = digest(Buffer.from(body))
      replica.db.prepare('INSERT INTO sync_versions VALUES(?,?,1)').run(hash, body)
      parent = hash
    }
    replica.db.prepare('INSERT INTO sync_heads VALUES(?,?)').run('task/long', parent!)
    replica.db.prepare('INSERT INTO sync_working VALUES(?,?)').run('task/long', parent!)
  })
}

test('a thousand-version history downloads in compressed blocks and reuses sealed prefixes on the next edit', async t => {
  const { replica, remote, run } = await setup(t),
    a = replica('a'),
    b = replica('b')
  seedChain(a, 1000)
  await run(a)
  const download = measured(remote, 2)
  const started = performance.now()
  await synchronize(b, download.storage, 'https://test/dav/', new AbortController().signal)
  const gets = [...download.state.calls].filter(([key]) => key.startsWith('GET '))
  assert.equal(gets.length, 10, 'one index, one manifest, eight chunks replace 1001 serial GETs')
  assert.equal(gets.filter(([key]) => key.endsWith('.pack')).length, 8)
  assert.equal(b.history('task', 'long').length, 1000)
  const rawBytes = [...remote.data]
    .filter(([path]) => /^objects\/[a-f0-9]{64}$/.test(path))
    .reduce((sum, [, item]) => sum + item.bytes.length, 0)
  const packedBytes = [...remote.data]
    .filter(([path]) => path.endsWith('.pack'))
    .reduce((sum, [, item]) => sum + item.bytes.length, 0)
  assert.ok(packedBytes < rawBytes / 5)
  t.diagnostic(
    `1000 versions: ${gets.length} GETs, ${Math.round(performance.now() - started)} ms at 2 ms/request; ${rawBytes} raw bytes -> ${packedBytes} packed bytes`,
  )
  a.capture('task', 'long', { text: 'next edit' })
  const upload = measured(remote, 0)
  await synchronize(a, upload.storage, 'https://test/dav/', new AbortController().signal)
  assert.equal([...upload.state.calls.keys()].filter(k => k.startsWith('PUT ') && k.endsWith('.pack')).length, 1)
  const next = measured(remote, 0)
  await synchronize(b, next.storage, 'https://test/dav/', new AbortController().signal)
  assert.equal([...next.state.calls.keys()].filter(k => k.startsWith('GET ') && k.endsWith('.pack')).length, 1)
  assert.equal(b.history('task', 'long').length, 1001)
  let reads = 0
  const original = b.version.bind(b)
  b.version = hash => {
    reads++
    return original(hash)
  }
  await run(b)
  assert.ok(reads < 10, `unchanged sync must not scan history (${reads} reads)`)
})

test('legacy indices remain readable, new clients publish acceleration for existing histories, and raw objects survive', async t => {
  const { replica, remote, run } = await setup(t),
    a = replica('a'),
    b = replica('b')
  seedChain(a, 150)
  await run(a)
  const object = remote.data.get('index.json')!
  const index = JSON.parse(Buffer.from(object.bytes).toString())
  delete index.packs
  index.generation = String(BigInt(index.generation) + 1n)
  await remote.put('index.json', Buffer.from(canonicalJson(index)), object.etag)
  const download = measured(remote, 0)
  await synchronize(b, download.storage, 'https://test/dav/', new AbortController().signal)
  assert.equal([...download.state.calls.keys()].filter(k => /^GET objects\/[a-f0-9]{64}$/.test(k)).length, 150)
  assert.ok(JSON.parse(Buffer.from(remote.data.get('index.json')!.bytes).toString()).packs[b.working('task', 'long')!])
  // Legacy readers can still walk every canonical single-object parent reference.
  for (const item of b.history('task', 'long')) {
    const object = remote.data.get(`objects/${item.hash}`)!
    assert.equal(digest(object.bytes), item.hash)
    assert.deepEqual(JSON.parse(Buffer.from(object.bytes).toString()), item.value)
  }
})

test('failed history pack publication preserves pending writes and a failed receive never caches partial blocks', async t => {
  const { replica, remote, run } = await setup(t),
    a = replica('a'),
    b = replica('b')
  seedChain(a, 150)
  const get = remote.get.bind(remote)
  remote.get = async path => (path.endsWith('.pack') ? { bytes: Buffer.from('corrupt'), etag: '"bad"' } : get(path))
  await assert.rejects(run(a), /校验失败/)
  assert.equal(a.stats().pending, 150)
  assert.deepEqual(JSON.parse(Buffer.from(remote.data.get('index.json')!.bytes).toString()).heads, {})
  remote.get = get
  await run(a)
  const paths = [...remote.data.keys()].filter(path => path.endsWith('.pack'))
  remote.get = async path => (path === paths[1] ? null : get(path))
  await assert.rejects(run(b), /校验失败/)
  assert.equal(b.snapshot().pending.length, 0)
  assert.equal(b.records('task').length, 0)
  assert.ok(paths.every(path => !b.hasPack(path.slice(8, -5))))
  remote.get = get
  await run(b)
  assert.equal(b.history('task', 'long').length, 150)
})

test('valid outer pack hashes do not excuse corrupt versions, cross-record data or oversized decompression', async t => {
  const { gzipSync } = await import('node:zlib')
  const { replica, remote, run } = await setup(t),
    a = replica('a')
  a.capture('task', 'one', { text: 'base' })
  await run(a)
  const originalIndex = JSON.parse(Buffer.from(remote.data.get('index.json')!.bytes).toString())
  const head = a.working('task', 'one')!
  const badContents = [
    Buffer.from(canonicalJson([{ hash: head, value: { ...a.version(head)!, data: { text: 'tampered' } } }])),
    Buffer.alloc(8_000_001, ' '),
  ]
  for (const [n, raw] of badContents.entries()) {
    const chunk = gzipSync(raw),
      chunkHash = digest(chunk)
    remote.data.set(`objects/${chunkHash}.pack`, { bytes: chunk, etag: '"fixture"' })
    const manifest = Buffer.from(canonicalJson({ format: 1, head, chunks: [chunkHash] })),
      manifestHash = digest(manifest)
    remote.data.set(`objects/${manifestHash}.history`, { bytes: manifest, etag: '"fixture"' })
    remote.data.set('index.json', {
      bytes: Buffer.from(canonicalJson({ ...originalIndex, packs: { [head]: manifestHash } })),
      etag: '"fixture"',
    })
    const b = replica(`bad-${n}`)
    await assert.rejects(run(b), /校验失败|大小限制/)
    assert.equal(b.records('task').length, 0)
    assert.equal(b.hasPack(chunkHash), false)
  }
})
