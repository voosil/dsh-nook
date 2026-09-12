import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { prepareUpdate } from '../../../scripts/update/prepare-update.mjs'
import {
  assertIndependentCandidate,
  removeUpdateWorktree,
  retainCandidateNode,
} from '../../../scripts/update/update-worktree.mjs'

const exec = promisify(execFile)
async function fixture(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'nook-update-worktree-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const repo = join(root, 'repo'),
    directory = join(root, 'runtime'),
    checkout = join(directory, 'source')
  await mkdir(repo)
  const git = async (...args: string[]) => (await exec('git', ['-C', repo, ...args])).stdout.trim()
  await git('init', '-b', 'main')
  await git('config', 'user.name', 'Nook Test')
  await git('config', 'user.email', 'test@example.invalid')
  await writeFile(join(repo, 'package.json'), JSON.stringify({ packageManager: 'pnpm@12.1.0' }))
  await writeFile(join(repo, '.gitignore'), 'node_modules/\nlib/\n.dsh-dev/\n')
  await git('add', 'package.json', '.gitignore')
  await git('commit', '-m', 'fixture')
  const commit = await git('rev-parse', 'HEAD')
  return { root, repo, directory, checkout, git, commit }
}

for (const failure of ['', 'install', 'build', 'pack', 'verify', 'cancel', 'remove']) {
  test(`update removes only its owned worktree after ${failure || 'success'}`, async t => {
    const f = await fixture(t)
    const preserved = join(f.root, 'user-data')
    await writeFile(preserved, 'preserve data and rollback copies')
    let disposed = false,
      verified = false
    const signals = process.listenerCount('SIGTERM')
    const trace = join(f.root, 'git-trace.jsonl')
    const oldTrace = process.env.GIT_TRACE2_EVENT
    process.env.GIT_TRACE2_EVENT = trace
    t.after(() => {
      if (oldTrace === undefined) delete process.env.GIT_TRACE2_EVENT
      else process.env.GIT_TRACE2_EVENT = oldTrace
    })
    const runner = {
      async dispose() {
        disposed = true
      },
      async run(command: string, args: string[]) {
        if (command === 'git') return exec(command, args)
        if (command === 'corepack') {
          const phase = args.includes('install') ? 'install' : 'build'
          await mkdir(join(f.checkout, 'node_modules'), { recursive: true })
          await writeFile(join(f.checkout, 'node_modules/generated'), 'disposable output')
          if (failure === 'cancel') process.emit('SIGTERM')
          if (failure === phase) throw new Error(phase)
          return
        }
        if (args[0]!.endsWith('pack-update.mjs')) {
          if (failure === 'pack') throw new Error('pack')
          const runtime = join(f.directory, 'runtime'),
            boot = join(f.directory, 'boot')
          await mkdir(runtime)
          await mkdir(boot)
          await writeFile(join(runtime, 'package.json'), '{}')
          await writeFile(join(runtime, 'node'), 'retained node')
          await writeFile(join(boot, 'supervisor.mjs'), 'retained supervisor')
          await writeFile(join(boot, 'shared-broker.mjs'), 'retained broker')
          await writeFile(
            join(f.directory, 'candidate.json'),
            JSON.stringify({
              protocol: 1,
              commit: f.commit,
              broker: join(boot, 'shared-broker.mjs'),
              snapshot: { seedProfile: runtime, node: join(runtime, 'node'), supervisor: join(boot, 'supervisor.mjs') },
            }),
          )
          if (failure === 'remove') await f.git('worktree', 'lock', f.checkout)
          return
        }
        assert.ok(args[0]!.endsWith('verify-update.mjs'))
        await assert.rejects(readFile(join(f.checkout, 'package.json')), { code: 'ENOENT' })
        assert.equal((await f.git('worktree', 'list', '--porcelain')).split('worktree ').length - 1, 1)
        assert.equal(await readFile(join(f.directory, 'boot/supervisor.mjs'), 'utf8'), 'retained supervisor')
        verified = true
        if (failure === 'verify') throw new Error('verify')
      },
    }
    const action = prepareUpdate({ ...f, state: f.root }, runner)
    if (failure)
      await assert.rejects(
        action,
        failure === 'cancel' ? /stopped/ : failure === 'remove' ? /locked/ : new RegExp(failure),
      )
    else await action
    assert.equal(disposed, true)
    assert.equal(verified, failure === '' || failure === 'verify')
    assert.equal(await readFile(preserved, 'utf8'), 'preserve data and rollback copies')
    if (failure === 'remove') {
      assert.equal(await readFile(join(f.directory, 'boot/supervisor.mjs'), 'utf8'), 'retained supervisor')
      assert.ok(await readFile(join(f.checkout, 'package.json'), 'utf8'))
      const attempts = (await readFile(trace, 'utf8'))
        .trim()
        .split('\n')
        .map(line => JSON.parse(line))
        .filter(event => event.event === 'start' && event.argv.includes('worktree') && event.argv.includes('remove'))
      assert.equal(attempts.length, 1, 'failed removal is not retried by finally')
      assert.equal(process.listenerCount('SIGTERM'), signals)
      return
    }
    await assert.rejects(readFile(join(f.checkout, 'package.json')), { code: 'ENOENT' })
    assert.equal((await f.git('worktree', 'list', '--porcelain')).split('worktree ').length - 1, 1)
    assert.equal(process.listenerCount('SIGTERM'), signals)
  })
}

