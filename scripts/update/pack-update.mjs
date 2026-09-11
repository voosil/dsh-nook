import { cp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createPackedProfile } from '../profile/pack-profile.mjs'
import { ROOT } from '../profile/profile-lib.mjs'
import { verifyUpdate } from './verify-update.mjs'
const { directory, commit } = JSON.parse(process.argv[2])
// Install directly at the final path: Windows junctions are absolute.
const packed = await createPackedProfile(join(directory, 'runtime'))
const boot = join(directory, 'boot')
await mkdir(boot)
for (const name of [
  'supervisor',
  'shared-broker',
  'shared-client',
  'shared-paths',
  'runtime',
  'update',
  'windows-shutdown',
])
  await cp(join(ROOT, 'apps/desktop/dist', `${name}.mjs`), join(boot, `${name}.mjs`))
const snapshot = { seedProfile: packed.profile, node: process.execPath, supervisor: join(boot, 'supervisor.mjs') }
const candidate = { protocol: 1, commit, snapshot, broker: join(boot, 'shared-broker.mjs') }
// Keep protocol-1 pack verification for launchers from older source checkouts.
await verifyUpdate(candidate)
await writeFile(join(directory, 'candidate.json'), JSON.stringify(candidate) + '\n', { mode: 0o600 })
