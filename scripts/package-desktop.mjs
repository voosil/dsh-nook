import { ROOT, runPnpm } from './profile-lib.mjs'
import { resolve } from 'node:path'
import { stageDesktop } from './stage-desktop.mjs'
import { readFile } from 'node:fs/promises'

await runPnpm(['run', 'build'])
await stageDesktop()
await runPnpm(['exec', 'electron-builder', '--dir', '--config', 'electron-builder.yml', '--publish', 'never'], {
  cwd: resolve(ROOT, 'apps/desktop'),
})
const { verifyPayload } = await import('../apps/desktop/dist/payload.mjs')
const runtime = resolve(ROOT, '.pack/desktop/mac-arm64/Nook.app/Contents/Resources/runtime')
await verifyPayload(resolve(runtime, 'payload'), JSON.parse(await readFile(resolve(runtime, 'manifest.json'), 'utf8')))
console.log('Packaged runtime integrity verified.')
