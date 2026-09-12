import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { backupDirectories } from '../../helpers/runtime/backups.mjs'
const [profileDirectory, operation] = process.argv.slice(2)
const require = createRequire(join(profileDirectory, 'package.json'))
const load = name => import(pathToFileURL(require.resolve(name)).href)
const { Context } = await load('@deepseek-ai/cordis')
const Notebook = await load('@nook-dsh/provider-notebook-local')
const { default: Storage } = await load('@nook-dsh/adapter-sync-webdav')
const { default: Sync } = await load('@nook-dsh/feature-sync')
const { restoreBackup } = await load('@nook-dsh/storage-backup')
async function assertNote(ctx, expected) {
  const { notes } = await ctx.nookNotes.list({ search: expected.title, trash: expected.trash })
  const note = notes.find(note => note.title === expected.title)
  assert.ok(note, 'The saved note must be readable in the independent store')
  assert.equal(note.markdown.trim(), expected.markdown.trim(), 'Saved text must survive recovery/transfer')
  assert.equal(Boolean(note.deletedAt), expected.trash, 'Trash membership must survive recovery/transfer')
  assert.equal(note.projectId, null, 'Deleting the project must leave its note unfiled')
}

/** Restore newly published backups and read business data through the Note contract. */
export async function verifyBackupRecovery(state, before, expected) {
  const backups = (await backupDirectories(state)).filter(name => !before.includes(name))
  assert.ok(backups.length, 'Restart must publish a recoverable backup')
  const temporary = await mkdtemp(join(tmpdir(), 'nook-backup-acceptance-'))
  try {
    for (const [index, name] of backups.entries()) {
      const restored = join(temporary, String(index))
      restoreBackup(join(state, 'backups', name), restored)
      const ctx = new Context()
      try {
        // The file location selects the shipped store; assertions use Note DTOs,
        // never the backup verifier's verdict or a copy of its manifest logic.
        await ctx.plugin(Notebook, {
          file: join(restored, 'notebook.sqlite'),
          projectsFile: join(restored, 'projects.json'),
        })
        await assertNote(ctx, expected)
      } finally {
        await ctx.fiber.dispose()
      }
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

/** A clean recipient must retrieve the browser-authored note from the remote. */
export async function verifySyncTransfer(connection, expected) {
  const temporary = await mkdtemp(join(tmpdir(), 'nook-sync-recipient-'))
  const ctx = new Context()
  try {
    await ctx.plugin(Notebook, {
      file: join(temporary, 'nook/notebook.sqlite'),
      projectsFile: join(temporary, 'nook/projects.json'),
    })
    await ctx.plugin(Storage)
    await ctx.plugin(Sync, { file: join(temporary, 'private/settings.json') })
    await ctx.nookSync.configure({ ...connection, enabled: true }, AbortSignal.timeout(30_000))
    await ctx.nookSync.run()
    await assertNote(ctx, expected)
  } finally {
    await ctx.fiber.dispose()
    await rm(temporary, { recursive: true, force: true })
  }
}

const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const args = JSON.parse(Buffer.concat(chunks).toString('utf8'))
if (operation === 'backup') await verifyBackupRecovery(...args)
else if (operation === 'sync') await verifySyncTransfer(...args)
else throw new Error('Unknown notebook outcome operation')
