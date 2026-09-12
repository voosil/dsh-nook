import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { discoverTests } from '../../../scripts/test/run.mjs'
import { ProcessScope } from '../../../scripts/shared/process-scope.mjs'
import { ROOT } from '../../../scripts/profile/profile-lib.mjs'

async function fixture(t, files) {
  const directory = await mkdtemp(join(tmpdir(), 'nook-test-discovery-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  for (const [file, source] of Object.entries(files)) {
    const path = join(directory, file)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, source)
  }
  return directory
}

test('nested Node and Python cases are discovered without executing helpers or platform-only suites', async t => {
  const root = await fixture(
    t,
    Object.fromEntries(
      [
        'integration/example/deep/one.test.mjs',
        'integration/example/test_one.py',
        'integration/example/helpers/wrong.test.mjs',
        'integration/example/fixtures/test_wrong.py',
        'integration/example/docker/remote.test.ts',
        'integration/example/linux/test_remote.py',
        'integration/example/posix/test_native.py',
        'integration/example/ordinary.mjs',
      ].map(file => [file, '']),
    ),
  )
  const windows = await discoverTests('integration', { root, platform: 'win32' })
  assert.deepEqual(
    windows.files.map(file => relative(root, file).replaceAll('\\', '/')),
    ['integration/example/deep/one.test.mjs', 'integration/example/test_one.py'],
  )
  assert.equal(windows.skipped.length, 1)
  const linux = await discoverTests('integration', { root, platform: 'linux' })
  assert.equal(linux.files.length, 3)
})

test('overlapping execution groups run a case once and propagate real test failure', async t => {
  const root = await fixture(t, {
    'e2e/profile/pass.test.mjs':
      "import { test } from 'node:test'; test('unique execution', () => console.log('CASE_EXECUTED'))",
    'unit/deep/fail.test.mjs':
      "import { test } from 'node:test'; test('deliberate failure', () => { throw Error('EXPECTED_FAILURE') })",
  })
  const scope = new ProcessScope()
  t.after(() => scope.dispose())
  const run = groups =>
    scope.run(process.execPath, [join(ROOT, 'scripts/test/run.mjs'), ...groups, '--prepared', '--tests-root', root], {
      cwd: ROOT,
      capture: true,
      windowsHide: true,
    })
  const passed = await run(['e2e', 'profile', 'e2e'])
  assert.equal(passed.stdout.split('CASE_EXECUTED').length - 1, 1)
  await assert.rejects(run(['unit']), /EXPECTED_FAILURE/)
  await assert.rejects(run(['e2e', '--match', 'nonexistent']), /No tests selected/)
  await assert.rejects(run(['unknown']), /Unknown test group/)
})
