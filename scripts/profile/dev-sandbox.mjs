import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile, lstat, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { PROFILE_DIR, ROOT, devRuntimeEnv } from './profile-lib.mjs'
import { acquireNativeFileLock } from '../shared/native-file-lock.mjs'

/** Keep development writes separate from the persistent usage home. */
export async function createDevSandbox({ persistent = false, desktop = false } = {}) {
  const home = persistent
    ? resolve(ROOT, '.dsh-dev/sandboxes', desktop ? 'desktop' : 'web')
    : await mkdtemp(join(tmpdir(), 'nook-dev-'))
  await mkdir(home, { recursive: true, mode: 0o700 })
  const lock = `${home}.lock`
  let releaseLock
  if (persistent) {
    // Directory/owner.json leftovers from older launchers are not live locks.
    await mkdir(lock, { recursive: true, mode: 0o700 })
    try {
      releaseLock = acquireNativeFileLock(resolve(lock, 'lease'))
    } catch (error) {
      if (!['EAGAIN', 'EWOULDBLOCK'].includes(error.code)) throw error
      throw new Error(
        `Development data is in use by another running launcher: ${home}. Stop it before starting another.`,
        {
          cause: error,
        },
      )
    }
  }
  let disposed = false
  const dispose = async () => {
    if (disposed) return
    disposed = true
    if (persistent) releaseLock()
    else await rm(home, { recursive: true, force: true })
  }
  try {
    const profile = resolve(home, 'profiles/nook')
    await mkdir(profile, { recursive: true })
    await mkdir(resolve(home, 'agents'), { recursive: true })
    await writeFile(resolve(profile, 'package.json'), await readFile(resolve(PROFILE_DIR, 'package.json')))
    // Start independent configuration; never import historical usage patches.
    for (const patch of [resolve(profile, 'cordis.patch.yml'), resolve(home, 'cordis.patch.yml')]) {
      await writeFile(patch, '[]\n', { flag: 'wx' }).catch(error => {
        if (error.code !== 'EEXIST') throw error
      })
    }
    // A junction of node_modules breaks nested relative pnpm links on Windows.
    // Own the container so DSH's fallback links also remain in this sandbox.
    const manifest = JSON.parse(await readFile(resolve(profile, 'package.json'), 'utf8'))
    await mkdir(resolve(profile, 'node_modules'), { recursive: true })
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      const target = await realpath(resolve(PROFILE_DIR, 'node_modules', name))
      const link = resolve(profile, 'node_modules', name)
      await mkdir(dirname(link), { recursive: true })
      const existing = await lstat(link).catch(error => {
        if (error.code !== 'ENOENT') throw error
        return null
      })
      if (existing) {
        if (!existing.isSymbolicLink()) throw new Error(`Expected a generated dependency link: ${link}`)
        if ((await realpath(link).catch(() => null)) === target) continue
        await unlink(link)
      }
      await symlink(target, link, 'junction')
    }
    return {
      home,
      env: { ...devRuntimeEnv(), DSH_HOME: home, DSH_AGENTS_HOME: resolve(home, 'agents') },
      dispose,
    }
  } catch (error) {
    await dispose()
    throw error
  }
}
