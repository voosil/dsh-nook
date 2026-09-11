import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { dirname, join, relative, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
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
    '.dsh-dev/profiles/nook/package.json': JSON.stringify({
      dependencies: { '@fixture/plugin': 'link:../../../packages/plugin' },
    }),
    'profile-source.json': JSON.stringify({
      dependencies: { '@fixture/plugin': 'link:../../../packages/plugin' },
    }),
    '.dsh-dev/profiles/nook/cordis.patch.yml': '[]',
    'packages/plugin/package.json': JSON.stringify({ name: '@fixture/plugin', type: 'module', exports: './index.js' }),
    'packages/plugin/index.js': 'export default "linked plugin"',
    // A consumer of Host and Client output keeps this test focused on the real
    // launcher's preparation; profile-boot.test.ts covers the pinned DSH runtime.
    'node_modules/@deepseek-ai/dsh/lib/bin.js': `
      const { readFile, writeFile } = await import('node:fs/promises')
      const { pathToFileURL } = await import('node:url')
      const { createRequire } = await import('node:module')
      const { resolve } = await import('node:path')
      const profile = resolve(process.env.DSH_HOME, 'profiles/nook')
      const require = createRequire(resolve(profile, 'package.json'))
      const { default: plugin } = await import(pathToFileURL(require.resolve('@fixture/plugin')))
      if (plugin !== 'linked plugin') throw new Error('wrong plugin')
      // DSH owns fallback entries in this directory; they must stay temporary.
      await writeFile(resolve(profile, 'node_modules/fallback-probe'), 'temporary')
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
  const pluginLink = resolve(root, '.dsh-dev/profiles/nook/node_modules/@fixture/plugin')
  await mkdir(dirname(pluginLink), { recursive: true })
  await symlink(relative(dirname(pluginLink), resolve(root, 'packages/plugin')), pluginLink, 'dir')
  for (const script of [
    'profile/run-profile.mjs',
    'profile/run-profile-args.mjs',
    'profile/web-port.mjs',
    'shared/process-scope.mjs',
    'shared/corepack-command.mjs',
    'profile/dev-watch.mjs',
    'profile/dev-sandbox.mjs',
  ]) {
    const target = resolve(root, 'scripts', script)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(resolve(ROOT, 'scripts', script), target)
  }
  // Keep dependency installation real, with a local-only Profile in place of
  // the product's external runtime. Profile generation has its own coverage.
  await writeFile(
    resolve(root, 'scripts/profile/profile-lib.mjs'),
    `
      import { copyFile } from 'node:fs/promises'
      import { resolve } from 'node:path'
      export * from ${JSON.stringify(pathToFileURL(resolve(ROOT, 'scripts/profile/profile-lib.mjs')).href)}
      export const ROOT = resolve(import.meta.dirname, '../..')
      export const PROFILE_DIR = resolve(ROOT, '.dsh-dev/profiles/nook')
      export const dshBin = () => resolve(ROOT, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
      export const writeDevProfile = () => copyFile(resolve(ROOT, 'profile-source.json'), resolve(PROFILE_DIR, 'package.json'))
    `,
  )

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
    await assert.rejects(readFile(resolve(root, '.dsh-dev/profiles/nook/node_modules/fallback-probe')), {
      code: 'ENOENT',
    })
    assert.equal(await readFile(resolve(root, 'packages/plugin/index.js'), 'utf8'), 'export default "linked plugin"')

    await writeFile(resolve(root, 'source.txt'), 'updated source')
    await launch(args)
    assert.equal(await readFile(resolve(root, 'booted.txt'), 'utf8'), 'updated source')
  })
}

for (const declared of [false, true]) {
  test(`dev repairs a missing dependency link when the cached manifest ${declared ? 'declares' : 'omits'} it`, async t => {
    const { root, launch } = await launcherFixture(t)
    const manifest = await readFile(resolve(root, 'profile-source.json'), 'utf8')
    if (!declared) await writeFile(resolve(root, '.dsh-dev/profiles/nook/package.json'), '{"dependencies":{}}')
    await rm(resolve(root, '.dsh-dev/profiles/nook/node_modules/@fixture/plugin'))
    await launch()
    assert.equal(await readFile(resolve(root, 'booted.txt'), 'utf8'), 'first build')
    assert.deepEqual(
      JSON.parse(await readFile(resolve(root, '.dsh-dev/profiles/nook/package.json'), 'utf8')),
      JSON.parse(manifest),
    )
  })
}

test('dev stops before boot when Profile dependency installation fails', async t => {
  const { root, launch } = await launcherFixture(t)
  await writeFile(
    resolve(root, 'profile-source.json'),
    JSON.stringify({ dependencies: { '@fixture/missing': 'file:../../../missing-package' } }),
  )
  await assert.rejects(launch(), /missing-\s*package/)
  await assert.rejects(readFile(resolve(root, 'booted.txt')), { code: 'ENOENT' })
})

test('dev stops before boot when the build fails', async t => {
  const { root, launch } = await launcherFixture(t)
  await execute(process.execPath, ['build.mjs'], { cwd: root })
  await writeFile(resolve(root, 'build.mjs'), "throw new Error('fixture build failure')\n")
  await assert.rejects(launch(), /fixture build failure/)
  await assert.rejects(readFile(resolve(root, 'booted.txt')), { code: 'ENOENT' })
})

test(
  'Windows dev rejects an unavailable explicit port before building',
  { skip: process.platform !== 'win32' },
  async t => {
    const { root, launch } = await launcherFixture(t)
    const server = createServer()
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    t.after(() => new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve()))))
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    await assert.rejects(launch(['--port', String(address.port)]), /Choose another --port or use --port 0/)
    await assert.rejects(readFile(resolve(root, 'lib/host.mjs')), { code: 'ENOENT' })
    assert.equal(server.listening, true)
  },
)
