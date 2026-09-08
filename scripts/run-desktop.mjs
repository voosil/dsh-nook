import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { createDevSandbox } from './dev-sandbox.mjs'
import { desktopNode } from './desktop-node.mjs'
import { ROOT, dshBin, runPnpm } from './profile-lib.mjs'
import { ProcessScope } from './process-scope.mjs'

await runPnpm(['run', 'build'])
await runPnpm(['run', 'dev:profile'])
const node = join(await desktopNode(), 'bin', 'node')
const sandbox = await createDevSandbox()
const scope = new ProcessScope()
const stop = () => {
  void scope.dispose()
}
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
try {
  const cwd = join(sandbox.home, 'workspace')
  await mkdir(cwd)
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
  const env = { ...process.env, NOOK_DESKTOP_DEV_CONFIG: config }
  delete env.ELECTRON_RUN_AS_NODE
  await scope.run(require('electron'), [resolve(ROOT, 'apps/desktop')], { cwd: dirname(config), env })
} finally {
  await scope.dispose()
  await sandbox.dispose()
  process.off('SIGINT', stop)
  process.off('SIGTERM', stop)
}
