import { createServer } from 'node:net'
import { once } from 'node:events'
import { resolve } from 'node:path'
import { dshBin, exists, PROFILE_DIR, ROOT, PNPM_VERSION, writeDevProfile } from './profile-lib.mjs'
import { createProfileArgs } from './run-profile-args.mjs'
import { ProcessScope } from '../shared/process-scope.mjs'
import { createDevSandbox } from './dev-sandbox.mjs'
import { sourceSnapshot, watchSources } from './dev-watch.mjs'

const processes = new ProcessScope()
const controller = new AbortController()
const abort = () => {
  controller.abort()
  void processes.dispose()
}
process.once('SIGINT', abort)
process.once('SIGTERM', abort)
let sandbox
let runtime
let restarting = false

try {
  const initial = await sourceSnapshot(ROOT)
  const build = () =>
    processes.run('corepack', [`pnpm@${PNPM_VERSION}`, 'run', 'build'], {
      cwd: ROOT,
      env: { ...process.env, CI: 'true' },
    })
  await build()
  if (controller.signal.aborted) process.exitCode = 130
  else {
    if (!(await exists(resolve(PROFILE_DIR, 'package.json')))) await writeDevProfile()
    if (!(await exists(resolve(PROFILE_DIR, 'node_modules')))) {
      await processes.run(
        'corepack',
        [`pnpm@${PNPM_VERSION}`, 'install', '--dir', PROFILE_DIR, '--no-frozen-lockfile'],
        { cwd: ROOT, env: { ...process.env, CI: 'true' } },
      )
    }
    if (controller.signal.aborted) throw new Error('startup cancelled')
    sandbox = await createDevSandbox()
    const args = createProfileArgs(dshBin(), ROOT, process.argv.slice(2), {
      patches: [resolve(ROOT, 'dev/patches/hmr.cordis.yml')],
    })
    // Keep the selected ephemeral port stable across Host restarts.
    const zero = args.findIndex((arg, index) => arg === '--port=0' || (arg === '0' && args[index - 1] === '--port'))
    if (zero !== -1) {
      const server = createServer()
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      const port = server.address().port
      await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
      args[zero] = args[zero] === '--port=0' ? `--port=${port}` : String(port)
    }
    const launch = () => {
      runtime = processes.spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, ...sandbox.env } })
      runtime.once('error', error => {
        console.error(error.message)
        process.exitCode = 1
        controller.abort()
      })
      runtime.once('exit', (code, signal) => {
        if (!restarting && !controller.signal.aborted) {
          process.exitCode = code ?? (signal ? 1 : 0)
          controller.abort()
        }
      })
    }
    launch()
    console.log(`[nook dev] Watching source files. Temporary data: ${sandbox.home}`)
    await watchSources({
      root: ROOT,
      initial,
      signal: controller.signal,
      build,
      restart: async () => {
        restarting = true
        try {
          await processes.stop(runtime)
          if (!controller.signal.aborted) launch()
        } finally {
          restarting = false
        }
      },
    })
  }
} catch (error) {
  if (!controller.signal.aborted) throw error
} finally {
  controller.abort()
  await processes.dispose()
  await sandbox?.dispose()
  process.removeListener('SIGINT', abort)
  process.removeListener('SIGTERM', abort)
}
