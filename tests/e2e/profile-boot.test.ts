import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { bootAndVerifyWeb } from '../../scripts/runtime-verify.mjs'
import { ROOT, devRuntimeEnv, dshBin } from '../../scripts/profile-lib.mjs'

test('full official + community + product Profile boots and serves Nook UI', { timeout: 60_000 }, async () => {
  const result = await bootAndVerifyWeb({
    bin: dshBin(),
    cwd: ROOT,
    env: devRuntimeEnv(),
  })
  assert.equal(result.status, 200)
  assert.match(result.url, /^http:\/\/127\.0\.0\.1:\d+$/)
})

test('Safe UI patch boots the official shell without Nook Client plugins', { timeout: 60_000 }, async () => {
  const result = await bootAndVerifyWeb({
    bin: dshBin(),
    cwd: ROOT,
    env: devRuntimeEnv(),
    patch: resolve(ROOT, 'dev/patches/safe-ui.cordis.yml'),
    expectedPackages: [],
    excludedPackages: ['@nook-dsh/ui-project', '@nook-dsh/ui-sidebar'],
  })
  assert.equal(result.status, 200)
})
