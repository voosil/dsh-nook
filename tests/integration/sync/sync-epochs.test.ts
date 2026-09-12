import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { Replica } from '../../../packages/storage-sync/src/index.ts'
import { synchronize } from '../../../packages/feature-sync/src/engine.ts'
import { publishEpoch } from '../../../packages/feature-sync/src/epochs.ts'
import { canonicalJson, syncEpoch, type SyncStorage } from '../../../packages/capability-sync/src/index.ts'

async function setup(t: import('node:test').TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'nook-epochs-')),
    replicas: Replica[] = []
  t.after(async () => {
    for (const r of replicas) {
      r.dispose()
      r.db.close()
    }
    await rm(root, { recursive: true, force: true })
  })
  const replica = (name: string) => {
    const r = new Replica(
      new DatabaseSync(join(root, name + '.sqlite')),
      join(root, name + '-files'),
      join(root, name + '-backups'),
      () => {},
    )
    r.registerType({ type: 'test', schema: 1, validate() {}, reset() {}, apply() {} })
    replicas.push(r)
    return r
  }
  const data = new Map<string, { bytes: Uint8Array; etag: string }>()
  const remote: SyncStorage = {
    async probe() {},
    async get(path) {
      return data.get(path) ?? null
    },
    async put(path, bytes, expected) {
      const old = data.get(path)
      if (expected === null ? Boolean(old) : old?.etag !== expected) return false
      data.set(path, { bytes, etag: '"' + createHash('sha256').update(bytes).digest('hex') + '"' })
      return true
    },
  }
  const run = (r: Replica) => synchronize(r, remote, 'https://test/dav/', new AbortController().signal)
  const publish = (r: Replica, remove: string[]) =>
    publishEpoch(remote, r.planHistoryRewrite(remove), new AbortController().signal)
  return { root, replica, remote, data, run, publish }
}

test('same-vault epoch removes selected history, preserves current values, fences legacy format and permits subsequent sync', async t => {
  const { replica, data, run, publish } = await setup(t),
    a = replica('a'),
    b = replica('b')
  a.capture('test', 'one', { text: 'create' })
  const folded = a.capture('test', 'one', { text: 'folded' })
  a.capture('test', 'one', { text: 'latest' })
  await run(a)
  await run(b)
  const before = a.remoteIndex()!
  const next = await publish(a, [folded])
  assert.equal(next.vaultId, before.vaultId)
  assert.equal(next.format, 2)
  assert.notEqual(syncEpoch(next), syncEpoch(before))
  assert.ok(data.has(`objects/${folded}`), 'retired remote objects remain recoverable')
  await run(a)
  await run(b)
  assert.equal(a.version(folded), null)
  assert.equal(a.history('test', 'one').length, 2)
  assert.deepEqual(a.records('test'), b.records('test'))
  assert.deepEqual(a.records('test')[0]!.value.data, { text: 'latest' })
  b.capture('test', 'one', { text: 'after migration' })
  await run(b)
  await run(a)
  assert.deepEqual(a.records('test')[0]!.value.data, { text: 'after migration' })
})

test('offline edits based on a removed version survive as a rebased branch without resurrecting all retired history', async t => {
  const { replica, run, publish } = await setup(t),
    a = replica('a'),
    b = replica('b')
  a.capture('test', 'one', { text: 'base' })
  const folded = a.capture('test', 'one', { text: 'middle' })
  await run(a)
  await run(b)
  b.capture('test', 'one', { text: 'offline' })
  a.capture('test', 'one', { text: 'remote' })
  await run(a)
  await publish(a, [folded])
  await run(b)
  await run(a)
  const content = a.history('test', 'one').map(v => (v.value.data as { text: string }).text)
  assert.ok(content.includes('offline'))
  assert.ok(content.includes('remote'))
  assert.equal(a.history('test', 'one').length, 4, 'only the baseline required by the offline edit returns')
  assert.deepEqual(a.snapshot().heads, b.snapshot().heads)
})

test('clients can skip several epochs, unknown migrations and broken backups leave local data untouched', async t => {
  const { root, replica, run, publish, remote } = await setup(t),
    a = replica('a'),
    b = replica('b'),
    c = replica('c')
  a.capture('test', 'one', { text: 'base' })
  const first = a.capture('test', 'one', { text: 'first' })
  a.capture('test', 'one', { text: 'second' })
  await run(a)
  await run(b)
  await run(c)
  await publish(a, [first])
  await run(a)
  const second = a.capture('test', 'one', { text: 'third' })
  a.capture('test', 'one', { text: 'fourth' })
  await run(a)
  await publish(a, [second])
  await run(a)
  await run(b)
  assert.deepEqual(a.records('test'), b.records('test'))
  const before = c.snapshot()
  await writeFile(join(root, 'c-backups'), 'blocked')
  await assert.rejects(run(c))
  assert.deepEqual(c.snapshot(), before)
  const plan = a.planHistoryRewrite([])
  await publishEpoch(
    remote,
    { ...plan, migration: { id: 'future-schema', version: 7, data: {} } },
    new AbortController().signal,
  )
  const previous = a.snapshot(),
    epoch = a.remoteIndex()
  await assert.rejects(run(a), /更新应用/)
  assert.deepEqual(a.snapshot(), previous)
  assert.deepEqual(a.remoteIndex(), epoch)
})

