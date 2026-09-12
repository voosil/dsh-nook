import * as backup from '../../../packages/storage-backup/src/index.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { retainHome, recoverHome, commitHome } from '../../../apps/desktop/src/update-backup.ts'
import { readActiveUpdate, type ActiveUpdate } from '../../../apps/desktop/src/update.ts'

async function fixture(t: any) {
  const state = await mkdtemp(join(tmpdir(), 'nook-update-backup-'))
  t.after(() => rm(state, { recursive: true, force: true }))
  await mkdir(join(state, 'harness/profiles/nook/node_modules'), { recursive: true })
  await mkdir(join(state, 'harness/nook'), { recursive: true })
  for (const generated of ['profiles/node_modules', 'profiles/nook/.dsh-module-fallback/node_modules']) {
    await mkdir(join(state, 'harness', generated), { recursive: true })
    await symlink(tmpdir(), join(state, 'harness', generated, 'generated'))
  }
  await writeFile(join(state, 'harness/credential'), 'private-test-credential')
  await writeFile(join(state, 'harness/profiles/nook/cordis.patch.yml'), '[]')
  await symlink(tmpdir(), join(state, 'harness/profiles/nook/node_modules/generated'))
  const db = new DatabaseSync(join(state, 'harness/nook/notes.sqlite'))
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE notes(body TEXT); INSERT INTO notes VALUES ('original')")
  db.close()
  return state
}
test('full update backup restores configuration and SQLite; failed migrated home is retained', async t => {
  const state = await fixture(t)
  const receipt = await retainHome(state, backup)
  await writeFile(join(state, 'harness/credential'), 'changed')
  const db = new DatabaseSync(join(state, 'harness/nook/notes.sqlite'))
  db.exec("ALTER TABLE notes ADD COLUMN migrated TEXT; UPDATE notes SET body='new'")
  db.close()
  assert.equal(await recoverHome(state, backup), true)
  assert.equal(await readFile(join(state, 'harness/credential'), 'utf8'), 'private-test-credential')
  assert.equal(await readFile(join(receipt.failed, 'credential'), 'utf8'), 'changed')
  const restored = new DatabaseSync(join(state, 'harness/nook/notes.sqlite'))
  assert.equal(restored.prepare('SELECT body FROM notes').get()!.body, 'original')
  restored.close()
  assert.equal(await recoverHome(state, backup), false)
})
test('failed backup leaves the original home and prevents activation', async t => {
  const state = await fixture(t)
  await symlink(tmpdir(), join(state, 'harness/unsupported-user-link'))
  await assert.rejects(retainHome(state, backup), /符号链接/)
  assert.equal(await readFile(join(state, 'harness/credential'), 'utf8'), 'private-test-credential')
})
test('committed update survives restart through the atomic recovery receipt', async t => {
  const state = await fixture(t)
  await retainHome(state, backup)
  const active: ActiveUpdate = {
    protocol: 1,
    launch: {
      node: process.execPath,
      broker: '/candidate/broker.mjs',
      options: {
        state,
        snapshot: {
          node: process.execPath,
          supervisor: '/candidate/supervisor.mjs',
          seedProfile: '/candidate/profile',
        },
      },
    },
  }
  await commitHome(state, active)
  assert.deepEqual(await readActiveUpdate(state), active)
  assert.equal(await recoverHome(state, backup), false)
  // A subsequent failed upgrade keeps the previous successful startup pointer.
  await retainHome(state, backup)
  assert.deepEqual(await readActiveUpdate(state), active)
  await recoverHome(state, backup)
  assert.deepEqual(await readActiveUpdate(state), active)
})

test('interrupted recovery completes after the original home has already been restored', async t => {
  const state = await fixture(t)
  const receipt = await retainHome(state, backup)
  await rename(join(state, 'harness'), receipt.failed)
  await rename(receipt.previous, join(state, 'harness'))
  await writeFile(join(state, 'updates/recovery.json'), JSON.stringify({ ...receipt, stage: 'restoring' }))
  assert.equal(await recoverHome(state, backup), true)
  assert.equal(await readFile(join(state, 'harness/credential'), 'utf8'), 'private-test-credential')
  assert.equal(await recoverHome(state, backup), false)
})
