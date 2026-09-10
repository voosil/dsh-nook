import { cp, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createPackedProfile } from '../profile/pack-profile.mjs'
import { ROOT } from '../profile/profile-lib.mjs'
import { activateProfile } from '../../apps/desktop/dist/payload.mjs'
import { DesktopRuntime } from '../../apps/desktop/dist/runtime.mjs'
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
const testState = await mkdtemp(join(tmpdir(), 'nook-update-smoke-'))
let runtime
try {
  const config = await activateProfile({ state: testState, ...snapshot })
  runtime = new DesktopRuntime(
    config,
    line => console.log(line),
    () => {},
  )
  const url = await runtime.ready
  const exchange = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) })
  const cookie = exchange.headers
    .getSetCookie()
    .map(value => value.split(';')[0])
    .join('; ')
  if (!cookie) throw new Error('Candidate did not establish an authenticated session')
  const response = await fetch(new URL('/', url), { headers: { cookie }, signal: AbortSignal.timeout(10000) })
  if (!response.ok || !(await response.text()).includes('<html')) throw new Error('Candidate web smoke failed')
} finally {
  await runtime?.stop()
  await rm(testState, { recursive: true, force: true })
}
await writeFile(
  join(directory, 'candidate.json'),
  JSON.stringify({ protocol: 1, commit, snapshot, broker: join(boot, 'shared-broker.mjs') }) + '\n',
  { mode: 0o600 },
)
