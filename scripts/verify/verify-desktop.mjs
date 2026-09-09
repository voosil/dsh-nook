import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { dismissOnboarding, notebookSmoke } from './notebook-smoke.mjs'
import { ROOT, run, runPnpm } from '../profile/profile-lib.mjs'

const require = createRequire(import.meta.url)
const { _electron, chromium } = createRequire(require.resolve('dsh-browser-playwright/playwright'))('playwright-core')
if (!process.argv.includes('--skip-package')) await runPnpm(['run', 'desktop:package'])
const temporary = await mkdtemp(join(tmpdir(), 'nook-desktop-verify-'))
const movedApp = join(temporary, '搬移 app', 'Nook.app')
const executablePath = join(movedApp, 'Contents/MacOS/Nook')
const state = join(temporary, '桌面 state')
async function waitForWorkspace(page) {
  await Promise.race([
    page.getByRole('dialog', { name: 'Nook 笔记工作区', exact: true }).waitFor({ timeout: 120_000 }),
    page
      .getByRole('heading', { name: 'Nook 暂时无法打开', exact: true })
      .waitFor({ timeout: 120_000 })
      .then(async () => {
        throw new Error(await page.locator('#message').innerText())
      }),
  ])
}
let desktop
let web
let browser
let url
try {
  await mkdir(join(temporary, '搬移 app'))
  await cp(resolve(ROOT, '.pack/desktop/mac-arm64/Nook.app'), movedApp, { recursive: true, verbatimSymlinks: true })
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined),
  )
  env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin'
  const payload = join(movedApp, 'Contents/Resources/runtime/payload')
  await run(
    join(payload, 'node/bin/node'),
    [
      resolve(ROOT, 'scripts/verify/desktop-native-smoke.mjs'),
      join(payload, 'home/profiles/nook'),
      join(temporary, 'native-scratch'),
    ],
    { env: { ...env, DSH_HOME: join(temporary, 'native-home') }, cwd: temporary },
  )
  const launchOptions = {
    executablePath,
    args: ['--test-mode'],
    env: { ...env, NOOK_DESKTOP_TEST_ROOT: state },
    cwd: temporary,
    chromiumSandbox: true,
    timeout: 120_000,
  }
  const firstStart = performance.now()
  desktop = await _electron.launch(launchOptions)
  const page = await desktop.firstWindow()
  page.setDefaultTimeout(60_000)
  await waitForWorkspace(page)
  console.log('Packaged workspace opened.')
  const firstStartMs = Math.round(performance.now() - firstStart)
  url = new URL(page.url()).origin
  assert.equal(new URL(page.url()).search, '')
  const preferences = await desktop.evaluate(({ BrowserWindow }) => {
    const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
    return {
      sandbox: p.sandbox,
      contextIsolation: p.contextIsolation,
      nodeIntegration: p.nodeIntegration,
      webSecurity: p.webSecurity,
    }
  })
  assert.deepEqual(preferences, { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true })
  const artifact = resolve(ROOT, '.pack/desktop/nook-window.png')
  const { title } = await notebookSmoke(page.url(), artifact, page)
  console.log('Notebook window acceptance passed.')
  const unauthorized = await fetch(url)
  assert.equal(unauthorized.status, 401)
  const logs = join(state, 'logs')
  for (const name of await readdir(logs)) {
    const text = await readFile(join(logs, name), 'utf8')
    assert.doesNotMatch(text, /[?&]token=(?!<REDACTED>)[A-Za-z0-9_-]+/)
  }
  await desktop.close()
  desktop = undefined
  await assert.rejects(fetch(url, { signal: AbortSignal.timeout(2000) }))

  // Reopen the same installed state: validates payload immutability and Profile reuse.
  const secondStart = performance.now()
  desktop = await _electron.launch(launchOptions)
  const reopened = await desktop.firstWindow()
  reopened.setDefaultTimeout(30_000)
  await waitForWorkspace(reopened)
  console.log('Second startup opened the workspace.')
  const secondStartMs = Math.round(performance.now() - secondStart)
  url = new URL(reopened.url()).origin
  await dismissOnboarding(reopened)
  const workspace = reopened.getByRole('dialog', { name: 'Nook 笔记工作区', exact: true })
  await workspace.getByRole('button', { name: '回收站', exact: true }).click()
  await workspace.locator('.nook-note-card').filter({ hasText: title }).click()
  assert.ok((await workspace.getByRole('textbox', { name: '笔记正文', exact: true }).innerText()).includes('劳动异化'))
  const backupNames = (await readdir(join(state, 'backups'))).filter(name => !name.startsWith('.'))
  assert.equal(backupNames.length, 1, 'Second launch must create a verified data backup')
  // The Web launcher uses this same client. It must join the desktop's backend
  // without installing or spawning another runtime, and own an independent lease.
  const { SharedRuntime } = await import('../../apps/desktop/dist/shared-client.mjs')
  web = new SharedRuntime(
    state,
    async () => {
      throw new Error('Web must reuse the desktop backend')
    },
    () => {},
    () => {},
  )
  const webUrl = await web.ready
  assert.equal(new URL(webUrl).origin, url)
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const webPage = await browser.newPage()
  webPage.setDefaultTimeout(30_000)
  await webPage.goto(webUrl)
  await waitForWorkspace(webPage)
  await dismissOnboarding(webPage)
  const webWorkspace = webPage.getByRole('dialog', { name: 'Nook 笔记工作区', exact: true })
  await webWorkspace.getByRole('button', { name: '回收站', exact: true }).click()
  await webWorkspace.locator('.nook-note-card').filter({ hasText: title }).click()
  await webWorkspace.getByRole('button', { name: '恢复笔记', exact: true }).click()
  await webWorkspace.getByRole('button', { name: '所有笔记', exact: true }).click()
  await webWorkspace.locator('.nook-note-card').filter({ hasText: title }).click()
  const sharedTitle = `${title} 网页修改`
  await webWorkspace.getByRole('textbox', { name: '笔记标题', exact: true }).fill(sharedTitle)
  await webWorkspace.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await desktop.close()
  desktop = undefined
  assert.equal((await fetch(url)).status, 401, 'Web lease must keep the authenticated backend running')
  await webPage.reload()
  await waitForWorkspace(webPage)
  desktop = await _electron.launch(launchOptions)
  const shared = await desktop.firstWindow()
  shared.setDefaultTimeout(30_000)
  await waitForWorkspace(shared)
  assert.equal(new URL(shared.url()).origin, url)
  await dismissOnboarding(shared)
  const sharedWorkspace = shared.getByRole('dialog', { name: 'Nook 笔记工作区', exact: true })
  await sharedWorkspace.getByRole('button', { name: '所有笔记', exact: true }).click()
  await sharedWorkspace.locator('.nook-note-card').filter({ hasText: sharedTitle }).click()
  assert.equal(await sharedWorkspace.getByRole('textbox', { name: '笔记标题', exact: true }).inputValue(), sharedTitle)
  await shared.screenshot({ path: resolve(ROOT, '.pack/desktop/nook-shared-window.png') })
  await web.stop()
  web = undefined
  await browser.close()
  browser = undefined
  assert.equal((await fetch(url)).status, 401, 'Desktop lease must keep the backend running after Web closes')
  await desktop.close()
  desktop = undefined
  await assert.rejects(fetch(url, { signal: AbortSignal.timeout(2000) }))
  console.log('Web and desktop share data and one backend; either can close independently.')

  // Corrupt only this disposable installation, then repair it and exercise retry
  // in the same real window that presents the integrity error.
  const versions = await readdir(join(state, 'runtimes'))
  assert.equal(versions.length, 1)
  const license = join(state, 'runtimes', versions[0], 'node', 'LICENSE')
  const originalLicense = await readFile(license)
  await writeFile(license, 'synthetic integrity failure')
  desktop = await _electron.launch(launchOptions)
  const failed = await desktop.firstWindow()
  failed.setDefaultTimeout(30_000)
  await failed.getByRole('heading', { name: 'Nook 暂时无法打开', exact: true }).waitFor({ timeout: 120_000 })
  assert.ok((await failed.locator('#message').innerText()).includes('本地服务未能启动'))
  await writeFile(license, originalLicense)
  await failed.getByRole('link', { name: '重试', exact: true }).click()
  await waitForWorkspace(failed)
  url = new URL(failed.url()).origin
  await desktop.close()
  desktop = undefined
  await assert.rejects(fetch(url, { signal: AbortSignal.timeout(2000) }))
  const processes = await run('ps', ['-axo', 'pid=,args='], { capture: true })
  assert.equal(processes.stdout.includes(state), false, 'Desktop left processes running')
  console.log(
    `Verified packaged Nook window, sandbox, authentication, notebook RPC/persistence, restart, integrity failure/retry, and cleanup. First start: ${firstStartMs} ms; second start: ${secondStartMs} ms. Screenshot: ${artifact}`,
  )
} catch (error) {
  try {
    const page = desktop?.windows()[0]
    if (page) {
      await page.screenshot({ path: resolve(ROOT, '.pack/desktop/nook-error.png') })
      console.error(await page.locator('body').innerText({ timeout: 2000 }))
    }
  } catch {}
  try {
    for (const name of await readdir(join(state, 'logs')))
      console.error(await readFile(join(state, 'logs', name), 'utf8'))
  } catch {}
  throw error
} finally {
  await desktop?.close()
  await web?.stop()
  await browser?.close()
  await delay(100)
  await rm(temporary, { recursive: true, force: true })
}
