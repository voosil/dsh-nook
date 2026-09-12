import { verifyAuthentication } from '../../../helpers/scenarios/authentication.mjs'
import { runTaskAcceptance } from '../../../helpers/scenarios/tasks.mjs'
import { runNotebookAcceptance } from '../../../helpers/scenarios/notebook.mjs'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { copyFile, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { test } from 'node:test'
import { ProcessScope } from '../../../../scripts/shared/process-scope.mjs'
import { retainCandidateNode } from '../../../../scripts/update/update-worktree.mjs'
import { verifyUpdate } from '../../../../scripts/update/verify-update.mjs'
import { prepareUpdate } from '../../../../scripts/update/prepare-update.mjs'
import { withWebRuntime } from '../../../helpers/runtime/web.mjs'

const exec = promisify(execFile)
test('packed update boots and serves real workflows after its worktree is removed', { timeout: 900_000 }, async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'nook-update-package-')))
  let succeeded = false
  const oldTrace = process.env.GIT_TRACE2_EVENT
  process.env.GIT_TRACE2_EVENT = join(root, 'git-trace.jsonl')
  t.after(async () => {
    if (oldTrace === undefined) delete process.env.GIT_TRACE2_EVENT
    else process.env.GIT_TRACE2_EVENT = oldTrace
    if (succeeded && process.env.NOOK_KEEP_VERIFY_TEMP !== '1') await rm(root, { recursive: true, force: true })
    else console.error(`Update acceptance directory retained: ${root}`)
  })
  const repo = join(root, 'source repo'),
    directory = join(root, 'update runtime')
  await exec('git', ['clone', '--quiet', '--no-hardlinks', resolve('.'), repo])
  // Include the cleanup implementation under test without committing the user's working tree.
  const files = ['prepare-update.mjs', 'pack-update.mjs', 'verify-update.mjs', 'update-worktree.mjs']
  for (const name of files) await copyFile(resolve('scripts/update', name), join(repo, 'scripts/update', name))
  const git = async (...args: string[]) => (await exec('git', ['-C', repo, ...args])).stdout.trim()
  // The disposable Windows checkout contains pnpm's deeply nested package paths.
  // Configure only this fixture repository, never the user's global Git settings.
  if (process.platform === 'win32') await git('config', 'core.longpaths', 'true')
  await git('add', '--', ...files.map(name => 'scripts/update/' + name))
  await git(
    '-c',
    'user.name=Nook Test',
    '-c',
    'user.email=test@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--allow-empty',
    '-m',
    'isolated update acceptance',
  )
  const commit = await git('rev-parse', 'HEAD')
  const launcher = join(root, 'web-start')
  const temporaryNode = await retainCandidateNode(launcher)
  class LauncherProcesses extends ProcessScope {
    run(command: string, args: string[], options = {}) {
      return super.run(command === process.execPath ? temporaryNode : command, args, options)
    }
  }
  await prepareUpdate({ repo, commit, directory, state: join(root, 'unused-formal-state') }, new LauncherProcesses())
  await rm(launcher, { recursive: true })
  await assert.rejects(readFile(join(directory, 'source/package.json')), { code: 'ENOENT' })
  assert.equal((await git('worktree', 'list', '--porcelain')).split('worktree ').length - 1, 1)
  const candidate = JSON.parse(await readFile(join(directory, 'candidate.json'), 'utf8'))
  assert.ok(candidate.snapshot.node.startsWith(join(directory, 'runtime') + sep))
  await verifyUpdate(candidate)
  const { activateProfile } = await import('../../../../apps/desktop/dist/payload.mjs')
  const config = await activateProfile({ state: join(root, 'browser-acceptance'), ...candidate.snapshot })
  const result = await withWebRuntime(
    {
      bin: config.bin,
      node: config.node,
      cwd: config.cwd,
      env: {
        DSH_HOME: config.home,
        DSH_AGENTS_HOME: join(config.home, 'agents'),
        DSH_TELEMETRY_MODE: 'DISABLED',
        CHOKIDAR_USEPOLLING: '1',
      },
    },
    async (url, runtime) => {
      const result = await verifyAuthentication(url)
      await runTaskAcceptance(t, { url })
      await runNotebookAcceptance(t, { url, profileDirectory: runtime.profileDirectory, node: config.node })
      return result
    },
  )
  assert.equal(result.status, 200)
  succeeded = true
})
