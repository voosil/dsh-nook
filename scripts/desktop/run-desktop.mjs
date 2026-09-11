import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { createDevSandbox } from '../profile/dev-sandbox.mjs'
import { desktopNode } from './desktop-node.mjs'
import { ROOT, dshBin, runPnpm } from '../profile/profile-lib.mjs'
import { ProcessScope } from '../shared/process-scope.mjs'
import { seedDevData } from '../profile/dev-seed.mjs'

await runPnpm(['run', 'build'])
await runPnpm(['run', 'dev:profile'])
const node = join(await desktopNode(), 'bin', 'node')
const clean = process.argv.includes('--clean')
const sandbox = await createDevSandbox({ persistent: !clean, desktop: true })
const scope = new ProcessScope()
const stop = () => {
  void scope.dispose()
}
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
try {
  if (!clean) await seedDevData(sandbox.home)
  const cwd = join(sandbox.home, 'workspace')
  await mkdir(cwd, { recursive: true })
  const config = join(sandbox.home, 'desktop.json')
  await writeFile(
    config,
    JSON.stringify({
      home: sandbox.home,
      bin: dshBin(),
      node,
      supervisor: resolve(ROOT, 'apps/desktop/dist/supervisor.mjs'),
      cwd,
      profile: 'nook',
    }),
  )
  const require = createRequire(resolve(ROOT, 'apps/desktop/package.json'))
  const env = { ...process.env, NOOK_DESKTOP_DEV_CONFIG: config, NOOK_DEV_RUNTIME: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  await scope.run(require('electron'), [resolve(ROOT, 'apps/desktop')], { cwd: dirname(config), env })
} finally {
  await scope.dispose()
  await sandbox.dispose()
  process.off('SIGINT', stop)
  process.off('SIGTERM', stop)
}
