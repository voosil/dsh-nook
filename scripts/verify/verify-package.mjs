import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createPackedProfile } from '../profile/pack-profile.mjs'
import { bootAndVerifyWeb } from './runtime-verify.mjs'
import { assertKnownPeerWarnings } from '../shared/peer-policy.mjs'
import { LOCAL_PACKAGES, ROOT, run, runPnpm } from '../profile/profile-lib.mjs'

function runtimeEnv(home) {
  return {
    DSH_HOME: home,
    DSH_AGENTS_HOME: resolve(home, 'agents'),
    DSH_TELEMETRY_MODE: 'DISABLED',
    CHOKIDAR_USEPOLLING: '1',
  }
}

function assertComposition(composition) {
  const rows = [
    'community-browser-runtime',
    'community-browser-playwright',
    'nook-browser-adapter',
    'nook-dsh-compat',
    'nook-sync-storage',
    'nook-sync-feature',
    'nook-sync-rpc',
    'nook-update-provider',
    'nook-update-rpc',
    'nook-artifact-provider',
    'nook-project-feature',
    'nook-preview-feature',
    'nook-dsh-adapter',
    'nook-agent-feature',
    'nook-ui-project',
    'nook-ui-sidebar',
    'nook-notebook-provider',
    'nook-notes-feature',
    'nook-notes-rpc',
    'nook-ui-notes',
    'nook-intelligence-adapter',
    'nook-reflection-feature',
    'nook-video-source',
    'nook-video-editor',
    'nook-video-feature',
    'nook-knowledge-adapter',
    'nook-ui-knowledge',
  ]
  for (const row of rows) {
    if (!composition.includes(`id: ${row}`)) throw new Error(`packed Profile is missing row ${row}`)
  }
  return rows.length
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

  for (const directory of LOCAL_PACKAGES) {
    const sourceManifest = JSON.parse(await readFile(resolve(ROOT, 'packages', directory, 'package.json'), 'utf8'))
    const installedManifestPath = resolve(profile, 'node_modules', ...sourceManifest.name.split('/'), 'package.json')
    const installedManifest = JSON.parse(await readFile(installedManifestPath, 'utf8'))
    if (
      installedManifest.version !== sourceManifest.version ||
      JSON.stringify(installedManifest).includes('workspace:')
    ) {
      throw new Error(`packed dependency verification failed for ${sourceManifest.name}`)
    }
  }
  for (const asset of [
    'feature-agent/lib/sync-deployment.json',
    'feature-agent/skills/nook-sync-deploy/SKILL.md',
    'adapter-video-platform/python/collect.py',
    'adapter-video-platform/python/nook_video/bilibili.py',
    'provider-video-editor/skills/video-to-essay/SKILL.md',
    'provider-video-editor/skills/video-to-essay/references/editorial-guide.md',
    'provider-video-editor/skills/learning-notes/SKILL.md',
  ]) {
    if (!(await readFile(resolve(profile, 'node_modules', '@nook-dsh', asset), 'utf8')).trim())
      throw new Error(`empty packed asset: ${asset}`)
  }
  const installedApp = await realpath(resolve(profile, 'node_modules', '@nook-dsh', 'app-all'))
  if (installedApp.startsWith(`${ROOT}/`))
    throw new Error('clean Profile unexpectedly resolved app-all to a workspace link')

  const bin = resolve(profile, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const env = runtimeEnv(home)
  const { stdout: composition } = await run(process.execPath, [bin, '--profile', 'nook', '--dump-config'], {
    cwd: temporaryRoot,
    env,
    capture: true,
  })
  const rowCount = assertComposition(composition)
  const web = await bootAndVerifyWeb({ bin, cwd: temporaryRoot, env })
  succeeded = true
  process.stdout.write(
    `Verified ${LOCAL_PACKAGES.length} packed Nook packages, ${rowCount} Profile rows, and HTTP ${web.status} from ${web.url}.\n`,
  )
} finally {
  if (process.env.NOOK_KEEP_VERIFY_TEMP === '1') {
    process.stdout.write(`Package verification directory retained at ${temporaryRoot}.\n`)
  } else {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
  if (!succeeded) process.stderr.write('Nook clean-package verification failed.\n')
}
