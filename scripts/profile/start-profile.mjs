import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { DEV_HOME, ROOT, PNPM_VERSION, exists } from './profile-lib.mjs'
import { ProcessScope } from '../shared/process-scope.mjs'
import { stageDesktop } from '../desktop/stage-desktop.mjs'
import { prepareWindowsWebRuntime } from './prepare-web-runtime.mjs'
import { requireStartPort } from './web-port.mjs'

const { values } = parseArgs({
  args: process.argv.slice(2).filter(arg => arg !== '--'),
  options: {
    port: { type: 'string' },
    'no-open': { type: 'boolean', default: true },
    'test-state': { type: 'string' },
  },
})
const port = Number(values.port ?? '3081')
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid Nook port')
const processes = new ProcessScope()
const controller = new AbortController()
let runtime
let temporary
let stopped = false
let resolveStop
const ended = new Promise(resolve => {
  resolveStop = resolve
})
const stop = () => {
  stopped = true
  controller.abort()
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
  const { SharedRuntime } = await import('../../apps/desktop/dist/shared-client.mjs')
  const { stopSharedRuntime } = await import('./restart-shared.mjs')
  const { userState, testState } = await import('../../apps/desktop/dist/shared-paths.mjs')
  const { migrateData, migrationComplete } = await import('../../packages/storage-backup/lib/migration.js')
  const state = values['test-state'] ? testState(values['test-state']) : userState()
  let update
  try {
    const git = async args => (await processes.run('git', ['-C', ROOT, ...args], { capture: true })).stdout.trim()
    const branch = process.env.NOOK_UPDATE_BRANCH || (await git(['branch', '--show-current']))
    const remote = process.env.NOOK_UPDATE_REMOTE || 'origin'
    await git(['remote', 'get-url', remote])
    if (branch) update = { repo: ROOT, branch, remote, current: await git(['rev-parse', 'HEAD']) }
  } catch {
    /* Unconfigured checkouts can still run normally. */
  }
  controller.signal.throwIfAborted()
  console.log('[nook start] Preparing current workspace snapshot; the existing backend stays available.')
  let launch
  if (process.platform === 'win32') {
    launch = await prepareWindowsWebRuntime(state, {
      runPnpm: (args, options = {}) =>
        processes.run('corepack', [`pnpm@${PNPM_VERSION}`, ...args], {
          ...options,
          cwd: options.cwd ?? ROOT,
          env: { ...process.env, CI: 'true', ...options.env },
        }),
    })
    launch.options.port = port
    if (update) launch.options.update = update
  } else {
    await mkdir(join(ROOT, '.pack'), { recursive: true })
    temporary = await mkdtemp(join(ROOT, '.pack/web-start-'))
    const seed = await stageDesktop({ destination: join(temporary, 'runtime') })
    const { preparePayload } = await import('../../apps/desktop/dist/payload.mjs')
    const snapshot = await preparePayload(seed, state, controller.signal)
    launch = {
      node: snapshot.node,
      broker: join(snapshot.supervisor, '..', 'shared-broker.mjs'),
      options: { state, snapshot, port, ...(update ? { update } : {}) },
    }
  }
  controller.signal.throwIfAborted()
  await stopSharedRuntime(state, { signal: controller.signal })
  // Unlike dev, formal startup never silently moves to a different port.
  await requireStartPort(port)
  controller.signal.throwIfAborted()
  if (update) {
    await mkdir(join(state, 'updates'), { recursive: true, mode: 0o700 })
    await writeFile(join(state, 'updates/source.json'), JSON.stringify(update), { mode: 0o600 })
  }
  const source = join(DEV_HOME, 'nook')
  const backups = join(state, 'backups')
  if (!values['test-state'] && (await exists(source)) && !migrationComplete(source, backups)) {
    const receipt = migrateData(source, join(state, 'harness/nook'), backups)
    if (receipt) console.log(`[nook start] Verified migration; original data retained at ${source}`)
  }
  if (!stopped) {
    runtime = new SharedRuntime(
      state,
      async () => launch,
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
      false,
    )
    const url = await runtime.ready
    // This interactive terminal URL is the authentication handoff, not a disk log.
    console.log(`dsh web: ${url}`)
    console.log(
      `[nook start] Running current workspace. Shared data: ${join(state, 'harness/nook')}. Run pnpm start again to rebuild and restart.`,
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
