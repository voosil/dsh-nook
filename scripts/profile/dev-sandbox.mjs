import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
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
    // A junction of node_modules breaks nested relative pnpm links on Windows.
    // Own the container so DSH's fallback links also remain in this sandbox.
    const manifest = JSON.parse(await readFile(resolve(profile, 'package.json'), 'utf8'))
    await mkdir(resolve(profile, 'node_modules'))
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      const target = await realpath(resolve(PROFILE_DIR, 'node_modules', name))
      const link = resolve(profile, 'node_modules', name)
      await mkdir(dirname(link), { recursive: true })
      await symlink(target, link, 'junction')
    }
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
