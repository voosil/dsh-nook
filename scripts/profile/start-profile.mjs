import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { DEV_HOME, ROOT, PNPM_VERSION, exists } from './profile-lib.mjs'
import { ProcessScope } from '../shared/process-scope.mjs'
import { stageDesktop } from '../desktop/stage-desktop.mjs'
import { prepareWindowsWebRuntime } from './prepare-web-runtime.mjs'
import { selectWebPort } from './web-port.mjs'

const { values } = parseArgs({
  args: process.argv.slice(2).filter(arg => arg !== '--'),
  options: {
    port: { type: 'string' },
    'no-open': { type: 'boolean', default: true },
    source: { type: 'boolean', default: false },
    'test-state': { type: 'string' },
  },
})
const port = Number(values.port ?? '3081')
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid Nook port')
const processes = new ProcessScope()
let runtime
let temporary
let stopped = false
let resolveStop
const ended = new Promise(resolve => {
  resolveStop = resolve
})
const stop = () => {
  stopped = true
  resolveStop()
  void processes.dispose()
  void runtime?.stop()
}
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
try {
  await processes.run('corepack', [`pnpm@${PNPM_VERSION}`, 'run', 'build'], {
    cwd: ROOT,
    env: { ...process.env, CI: 'true' },
  })
  const { SharedRuntime, sharedRuntimeRunning } = await import('../../apps/desktop/dist/shared-client.mjs')
  const { userState, testState } = await import('../../apps/desktop/dist/shared-paths.mjs')
  const { migrateData, migrationComplete } = await import('../../packages/storage-backup/lib/migration.js')
  const state = values['test-state'] ? testState(values['test-state']) : userState()
  const { readActiveUpdate } = await import('../../apps/desktop/dist/update.mjs')
  const active = values.source ? undefined : await readActiveUpdate(state)
  let update = active?.launch.options.update
  if (!update) {
    try {
      const git = async args => (await processes.run('git', ['-C', ROOT, ...args], { capture: true })).stdout.trim()
      const branch = process.env.NOOK_UPDATE_BRANCH || (await git(['branch', '--show-current']))
      const remote = process.env.NOOK_UPDATE_REMOTE || 'origin'
      await git(['remote', 'get-url', remote])
      if (branch) update = { repo: ROOT, branch, remote, current: await git(['rev-parse', 'HEAD']) }
    } catch {
      /* Unconfigured checkouts can still run normally. */
    }
  }
  if (update) {
    await mkdir(join(state, 'updates'), { recursive: true, mode: 0o700 })
    await writeFile(join(state, 'updates/source.json'), JSON.stringify(update), { mode: 0o600 })
  }
  const source = join(DEV_HOME, 'nook')
  const backups = join(state, 'backups')
  if (!values['test-state'] && (await exists(source)) && !migrationComplete(source, backups)) {
    if (await sharedRuntimeRunning(state))
      throw new Error('Close Nook desktop and other pnpm start terminals once before importing the old Web data.')
    const receipt = migrateData(source, join(state, 'harness/nook'), backups)
    if (receipt) console.log(`[nook start] Verified migration; original data retained at ${source}`)
  }
  if (!stopped) {
    runtime = new SharedRuntime(
      state,
      async () => {
        if (active) return active.launch
        const selectedPort = await selectWebPort(port, { explicit: values.port !== undefined })
        if (process.platform === 'win32') {
          const launch = await prepareWindowsWebRuntime(state, {
            runPnpm: (args, options = {}) =>
              processes.run('corepack', [`pnpm@${PNPM_VERSION}`, ...args], {
                ...options,
                cwd: options.cwd ?? ROOT,
                env: { ...process.env, CI: 'true', ...options.env },
              }),
          })
          launch.options.port = selectedPort
          if (update) launch.options.update = update
          return launch
        }
        await mkdir(join(ROOT, '.pack'), { recursive: true })
        temporary = await mkdtemp(join(ROOT, '.pack/web-start-'))
        const seed = await stageDesktop({ destination: join(temporary, 'runtime') })
        return {
          node: join(seed, 'payload/node/bin/node'),
          broker: join(seed, 'payload/boot/shared-broker.mjs'),
          options: { state, seed, port: selectedPort, ...(update ? { update } : {}) },
        }
      },
      line => {
        if (!line.startsWith('dsh web: ')) console.log(line)
      },
      error => {
        if (!stopped) {
          console.error(error.message)
          process.exitCode = 1
          stop()
        }
      },
      url => console.log(`dsh web: ${url}`),
    )
    const url = await runtime.ready
    // This interactive terminal URL is the authentication handoff, not a disk log.
    console.log(`dsh web: ${url}`)
    console.log(
      `[nook start] Shared data: ${join(state, 'harness/nook')}. Close all Web/desktop launchers to apply a new build.`,
    )
    await ended
  }
} catch (error) {
  if (!stopped) throw error
} finally {
  await runtime?.stop()
  await processes.dispose()
  if (temporary) await rm(temporary, { recursive: true, force: true })
  process.off('SIGINT', stop)
  process.off('SIGTERM', stop)
}
