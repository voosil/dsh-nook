import { runTaskAcceptance } from '../../../helpers/scenarios/tasks.mjs'
import { verifyAuthentication } from '../../../helpers/scenarios/authentication.mjs'
import { test } from 'node:test'
import { runNotebookAcceptance } from '../../../helpers/scenarios/notebook.mjs'

import { mkdtemp, readdir, readFile, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createPackedProfile } from '../../../../scripts/profile/pack-profile.mjs'
import { withWebRuntime } from '../../../helpers/runtime/web.mjs'
import { assertKnownPeerWarnings } from '../../../../scripts/shared/peer-policy.mjs'
import { ROOT, runPnpm } from '../../../../scripts/profile/profile-lib.mjs'
test('clean packed installation exposes published artifacts and usable workflows', { timeout: 900000 }, async t => {
  const directories = (await readdir(resolve(ROOT, 'packages'), { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
  if (!directories.length) throw new Error('No packages found; refusing an empty package verification')

  function exportedFiles(value) {
    if (typeof value === 'string') return [value]
    return Object.values(value ?? {}).flatMap(exportedFiles)
  }

  function runtimeEnv(home) {
    return {
      DSH_HOME: home,
      DSH_AGENTS_HOME: resolve(home, 'agents'),
      DSH_TELEMETRY_MODE: 'DISABLED',
      CHOKIDAR_USEPOLLING: '1',
    }
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), 'nook-package-verify-'))
  const home = resolve(temporaryRoot, 'dsh-home')
  const profile = resolve(home, 'profiles', 'nook')
  let succeeded = false

  try {
    await createPackedProfile(temporaryRoot)
    const peerCheck = await runPnpm(['peers', 'check'], {
      cwd: profile,
      capture: true,
      allowedExitCodes: [1],
    })
    // pnpm overrides can suppress the reviewed stale peer ranges; zero warnings is valid.
    if (peerCheck.code === 1) assertKnownPeerWarnings(`${peerCheck.stdout}${peerCheck.stderr}`)

    for (const directory of directories) {
      const sourceManifest = JSON.parse(await readFile(resolve(ROOT, 'packages', directory, 'package.json'), 'utf8'))
      const installedManifestPath = resolve(profile, 'node_modules', ...sourceManifest.name.split('/'), 'package.json')
      const installedManifest = JSON.parse(await readFile(installedManifestPath, 'utf8'))
      if (
        installedManifest.version !== sourceManifest.version ||
        JSON.stringify(installedManifest).includes('workspace:')
      ) {
        throw new Error(`packed dependency verification failed for ${sourceManifest.name}`)
      }
      const installed = await realpath(resolve(installedManifestPath, '..'))
      const location = relative(await realpath(temporaryRoot), installed)
      if (isAbsolute(location) || location === '..' || location.startsWith(`..${sep}`))
        throw new Error(`${sourceManifest.name} resolves outside the clean installation: ${installed}`)
      // The published manifest promises these entry points/assets. Do not copy a
      // package-specific file list or infer running services from Bundle row names.
      const files = new Set([
        ...exportedFiles(sourceManifest.exports),
        ...[sourceManifest.main, sourceManifest.types].filter(Boolean),
      ])
      // `files` is an inclusion filter: an absent source directory is optional.
      for (const file of sourceManifest.files ?? []) {
        const source = await stat(resolve(ROOT, 'packages', directory, file)).catch(error => {
          if (error.code !== 'ENOENT') throw error
          return undefined
        })
        if (source) files.add(file)
      }
      for (const file of files) {
        const path = resolve(installed, file)
        const entry = await stat(path)
        if (entry.isDirectory() ? !(await readdir(path)).length : !entry.size)
          throw new Error(`empty published artifact: ${sourceManifest.name}/${file}`)
      }
    }

    const bin = resolve(profile, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    const env = runtimeEnv(home)
    const web = await withWebRuntime({ bin, cwd: temporaryRoot, env }, async (url, runtime) => {
      const web = await verifyAuthentication(url)
      await runTaskAcceptance(t, { url })
      await runNotebookAcceptance(t, { url, profileDirectory: runtime.profileDirectory })
      return web
    })
    succeeded = true
    process.stdout.write(
      `Verified ${directories.length} independently installed Nook packages and authenticated workflows (HTTP ${web.status} from ${web.url}).\n`,
    )
  } finally {
    if (!succeeded || process.env.NOOK_KEEP_VERIFY_TEMP === '1') {
      process.stdout.write(`Package verification directory retained at ${temporaryRoot}.\n`)
    } else {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
    if (!succeeded) process.stderr.write('Nook clean-package verification failed.\n')
  }
})