test('preparation and cleanup failures retain both causes and the modified source', async t => {
  const f = await fixture(t)
  const buildFailure = new Error('build failed before cleanup')
  let disposed = false
  const runner = {
    async dispose() {
      disposed = true
    },
    async run(command: string, args: string[]) {
      if (command === 'git') return exec(command, args)
      await writeFile(join(f.checkout, 'personal.txt'), 'unexpected work must survive')
      throw buildFailure
    },
  }
  await assert.rejects(prepareUpdate({ ...f, state: f.root }, runner), error => {
    assert.ok(error instanceof AggregateError)
    assert.equal(error.cause, buildFailure)
    assert.equal(error.errors[0], buildFailure)
    assert.match(error.errors[1].message, /unexpected changes/)
    assert.match(error.message, /build failed before cleanup/)
    return true
  })
  assert.equal(disposed, true)
  assert.equal(await readFile(join(f.checkout, 'personal.txt'), 'utf8'), 'unexpected work must survive')
})

test('owned worktree removal handles deep dependency paths without changing repository configuration', async t => {
  const f = await fixture(t)
  await f.git('config', 'core.longpaths', 'false')
  await f.git('worktree', 'add', '--detach', f.checkout, f.commit)
  const nested = join(
    f.checkout,
    'node_modules',
    ...Array.from({ length: 12 }, (_, i) => `dependency-${i}-nested-package`),
  )
  await mkdir(nested, { recursive: true })
  await writeFile(join(nested, 'installed.js'), 'export default 1')
  await removeUpdateWorktree(f.repo, f.checkout, f.commit)
  await assert.rejects(readFile(join(nested, 'installed.js')), { code: 'ENOENT' })
  assert.equal((await f.git('worktree', 'list', '--porcelain')).split('worktree ').length - 1, 1)
  assert.equal(await f.git('config', 'core.longpaths'), 'false')
})

test('pre-existing and modified checkouts are retained', async t => {
  const f = await fixture(t)
  await f.git('worktree', 'add', '--detach', f.checkout, f.commit)
  await writeFile(join(f.checkout, 'personal.txt'), 'do not delete')
  await assert.rejects(prepareUpdate({ ...f, state: f.root }), /exited/)
  await assert.rejects(removeUpdateWorktree(f.repo, f.checkout, f.commit), /unexpected changes/)
  assert.equal(await readFile(join(f.checkout, 'personal.txt'), 'utf8'), 'do not delete')
})

test('snapshot links into source are rejected; internal links are accepted', async t => {
  const f = await fixture(t)
  await f.git('worktree', 'add', '--detach', f.checkout, f.commit)
  const runtime = join(f.directory, 'runtime'),
    boot = join(f.directory, 'boot')
  await mkdir(runtime)
  await mkdir(boot)
  await writeFile(join(boot, 'supervisor.mjs'), '')
  await writeFile(join(runtime, 'node'), 'retained node')
  const candidate = {
    protocol: 1,
    commit: f.commit,
    broker: join(boot, 'supervisor.mjs'),
    snapshot: { seedProfile: runtime, node: join(runtime, 'node'), supervisor: join(boot, 'supervisor.mjs') },
  }
  const link = join(runtime, 'source-link')
  await symlink(f.checkout, link, 'junction')
  await assert.rejects(assertIndependentCandidate(f.directory, candidate, f.commit), /escapes/)
  await rm(link)
  await mkdir(join(runtime, 'installed'))
  await symlink(join(runtime, 'installed'), link, 'junction')
  await assertIndependentCandidate(f.directory, candidate, f.commit)
  await assert.rejects(
    assertIndependentCandidate(
      f.directory,
      {
        ...candidate,
        snapshot: { ...candidate.snapshot, node: join(f.checkout, 'package.json') },
      },
      f.commit,
    ),
    /escapes/,
  )
})

test('candidate owns an executable that survives removal of its preparing launcher', async t => {
  const f = await fixture(t)
  const launcher = join(f.root, 'web-start', 'runtime')
  const temporaryNode = await retainCandidateNode(launcher)
  const retained = await retainCandidateNode(f.directory, temporaryNode)
  await rm(launcher, { recursive: true })
  assert.equal((await exec(retained, ['--version'])).stdout.trim(), process.version)
  await assert.rejects(retainCandidateNode(f.directory), { code: 'EEXIST' })
})

test('candidate rejects executable paths and symlinks into an external Web launcher', async t => {
  const f = await fixture(t)
  const runtime = join(f.directory, 'runtime'),
    boot = join(f.directory, 'boot')
  await mkdir(runtime, { recursive: true })
  await mkdir(boot)
  await writeFile(join(boot, 'supervisor.mjs'), '')
  const external = await retainCandidateNode(join(f.root, 'web-start'))
  const candidate = {
    protocol: 1,
    commit: f.commit,
    broker: join(boot, 'supervisor.mjs'),
    snapshot: { seedProfile: runtime, node: external, supervisor: join(boot, 'supervisor.mjs') },
  }
  await assert.rejects(assertIndependentCandidate(f.directory, candidate, f.commit), /escapes/)
  const link = join(runtime, 'node')
  await symlink(external, link)
  candidate.snapshot.node = link
  await assert.rejects(assertIndependentCandidate(f.directory, candidate, f.commit), /escapes/)
})
