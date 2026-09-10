/** Only use the disposable Linux fixture from verify_linux.py. */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { WebDavStorage } from '../../packages/adapter-sync-webdav/src/index.ts'
import { Replica } from '../../packages/storage-sync/src/index.ts'
import { synchronize } from '../../packages/feature-sync/src/engine.ts'
import { parseSyncConnection } from '../../packages/capability-sync/src/connection.ts'

const config = parseSyncConnection(await readFile(process.argv[2]!, 'utf8'))
assert.equal(config.url, 'https://127.0.0.1:18443/nook/', 'Use only the disposable Linux fixture')
const root = await mkdtemp(join(tmpdir(), 'nook-linux-client-'))
const replicas = ['a', 'b'].map(
  name =>
    new Replica(
      new DatabaseSync(join(root, name + '.sqlite')),
      join(root, name),
      join(root, name + '-backup'),
      () => {},
    ),
)
const remote = new WebDavStorage(config)
const untrusted = new WebDavStorage({ ...config, caCert: '' })
try {
  const signal = () => AbortSignal.timeout(60000)
  await assert.rejects(untrusted.probe(signal()))
  await remote.probe(signal())
  for (const replica of replicas) replica.registerType({ type: 'task', schema: 1, validate: () => {} })
  const [a, b] = replicas as [Replica, Replica]
  const run = (replica: Replica) => synchronize(replica, remote, config.url, signal())
  a.capture('task', 'one', { text: 'base' })
  await run(a)
  await run(b)
  a.capture('task', 'one', { text: 'left' })
  b.capture('task', 'one', { text: 'right' })
  await Promise.all([run(a), run(b)])
  await run(a)
  await run(b)
  assert.equal(a.conflicts().length, 1)
  const conflict = a.conflicts()[0]!
  a.resolve(
    conflict.key,
    conflict.versions.map(v => v.hash),
    conflict.versions[0]!.hash,
    false,
  )
  await run(a)
  await run(b)
  assert.deepEqual(a.records('task'), b.records('task'))
  assert.equal(b.stats().pending, 0)
  console.log('Nook adapter: real Linux TLS, private CA, two replicas, concurrent conflict and convergence passed')
} finally {
  remote.dispose()
  untrusted.dispose()
  for (const replica of replicas) {
    replica.dispose()
    replica.db.close()
  }
  await rm(root, { recursive: true, force: true })
}