test('epoch CAS loses safely to an old writer, and cancellation does not publish the new epoch', async t => {
  const { replica, remote, run } = await setup(t),
    a = replica('a')
  const first = a.capture('test', 'one', {})
  a.capture('test', 'one', { latest: true })
  await run(a)
  const plan = a.planHistoryRewrite([first]),
    before = a.remoteIndex()!
  const put = remote.put.bind(remote)
  remote.put = async (path, bytes, expected, signal) => {
    if (path.endsWith('.epoch')) {
      const old = await remote.get('index.json', signal)
      await put(
        'index.json',
        Buffer.from(canonicalJson({ ...before, generation: String(BigInt(before.generation) + 1n) })),
        old!.etag,
        signal,
      )
    }
    return put(path, bytes, expected, signal)
  }
  await assert.rejects(publishEpoch(remote, plan, new AbortController().signal), /并发更新/)
  assert.equal(
    JSON.parse(Buffer.from((await remote.get('index.json', new AbortController().signal))!.bytes).toString()).format,
    1,
  )
  assert.ok(a.version(first))
})

test('a registered future migration uses the same transport, backup and adoption lifecycle', async t => {
  const { replica, remote, run } = await setup(t),
    a = replica('a'),
    b = replica('b')
  const old = a.capture('test', 'one', { text: 'old schema' })
  await run(a)
  await run(b)
  const source = a.planHistoryRewrite([]),
    value = { ...source.versions[0]!.value, data: { text: 'new schema' } }
  const hash = createHash('sha256').update(canonicalJson(value)).digest('hex')
  for (const r of [a, b])
    r.registerEpochMigration({
      id: 'example-schema',
      version: 1,
      validate() {},
      mapped(id) {
        return id === old ? hash : undefined
      },
      rewrite(v, resolve) {
        return { ...v, parents: v.parents.map(resolve) }
      },
    })
  await publishEpoch(
    remote,
    {
      ...source,
      versions: [{ hash, value }],
      heads: { 'test/one': [hash] },
      migration: { id: 'example-schema', version: 1, data: {} },
    },
    new AbortController().signal,
  )
  await run(a)
  await run(b)
  assert.deepEqual(b.records('test')[0]!.value.data, { text: 'new schema' })
})

test('epoch-local archives recover a browser draft based on a pruned version after multiple migrations', async t => {
  const { replica, run, publish } = await setup(t),
    a = replica('a')
  a.capture('test', 'one', { text: 'create' })
  const draftBase = a.capture('test', 'one', { text: 'old draft baseline' })
  a.capture('test', 'one', { text: 'latest' })
  await run(a)
  await publish(a, [draftBase])
  await run(a)
  const removable = a.capture('test', 'one', { text: 'next stage' })
  a.capture('test', 'one', { text: 'current' })
  await run(a)
  await publish(a, [removable])
  await run(a)
  assert.equal(a.version(draftBase), null)
  const mapped = a.rebaseSavedVersion(draftBase)!
  assert.deepEqual(a.version(mapped)!.data, { text: 'old draft baseline' })
  a.capture('test', 'one', { text: 'recovered browser edit' }, false, [], [mapped])
  await run(a)
  assert.ok(a.history('test', 'one').some(v => (v.value.data as { text: string }).text === 'recovered browser edit'))
})

test('a lost publication response is retryable with the same plan and cannot create a second epoch', async t => {
  const { replica, remote, run } = await setup(t),
    a = replica('a')
  const first = a.capture('test', 'one', {})
  a.capture('test', 'one', { text: 'latest' })
  await run(a)
  const plan = a.planHistoryRewrite([first]),
    put = remote.put.bind(remote)
  let lost = true
  remote.put = async (path, bytes, expected, signal) => {
    const ok = await put(path, bytes, expected, signal)
    if (path === 'index.json' && JSON.parse(Buffer.from(bytes).toString()).format === 2 && lost) {
      lost = false
      throw new Error('lost response')
    }
    return ok
  }
  await assert.rejects(publishEpoch(remote, plan, new AbortController().signal), /lost response/)
  const before = JSON.parse(
    Buffer.from((await remote.get('index.json', new AbortController().signal))!.bytes).toString(),
  )
  const result = await publishEpoch(remote, plan, new AbortController().signal)
  assert.equal(result.epoch, before.epoch)
  assert.equal(result.generation, before.generation)
})

