import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { userState } from '../../apps/desktop/src/shared-paths.ts'
import { acquireDataLock, createBackup, restoreBackup, verifyBackup } from '../../packages/storage-backup/src/index.ts'

const { positionals, values } = parseArgs({
  args: process.argv.slice(2).filter(arg => arg !== '--'),
  allowPositionals: true,
  options: {
    source: { type: 'string' },
    output: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    help: { type: 'boolean' },
  },
})
const usage = `Nook data backup (stop Nook before creating a backup)
  pnpm backup create [--source <data-directory>] [--output <backup-directory>]
  pnpm backup verify --from <backup>
  pnpm backup restore --from <backup> --to <new-directory>
Defaults: source=${resolve(userState(), 'harness/nook')}, output=${resolve(userState(), 'backups')}
Restore refuses existing destinations. Recovery records extract as record.json.
`
try {
  const [command, extra] = positionals
  if (values.help || !command) console.log(usage)
  else if (command === 'create' && !extra && !values.from && !values.to) {
    const source = resolve(values.source ?? resolve(userState(), 'harness/nook'))
    const release = acquireDataLock(source)
    try {
      console.log(createBackup(source, values.output ?? resolve(userState(), 'backups')))
    } finally {
      release()
    }
  } else if (command === 'verify' && values.from && !extra && !values.source && !values.output && !values.to) {
    const manifest = verifyBackup(values.from)
    console.log(`Verified ${manifest.kind} backup: ${manifest.files.length} files (${manifest.createdAt}).`)
  } else if (command === 'restore' && values.from && values.to && !extra && !values.source && !values.output) {
    const manifest = restoreBackup(values.from, values.to)
    console.log(`Restored ${manifest.files.length} files to ${resolve(values.to)}.`)
  } else throw new Error(usage)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
