import { mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProcessScope } from '../shared/process-scope.mjs'
import { assertIndependentCandidate, removeUpdateWorktree } from './update-worktree.mjs'

// Invoked only by the local broker with its configured repository and a resolved commit.
export async function prepareUpdate({ repo, commit, directory, state }, processes = new ProcessScope()) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid update commit')
  let stopped = false,
    created = false,
    removalAttempted = false,
    retainSource = false
  let failure
  const checkout = join(directory, 'source')
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
    // The broker assigns a unique version directory; never reuse an existing checkout.
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await execute('git', ['-C', repo, 'worktree', 'add', '--detach', checkout, commit])
    created = true
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
    const candidate = JSON.parse(await readFile(join(directory, 'candidate.json'), 'utf8'))
    try {
      await assertIndependentCandidate(directory, candidate, commit)
    } catch (error) {
      retainSource = true
      throw error
    }
    // Git may remove checkout metadata before failing. Never retry a partially
    // removed worktree: retain the original error and any remaining evidence.
    removalAttempted = true
    await removeUpdateWorktree(repo, checkout, commit)
    // This smoke cannot accidentally read code or dependencies from the build checkout.
    await execute(
      process.execPath,
      [join(import.meta.dirname, 'verify-update.mjs'), join(directory, 'candidate.json')],
      {
        cwd: directory,
        env: {
          ...env,
          DSH_HOME: join(directory, 'runtime/dsh-home'),
          DSH_AGENTS_HOME: join(directory, 'runtime/dsh-home/agents'),
        },
      },
    )
  } catch (error) {
    failure = error
    throw error
  } finally {
    try {
      await processes.dispose()
      if (created && !removalAttempted && !retainSource) await removeUpdateWorktree(repo, checkout, commit)
    } catch (error) {
      if (failure)
        throw new AggregateError(
          [failure, error],
          `Update preparation failed: ${failure.message}; cleanup failed: ${error.message}`,
          { cause: failure },
        )
      throw error
    } finally {
      process.off('SIGTERM', stop)
      process.off('SIGINT', stop)
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareUpdate(JSON.parse(process.argv[2]))
}
