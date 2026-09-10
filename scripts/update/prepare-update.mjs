import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ProcessScope } from '../shared/process-scope.mjs'

// Invoked only by the local broker with its configured repository and a resolved commit.
const { repo, commit, directory, state } = JSON.parse(process.argv[2])
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid update commit')
const processes = new ProcessScope()
let stopped = false
const stop = () => {
  stopped = true
  void processes.dispose()
}
const execute = (command, args, options) => {
  if (stopped) throw new Error('Update preparation stopped')
  return processes.run(command, args, options)
}
process.once('SIGTERM', stop)
process.once('SIGINT', stop)
try {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const checkout = join(directory, 'source')
  await execute('git', ['-C', repo, 'worktree', 'add', '--detach', checkout, commit])
  const manifest = JSON.parse(await readFile(join(checkout, 'package.json'), 'utf8'))
  if (!/^pnpm@\d+\.\d+\.\d+$/.test(manifest.packageManager)) throw new Error('Unsupported package manager')
  const env = {
    ...process.env,
    CI: 'true',
    DSH_HOME: join(checkout, '.dsh-dev'),
    DSH_AGENTS_HOME: join(checkout, '.dsh-dev/agents'),
  }
  delete env.NOOK_UPDATE_TOKEN
  delete env.NOOK_UPDATE_SOCKET
  const run = args => execute('corepack', [manifest.packageManager, ...args], { cwd: checkout, env })
  await run(['install', '--frozen-lockfile'])
  await run(['run', 'build'])
  await execute(
    process.execPath,
    [join(checkout, 'scripts/update/pack-update.mjs'), JSON.stringify({ directory, state, commit })],
    { cwd: checkout, env },
  )
} finally {
  await processes.dispose()
  process.off('SIGTERM', stop)
  process.off('SIGINT', stop)
}
