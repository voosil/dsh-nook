import { createServer } from 'node:net'
import { once } from 'node:events'
import { resolve } from 'node:path'
import { dshBin, PROFILE_DIR, ROOT, PNPM_VERSION, writeDevProfile } from './profile-lib.mjs'
import { createProfileArgs, resolveDevPort } from './run-profile-args.mjs'
import { selectWebPort } from './web-port.mjs'
import { ProcessScope } from '../shared/process-scope.mjs'
import { createDevSandbox } from './dev-sandbox.mjs'
import { sourceSnapshot, watchSources } from './dev-watch.mjs'
import { seedDevData } from './dev-seed.mjs'

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
  const clean = process.argv.includes('--clean')
  const seedOnly = process.argv.includes('--seed')
  if (clean && seedOnly) throw new Error('--clean and --seed cannot be combined')
  const inputArgs = process.argv.slice(2).filter(arg => arg !== '--clean' && arg !== '--seed')
  const port = resolveDevPort(inputArgs)
  const defaultPort =
    seedOnly || port === undefined
      ? undefined
      : await selectWebPort(port, {
          explicit: inputArgs.some(arg => arg === '--port' || arg.startsWith('--port=')),
          label: 'nook dev',
        })
  const initial = await sourceSnapshot(ROOT)
  const build = () =>
    processes.run('corepack', [`pnpm@${PNPM_VERSION}`, 'run', 'build'], {
      cwd: ROOT,
      env: { ...process.env, CI: 'true' },
    })
  await build()
  if (controller.signal.aborted) process.exitCode = 130
  else {
    // Existing Profiles can be missing links after a pull adds packages.
    await writeDevProfile()
    await processes.run('corepack', [`pnpm@${PNPM_VERSION}`, 'install', '--dir', PROFILE_DIR, '--no-frozen-lockfile'], {
      cwd: ROOT,
      env: { ...process.env, CI: 'true' },
    })
    if (controller.signal.aborted) throw new Error('startup cancelled')
    sandbox = await createDevSandbox({ persistent: !clean })
    if (!clean) await seedDevData(sandbox.home, { force: seedOnly })
    if (seedOnly) {
      console.log(`[nook dev] Example data ready: ${sandbox.home}`)
    } else {
      const args = createProfileArgs(dshBin(), ROOT, inputArgs, {
        defaultPort,
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
        runtime = processes.spawn(process.execPath, args, {
          cwd: ROOT,
          env: { ...process.env, ...sandbox.env, NOOK_DEV_RUNTIME: '1' },
        })
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
      console.log(
        `[nook dev] Watching source files. ${clean ? 'Temporary' : 'Persistent development'} data: ${sandbox.home}`,
      )
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
