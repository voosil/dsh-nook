import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'
import { promisify } from 'node:util'
import { ROOT } from '../../scripts/profile/profile-lib.mjs'

const execute = promisify(execFile)

async function launcherFixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'nook-dev-startup-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  const files = {
    'package.json': JSON.stringify({ type: 'module', scripts: { build: 'node build.mjs' } }),
    'source.txt': 'first build',
    'build.mjs': `
      import { mkdir, readFile, writeFile } from 'node:fs/promises'
      const source = await readFile('source.txt', 'utf8')
      await mkdir('lib', { recursive: true })
      await writeFile('lib/host.mjs', 'export default ' + JSON.stringify(source))
      await writeFile('lib/client.js', source)
    `,
    '.dsh-dev/profiles/nook/package.json': '{}',
    '.dsh-dev/profiles/nook/cordis.patch.yml': '[]',
    // A consumer of Host and Client output keeps this test focused on the real
    // launcher's preparation; profile-boot.test.ts covers the pinned DSH runtime.
    'node_modules/@deepseek-ai/dsh/lib/bin.js': `
      const { readFile, writeFile } = await import('node:fs/promises')
      const { pathToFileURL } = await import('node:url')
      const source = await readFile('source.txt', 'utf8')
      const { default: host } = await import(pathToFileURL(process.cwd() + '/lib/host.mjs'))
      const client = await readFile('lib/client.js', 'utf8')
      if (host !== source || client !== source) throw new Error('stale build artifacts')
      await writeFile('booted.txt', source)
    `,
  }
  for (const [path, content] of Object.entries(files)) {
    const target = resolve(root, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
  }
  await mkdir(resolve(root, '.dsh-dev/profiles/nook/node_modules'))
  for (const script of [
    'profile/run-profile.mjs',
    'profile/profile-lib.mjs',
    'profile/run-profile-args.mjs',
    'shared/process-scope.mjs',
    'profile/dev-watch.mjs',
    'profile/dev-sandbox.mjs',
  ]) {
    const target = resolve(root, 'scripts', script)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(resolve(ROOT, 'scripts', script), target)
  }

  return {
    root,
    launch: (args: string[] = []) =>
      execute(process.execPath, [resolve(root, 'scripts/profile/run-profile.mjs'), ...args, '--port', '0'], {
        cwd: root,
        env: { ...process.env, DSH_HOME: resolve(root, '.dsh-dev') },
        timeout: 15_000,
      }),
  }
}

for (const args of [[], ['--safe-ui']]) {
  test(`${['dev', ...args].join(' ')} builds missing and stale Host/Client output before boot`, async t => {
    const { root, launch } = await launcherFixture(t)
    await launch(args)
    assert.equal(await readFile(resolve(root, 'booted.txt'), 'utf8'), 'first build')

    await writeFile(resolve(root, 'source.txt'), 'updated source')
    await launch(args)
    assert.equal(await readFile(resolve(root, 'booted.txt'), 'utf8'), 'updated source')
  })
}

test('dev stops before boot when the build fails', async t => {
  const { root, launch } = await launcherFixture(t)
  await execute(process.execPath, ['build.mjs'], { cwd: root })
  await writeFile(resolve(root, 'build.mjs'), "throw new Error('fixture build failure')\n")
  await assert.rejects(launch(), /fixture build failure/)
  await assert.rejects(readFile(resolve(root, 'booted.txt')), { code: 'ENOENT' })
})
