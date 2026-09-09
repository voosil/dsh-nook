import { cp, mkdir, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { createPackedProfile } from './pack-profile.mjs'
import { ROOT } from './profile-lib.mjs'

/** Windows junctions are absolute: install snapshots at their final location. */
export async function prepareWindowsWebRuntime(state, { runPnpm } = {}) {
  const versions = join(state, 'runtimes')
  await mkdir(versions, { recursive: true })
  const destination = await mkdtemp(join(versions, 'web-'))
  const packed = await createPackedProfile(destination, { runPnpm })
  const boot = join(destination, 'boot')
  await mkdir(boot)
  for (const name of ['supervisor', 'shared-broker', 'windows-shutdown'])
    await cp(join(ROOT, 'apps/desktop/dist', `${name}.mjs`), join(boot, `${name}.mjs`))
  return {
    node: process.execPath,
    broker: join(boot, 'shared-broker.mjs'),
    options: {
      state,
      snapshot: {
        seedProfile: packed.profile,
        node: process.execPath,
        supervisor: join(boot, 'supervisor.mjs'),
      },
    },
  }
}
