import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { bootAndVerifyWeb } from '../../scripts/verify/runtime-verify.mjs'
import { createDevSandbox } from '../../scripts/profile/dev-sandbox.mjs'
import { ROOT, dshBin } from '../../scripts/profile/profile-lib.mjs'

test('full official + community + product Profile boots and serves Nook UI', { timeout: 180_000 }, async t => {
  const sandbox = await createDevSandbox()
  t.after(() => sandbox.dispose())
  const result = await bootAndVerifyWeb({
    bin: dshBin(),
    cwd: ROOT,
    env: sandbox.env,
  })
  assert.equal(result.status, 200)
  assert.match(result.url, /^http:\/\/127\.0\.0\.1:\d+$/)
})

test('Safe UI patch boots the official shell without Nook Client plugins', { timeout: 180_000 }, async t => {
  const sandbox = await createDevSandbox()
  t.after(() => sandbox.dispose())
  const result = await bootAndVerifyWeb({
    bin: dshBin(),
    cwd: ROOT,
    env: sandbox.env,
    patch: resolve(ROOT, 'dev/patches/safe-ui.cordis.yml'),
    expectedPackages: [],
    excludedPackages: ['@nook-dsh/ui-project', '@nook-dsh/ui-sidebar', '@nook-dsh/ui-notes', '@nook-dsh/ui-knowledge'],
  })
  assert.equal(result.status, 200)
})
