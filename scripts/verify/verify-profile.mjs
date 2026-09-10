import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  PROFILE_DIR,
  devRuntimeEnv,
  dshBin,
  exists,
  installProfile,
  run,
  writeDevProfile,
} from '../profile/profile-lib.mjs'

await writeDevProfile()
if (!(await exists(resolve(PROFILE_DIR, 'node_modules')))) await installProfile()

for (const artifact of [
  'packages/app-all/lib/index.js',
  'packages/ui-project/lib/client.js',
  'packages/ui-sidebar/lib/client.js',
  'packages/ui-notes/lib/client.js',
  'packages/ui-knowledge/lib/client.js',
]) {
  if (!(await exists(resolve(artifact)))) throw new Error(`missing build artifact: ${artifact}; run pnpm build`)
}

const { stdout } = await run(process.execPath, [dshBin(), '--profile', 'nook', '--dump-config'], {
  env: devRuntimeEnv(),
  capture: true,
})

const requiredRows = [
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
for (const row of requiredRows) {
  if (!stdout.includes(`id: ${row}`)) throw new Error(`final composition is missing row ${row}`)
}

const safeUi = await readFile(resolve('dev/patches/safe-ui.cordis.yml'), 'utf8')
for (const row of ['nook-ui-project', 'nook-ui-sidebar', 'nook-ui-notes', 'nook-ui-knowledge']) {
  if (!safeUi.includes(`id: ${row}`) || !safeUi.includes('disabled: true')) {
    throw new Error(`safe UI patch does not disable ${row}`)
  }
}

const safePatch = resolve('dev/patches/safe-ui.cordis.yml')
const { stdout: safeComposition } = await run(
  process.execPath,
  [dshBin(), '--profile', 'nook', '--dump-config', '--patch', safePatch],
  {
    env: devRuntimeEnv(),
    capture: true,
  },
)
for (const row of ['nook-ui-project', 'nook-ui-sidebar', 'nook-ui-notes', 'nook-ui-knowledge']) {
  const start = safeComposition.indexOf(`- id: ${row}\n`)
  if (start === -1) throw new Error(`safe UI composition is missing row ${row}`)
  const next = safeComposition.indexOf('\n- id: ', start + 1)
  const block = safeComposition.slice(start, next === -1 ? undefined : next)
  if (!block.includes('\n  disabled: true')) throw new Error(`safe UI composition leaves ${row} enabled`)
}

process.stdout.write(`Verified Nook profile composition (${requiredRows.length} required rows) and Safe UI mode.\n`)
