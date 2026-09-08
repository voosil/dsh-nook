import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPackedProfile } from './pack-profile.mjs'
import { ROOT, runPnpm } from './profile-lib.mjs'
import { copyDesktopNode, desktopNode, NODE_VERSION } from './desktop-node.mjs'
import { assertKnownPeerWarnings } from './peer-policy.mjs'

export const DESKTOP_SEED = resolve(ROOT, 'apps/desktop/resources/runtime')

export async function stageDesktop() {
  const { inventory } = await import('../apps/desktop/dist/payload.mjs')
  const node = await desktopNode()
  const stagingParent = resolve(ROOT, '.pack')
  await mkdir(stagingParent, { recursive: true })
  const temporary = await mkdtemp(join(stagingParent, 'desktop-stage-'))
  try {
    const packed = await createPackedProfile(temporary, {
      portable: true,
      runPnpm: (args, options = {}) =>
        runPnpm(args, { ...options, env: { ...options.env, PATH: `${join(node, 'bin')}:${process.env.PATH ?? ''}` } }),
    })
    const peers = await runPnpm(['peers', 'check'], { cwd: packed.profile, capture: true, allowedExitCodes: [1] })
    if (peers.code === 1) assertKnownPeerWarnings(peers.stdout + peers.stderr)
    const seed = join(temporary, 'seed')
    const payload = join(seed, 'payload')
    await mkdir(join(payload, 'boot'), { recursive: true })
    await rename(packed.home, join(payload, 'home'))
    // electron-builder omits empty resource directories. Agents live in the
    // writable DSH home and are created by the launcher, not the runtime seed.
    await rm(join(payload, 'home', 'agents'), { recursive: true })
    await copyDesktopNode(join(payload, 'node'))
    await cp(resolve(ROOT, 'apps/desktop/dist/supervisor.mjs'), join(payload, 'boot/supervisor.mjs'))
    const appManifest = JSON.parse(await readFile(resolve(ROOT, 'apps/desktop/package.json'), 'utf8'))
    const manifest = {
      schemaVersion: 1,
      platform: process.platform,
      arch: process.arch,
      nodeVersion: NODE_VERSION,
      electronVersion: appManifest.devDependencies.electron,
      entries: await inventory(payload),
    }
    await writeFile(join(seed, 'manifest.json'), JSON.stringify(manifest) + '\n')
    await mkdir(resolve(DESKTOP_SEED, '..'), { recursive: true })
    // This directory is exclusively a generated build artifact, never app data.
    await rm(DESKTOP_SEED, { recursive: true, force: true })
    await rename(seed, DESKTOP_SEED)
    console.log(`Staged desktop runtime (${manifest.entries.length} verified entries).`)
    return DESKTOP_SEED
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await stageDesktop()
