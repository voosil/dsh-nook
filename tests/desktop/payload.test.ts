import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  installPayload,
  preparePayload,
  activateProfile,
  inventory,
  verifyPayload,
  type PayloadManifest,
} from '../../apps/desktop/src/payload.ts'

async function seed(root: string, version: string) {
  const seed = join(root, version)
  const payload = join(seed, 'payload')
  const profile = join(payload, 'home/profiles/nook')
  await mkdir(join(profile, 'node_modules/@deepseek-ai/dsh/lib'), { recursive: true })
  await mkdir(join(payload, 'node/bin'), { recursive: true })
  await mkdir(join(payload, 'boot'))
  await writeFile(
    join(profile, 'node_modules/@deepseek-ai/dsh/package.json'),
    JSON.stringify({ bin: { dsh: 'lib/bin.js' } }),
  )
  await writeFile(join(profile, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), version)
  await writeFile(join(profile, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['test-bundle'] } } }))
  await writeFile(join(payload, 'node/bin/node'), version)
  await writeFile(join(payload, 'boot/supervisor.mjs'), version)
  const manifest: PayloadManifest = {
    schemaVersion: 1,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: '24.20.0',
    electronVersion: '44.2.0',
    entries: await inventory(payload),
  }
  await writeFile(join(seed, 'manifest.json'), JSON.stringify(manifest))
  return { seed, payload, manifest }
}

test('runtime upgrades retain user patch, data, prior runtime and writable Profile', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nook-payload-test-'))
  try {
    const first = await seed(root, 'v1')
    const state = join(root, 'state')
    const config = await installPayload(first.seed, state)
    const patch = join(config.home, 'profiles/nook/cordis.patch.yml')
    await writeFile(patch, '- id: custom\n  disabled: true\n')
    await mkdir(join(config.home, 'nook'))
    await writeFile(join(config.home, 'nook/user.json'), '{"preserved":true}')
    const next = await seed(root, 'v2')
    const beforeModules = await readlink(join(config.home, 'profiles/nook/node_modules/@deepseek-ai/dsh'))
    const prepared = await preparePayload(next.seed, state)
    assert.equal(
      await readlink(join(config.home, 'profiles/nook/node_modules/@deepseek-ai/dsh')),
      beforeModules,
      'Preparation must leave the running Profile on its old dependencies',
    )
    assert.equal(await readFile(config.bin, 'utf8'), 'v1')
    const upgraded = await activateProfile({ state, ...prepared })
    assert.notEqual(upgraded.bin, config.bin)
    assert.equal(await readFile(config.bin, 'utf8'), 'v1')
    assert.match(await readFile(patch, 'utf8'), /custom/)
    assert.equal(await readFile(join(config.home, 'nook/user.json'), 'utf8'), '{"preserved":true}')
    assert.equal((await readdir(join(state, 'runtimes'))).length, 2)
    assert.deepEqual(await installPayload(next.seed, state), upgraded)
    await writeFile(join(config.home, 'profiles/nook/node_modules/user-added.txt'), 'kept')
    await installPayload(next.seed, state)
    assert.equal(await readFile(join(config.home, 'profiles/nook/node_modules/user-added.txt'), 'utf8'), 'kept')
    const dependency = join(config.home, 'profiles/nook/node_modules/@deepseek-ai/dsh')
    await rm(dependency)
    const override = join(root, 'missing-user-override')
    await symlink(override, dependency)
    await assert.rejects(installPayload(next.seed, state), /not application-owned/)
    assert.equal(await readlink(dependency), override, 'A broken user override must not be overwritten')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('corrupt payload or escaping links fail before user state is created', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nook-payload-corrupt-'))
  try {
    const item = await seed(root, 'v1')
    await writeFile(join(item.payload, 'node/bin/node'), 'corrupt')
    await assert.rejects(verifyPayload(item.payload, item.manifest), /integrity/)
    await assert.rejects(installPayload(item.seed, join(root, 'state')), /integrity/)
    await symlink(root, join(item.payload, 'escape'))
    await assert.rejects(inventory(item.payload), /escapes/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('runtime symlink integrity is independent of a restrictive process umask', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nook-payload-mask-'))
  const oldMask = process.umask()
  try {
    const item = await seed(root, 'v1')
    await symlink('node', join(item.payload, 'node-alias'))
    item.manifest.entries = await inventory(item.payload)
    await writeFile(join(item.seed, 'manifest.json'), JSON.stringify(item.manifest))
    process.umask(0o077)
    const config = await installPayload(item.seed, join(root, 'state'))
    assert.equal(await readFile(config.node, 'utf8'), 'v1')
  } finally {
    process.umask(oldMask)
    await rm(root, { recursive: true, force: true })
  }
})
