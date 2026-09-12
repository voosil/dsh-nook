import { resolve } from 'node:path'
import { test, type TestContext } from 'node:test'
import { createDevSandbox } from '../../../scripts/profile/dev-sandbox.mjs'
import { ROOT, dshBin } from '../../../scripts/profile/profile-lib.mjs'
import { withWebRuntime } from '../../helpers/runtime/web.mjs'
import { withNotebookPage } from '../../helpers/browser/page.mjs'
import { notebookScenarios } from '../../helpers/scenarios/notebook.mjs'
import { taskScenarios } from '../../helpers/scenarios/tasks.mjs'
import { verifyAuthentication, verifySafeUi } from '../../helpers/scenarios/authentication.mjs'

async function withProfile(t: TestContext, callback: (url: string, runtime: any) => Promise<unknown>, safeUi = false) {
  const sandbox = await createDevSandbox()
  t.after(() => sandbox.dispose())
  return withWebRuntime(
    {
      bin: dshBin(),
      cwd: ROOT,
      env: sandbox.env,
      ...(safeUi ? { patch: resolve(ROOT, 'dev/patches/safe-ui.cordis.yml') } : {}),
    },
    callback,
  )
}

test('Profile requires authentication and serves the authenticated shell', { timeout: 180_000 }, async t => {
  await withProfile(t, verifyAuthentication)
})

test('Safe UI opens a usable official conversation without Nook Client plugins', { timeout: 180_000 }, async t => {
  await withProfile(t, verifySafeUi, true)
})

for (const [name, scenario] of [...notebookScenarios, ...taskScenarios]) {
  test('linked Profile: ' + name, { timeout: 240_000 }, async t => {
    await withProfile(t, (url, runtime) =>
      withNotebookPage(url, page => scenario(page, { profileDirectory: runtime.profileDirectory }), { name }),
    )
  })
}
