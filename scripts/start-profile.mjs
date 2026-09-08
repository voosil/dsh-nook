import { copyFile, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, basename } from 'node:path'
import { createPackedProfile } from './pack-profile.mjs'
import { createProfileArgs } from './run-profile-args.mjs'
import { DEV_HOME, PROFILE_DIR, ROOT, PNPM_VERSION, devRuntimeEnv, exists } from './profile-lib.mjs'
import { ProcessScope } from './process-scope.mjs'

const temporaryRoot = await mkdtemp(join(tmpdir(), 'nook-start-'))
const profileName = basename(temporaryRoot)
const profileLink = resolve(DEV_HOME, 'profiles', profileName)
const processes = new ProcessScope()
let stopped = false
let releaseDataLock
const stop = () => {
  stopped = true
  void processes.dispose()
}
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
try {
  const runPnpm = (args, options = {}) => {
    if (stopped) throw new Error('startup cancelled')
    return processes.run('corepack', [`pnpm@${PNPM_VERSION}`, ...args], {
      cwd: ROOT,
      ...options,
      env: { ...process.env, CI: 'true', ...options.env },
    })
  }
  await runPnpm(['run', 'build'])
  const { profile, bin } = await createPackedProfile(temporaryRoot, { runPnpm })
  if (!stopped) {
    const { acquireDataLock, createBackup } = await import('../packages/storage-backup/lib/index.js')
    const data = resolve(DEV_HOME, 'nook')
    releaseDataLock = acquireDataLock(data)
    if (await exists(data)) {
      const backup = createBackup(data, resolve(ROOT, '.nook-backups'), 'before-start')
      console.log(`[nook start] Verified data backup: ${backup}`)
    }
    const patch = resolve(PROFILE_DIR, 'cordis.patch.yml')
    if (await exists(patch)) await copyFile(patch, resolve(profile, 'cordis.patch.yml'))
    await mkdir(resolve(DEV_HOME, 'profiles'), { recursive: true })
    await symlink(profile, profileLink, 'junction')
    const args = createProfileArgs(bin, ROOT, process.argv.slice(2), { profile: profileName, defaultPort: 3081 })
    console.log(
      '[nook start] Running a fixed build on port 3081 (unless overridden). Source edits take effect on the next start.',
    )
    await processes.run(process.execPath, args, { cwd: ROOT, env: { ...process.env, ...devRuntimeEnv() } })
  }
} catch (error) {
  if (!stopped) throw error
} finally {
  await processes.dispose()
  releaseDataLock?.()
  await rm(profileLink, { force: true })
  await rm(temporaryRoot, { recursive: true, force: true })
  process.removeListener('SIGINT', stop)
  process.removeListener('SIGTERM', stop)
}