test('cancelled publication, invalid parents and corrupt transition leave the active index and local data intact', async t => {
  const { replica, remote, run, data } = await setup(t),
    a = replica('a'),
    b = replica('b')
  const old = a.capture('test', 'one', { text: 'base' })
  a.capture('test', 'one', { text: 'current' })
  await run(a)
  await run(b)
  const plan = a.planHistoryRewrite([old]),
    before = a.remoteIndex()
  const controller = new AbortController(),
    put = remote.put.bind(remote)
  remote.put = async (path, bytes, expected, signal) => {
    const ok = await put(path, bytes, expected, signal)
    if (path.endsWith('.epoch')) controller.abort()
    return ok
  }
  await assert.rejects(publishEpoch(remote, plan, controller.signal))
  assert.deepEqual(JSON.parse(Buffer.from(data.get('index.json')!.bytes).toString()), before)
  remote.put = put
  const invalid = { ...plan.versions[0]!.value, id: 'another', parents: [plan.versions[0]!.hash] }
  const hash = createHash('sha256').update(canonicalJson(invalid)).digest('hex')
  await assert.rejects(
    publishEpoch(
      remote,
      {
        ...plan,
        versions: [...plan.versions, { hash, value: invalid }],
        heads: { ...plan.heads, 'test/another': [hash] },
      },
      new AbortController().signal,
    ),
    /父引用/,
  )
  const next = await publishEpoch(remote, plan, new AbortController().signal)
  const snapshot = b.snapshot()
  data.set(`objects/${next.transition}.epoch`, { bytes: Buffer.from('corrupt'), etag: '"corrupt"' })
  await assert.rejects(run(b), /校验失败/)
  assert.deepEqual(b.snapshot(), snapshot)
  assert.deepEqual(b.remoteIndex(), before)
})

test('projection failures roll back epoch archives, reset, active versions and migration receipts together', async t => {
  const { replica, run, publish } = await setup(t),
    a = replica('a'),
    b = replica('b')
  b.db.exec("CREATE TABLE projection(value TEXT); INSERT INTO projection VALUES('original')")
  b.registerType({
    type: 'projection',
    schema: 1,
    validate() {},
    reset() {
      b.db.exec('DELETE FROM projection')
    },
    apply() {
      throw new Error('projection failed')
    },
  })
  const old = a.capture('test', 'one', { text: 'base' })
  a.capture('test', 'one', { text: 'current' })
  a.capture('projection', 'one', {})
  await run(a)
  // Leave the unknown projection unselected while recording the source baseline.
  const other = replica('other')
  await run(other)
  b.receive(other.history('test', 'one'), {
    ...other.remoteIndex()!,
    heads: { 'test/one': other.snapshot().heads['test/one']! },
  })
  const snapshot = b.snapshot(),
    before = b.remoteIndex()
  await publish(a, [old])
  await assert.rejects(run(b), /projection failed/)
  assert.deepEqual(b.snapshot(), snapshot)
  assert.deepEqual(b.remoteIndex(), before)
  assert.equal(b.db.prepare('SELECT value FROM projection').get()!.value, 'original')
  assert.equal(b.db.prepare('SELECT count(*) n FROM sync_epoch_archive').get()!.n, 0)
  assert.equal(b.db.prepare("SELECT count(*) n FROM sync_state WHERE key LIKE 'epoch/%'").get()!.n, 0)
})

test('a fresh client refuses an unsupported epoch migration before importing records', async t => {
  const { replica, remote, run } = await setup(t),
    a = replica('a'),
    fresh = replica('fresh')
  a.capture('test', 'one', { text: 'current' })
  await run(a)
  await publishEpoch(
    remote,
    { ...a.planHistoryRewrite([]), migration: { id: 'future', version: 3, data: {} } },
    new AbortController().signal,
  )
  await assert.rejects(run(fresh), /更新应用/)
  assert.deepEqual(fresh.snapshot(), { heads: {}, pending: [] })
})

test('unknown cross-record references preserve the exact referenced snapshot and all its ancestry', async t => {
  const { replica, run } = await setup(t),
    a = replica('a')
  const base = a.capture('test', 'one', { text: 'base' })
  const referenced = a.capture('test', 'one', { text: 'referenced' })
  a.capture('test', 'one', { text: 'latest' })
  a.capture('unknown', 'source', { nested: { sourceVersion: referenced } })
  await run(a)
  const plan = a.planHistoryRewrite([base, referenced])
  assert.ok(plan.versions.some(v => v.hash === base))
  assert.ok(plan.versions.some(v => v.hash === referenced))
  assert.equal((plan.migration.data as { mapping: Record<string, string | null> }).mapping[referenced], referenced)
})
