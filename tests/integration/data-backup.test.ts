import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { acquireDataLock } from '../../packages/storage-backup/src/index.ts'
import { LOCAL_PACKAGES, ROOT } from '../../scripts/profile-lib.mjs'

const execute = promisify(execFile)

test('refreshing a development Profile preserves existing user patch configuration', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nook-profile-data-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const name of [
    'scripts/profile-lib.mjs',
    'pnpm-lock.yaml',
    ...LOCAL_PACKAGES.map(name => `packages/${name}/package.json`),
  ]) {
    await mkdir(dirname(join(root, name)), { recursive: true })
    await copyFile(resolve(ROOT, name), join(root, name))
  }
  const patch = join(root, '.dsh-dev/profiles/nook/cordis.patch.yml')
  await mkdir(dirname(patch), { recursive: true })
  const configuration = '- id: user-configuration\n  disabled: true\n'
  await writeFile(patch, configuration)
  await execute(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const { writeDevProfile } = await import(${JSON.stringify(pathToFileURL(join(root, 'scripts/profile-lib.mjs')).href)}); await writeDevProfile();`,
    ],
    {
      cwd: root,
      env: { ...process.env, DSH_HOME: join(root, '.dsh-dev') },
      timeout: 10_000,
    },
  )
  assert.equal(await readFile(patch, 'utf8'), configuration)
})

test('backup CLI round trip, nonzero failures and cross-process runtime exclusion', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nook-backup-cli-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'nook')
  const output = join(root, 'backups')
  await mkdir(source)
  await writeFile(join(source, 'user-data'), '需要保护的数据')
  const cli = (...args: string[]) =>
    execute(process.execPath, ['--import', 'tsx', resolve(ROOT, 'scripts/data-backup.mjs'), ...args], {
      cwd: ROOT,
      env: { ...process.env, DSH_HOME: root },
      timeout: 10_000,
    })
  const release = acquireDataLock(source)
  try {
    await assert.rejects(cli('create', '--source', source, '--output', output), /locked/)
  } finally {
    release()
  }
  const { stdout } = await cli('create', '--source', source, '--output', output)
  const backup = stdout.trim()
  assert.match((await cli('verify', '--from', backup)).stdout, /Verified directory backup/)
  const target = join(root, 'restored')
  await cli('restore', '--from', backup, '--to', target)
  assert.equal(await readFile(join(target, 'user-data'), 'utf8'), '需要保护的数据')
  await assert.rejects(cli('restore', '--from', backup, '--to', target), /EEXIST/)
  await assert.rejects(cli('verify'), /pnpm backup/)
  await writeFile(join(backup, 'data', 'user-data'), 'damaged')
  await assert.rejects(cli('verify', '--from', backup), /checksum mismatch/)
  assert.equal(await readFile(join(source, 'user-data'), 'utf8'), '需要保护的数据')
})
