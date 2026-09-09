import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PROFILE_DIR, devRuntimeEnv } from './profile-lib.mjs'

/** Keep development writes separate from the persistent usage home. */
export async function createDevSandbox() {
  const home = await mkdtemp(join(tmpdir(), 'nook-dev-'))
  try {
    const profile = resolve(home, 'profiles/nook')
    await mkdir(profile, { recursive: true })
    await mkdir(resolve(home, 'agents'))
    await copyFile(resolve(PROFILE_DIR, 'package.json'), resolve(profile, 'package.json'))
    await copyFile(resolve(PROFILE_DIR, 'cordis.patch.yml'), resolve(profile, 'cordis.patch.yml'))
    await writeFile(resolve(home, 'cordis.patch.yml'), '[]\n')
    await symlink(resolve(PROFILE_DIR, 'node_modules'), resolve(profile, 'node_modules'), 'junction')
    return {
      home,
      env: { ...devRuntimeEnv(), DSH_HOME: home, DSH_AGENTS_HOME: resolve(home, 'agents') },
      dispose: () => rm(home, { recursive: true, force: true }),
    }
  } catch (error) {
    await rm(home, { recursive: true, force: true })
    throw error
  }
}
