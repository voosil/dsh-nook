import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { ROOT, runPnpm } from '../../scripts/profile/profile-lib.mjs'
import { dismissOnboarding, waitForNoteSave } from '../../scripts/verify/notebook-smoke.mjs'
import { verifyBackup } from '../../packages/storage-backup/src/index.ts'
import { desktopNode, NODE_VERSION } from '../../scripts/desktop/desktop-node.mjs'

const require = createRequire(import.meta.url)
const { chromium } = createRequire(require.resolve('dsh-browser-playwright/playwright'))('playwright-core')
const redact = (text: string) => text.replace(/([?&]token=)[^\s&]+/g, '$1<REDACTED>')

async function until(predicate: () => boolean, diagnostic: () => string, timeout = 90_000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (predicate()) return
    await delay(100)
  }
  throw new Error(`dev mode acceptance timed out\n${redact(diagnostic())}`)
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  const timer = setTimeout(() => child.kill('SIGKILL'), 15_000)
  try {
    await exited
  } finally {
    clearTimeout(timer)
  }
}

test('dev reloads Client and Host while start serves its fixed build', { timeout: 240_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'nook-dev-modes-'))
  const children: ChildProcess[] = []
  t.after(async () => {
    await Promise.all(children.map(stop))
    await rm(root, { recursive: true, force: true })
  })
  for (const name of [
    'scripts',
    'packages',
    'apps',
    'dev',
    'package.json',
    'pnpm-workspace.yaml',
    'pnpm-lock.yaml',
    'tsconfig.json',
    'tsconfig.base.json',
    'tsconfig.package.json',
  ]) {
    await cp(resolve(ROOT, name), resolve(root, name), {
      recursive: true,
      filter: path =>
        !path.split('/').some(part => ['node_modules', 'dist', 'resources'].includes(part)) &&
        !/^packages\/[^/]+\/lib(?:\/|$)/.test(relative(ROOT, path).replaceAll('\\', '/')),
    })
  }
  // Use the same checksum-verified runtime cache as the actual desktop packager.
  // This test exercises reload/start behavior, not repeated internet downloads.
  const nodeRuntime = await desktopNode()
  await cp(nodeRuntime, resolve(root, '.pack/node', `node-v${NODE_VERSION}-darwin-arm64`), { recursive: true })
  await runPnpm(['install', '--frozen-lockfile'], { cwd: root, capture: true })
  await runPnpm(['run', 'dev:profile'], { cwd: root, capture: true })
  await mkdir(resolve(root, '.dsh-dev/nook'), { recursive: true })
  // Explicit test state skips legacy dev-data migration; seed the actual start data directory.
  await mkdir(resolve(root, 'user-state/harness/nook'), { recursive: true })
  await writeFile(resolve(root, 'user-state/harness/nook/backup-acceptance.txt'), 'preserve before startup')
  const launch = (script: string) => {
    let output = ''
    const urls: string[] = []
    const child = spawn(
      process.execPath,
      [
        resolve(root, 'scripts/profile', script),
        '--port',
        '0',
        ...(script === 'start-profile.mjs' ? ['--test-state', resolve(root, 'user-state')] : []),
      ],
      {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, DSH_HOME: resolve(root, '.dsh-dev') },
      },
    )
    children.push(child)
    const consume = (chunk: Buffer) => {
      output += chunk.toString()
      for (const match of output.matchAll(/dsh web:\s*(http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)(?=\s)/g)) {
        if (!urls.includes(match[1]!)) urls.push(match[1]!)
      }
    }
    child.stdout!.on('data', consume)
    child.stderr!.on('data', consume)
    return { child, urls, logs: () => output }
  }
  const stable = launch('start-profile.mjs')
  await until(() => stable.urls.length === 1, stable.logs)
  const backupRoot = resolve(root, 'user-state/backups')
  const backups = (await readdir(backupRoot)).filter(name => name !== 'migrations' && !name.startsWith('.'))
  const backup = backups
    .map(name => resolve(backupRoot, name))
    .find(path => verifyBackup(path).reason === 'before-desktop-start')!
  assert.ok(backup)
  assert.equal(await readFile(resolve(backup, 'data/backup-acceptance.txt'), 'utf8'), 'preserve before startup')
  const dev = launch('run-profile.mjs')
  await until(() => dev.urls.length === 1, dev.logs)
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  t.after(() => browser.close())
  const errors: string[] = []
  const page = await browser.newPage()
  page.on('pageerror', (error: Error) => errors.push(error.message))
  const stablePage = await browser.newPage()
  await stablePage.goto(stable.urls[0])
  await page.goto(dev.urls[0])
  await page.getByRole('dialog', { name: 'Nook 笔记工作区', exact: true }).waitFor()
  await stablePage.getByRole('dialog', { name: 'Nook 笔记工作区', exact: true }).waitFor()
  await dismissOnboarding(page)
  await page.evaluate(() => {
    ;(window as Window & { nookHmrProbe?: string }).nookHmrProbe = 'same document'
  })
  const sourcePath = resolve(root, 'packages/ui-sidebar/src/client/index.tsx')
  const original = await readFile(sourcePath, 'utf8')
  for (const label of ['打开 Nook HMR 1', '打开 Nook HMR 2']) {
    await writeFile(sourcePath, original.replace('aria-label="打开 Nook"', `aria-label="${label}"`))
    await page.getByRole('button', { name: label, exact: true }).waitFor({ timeout: 30_000 })
    assert.equal(await page.getByRole('button', { name: label, exact: true }).count(), 1)
    assert.equal(
      await page.evaluate(() => (window as Window & { nookHmrProbe?: string }).nookHmrProbe),
      'same document',
    )
    assert.equal(dev.urls.length, 1, 'Client update must not restart the Host')
    await stablePage.reload()
    assert.equal(await stablePage.getByRole('button', { name: '打开 Nook', exact: true }).count(), 1)
    assert.equal(stable.urls.length, 1)
  }
  await writeFile(sourcePath, original + '\nthis is invalid typescript !!!\n')
  await until(() => dev.logs().includes('Build/reload failed'), dev.logs, 30_000)
  assert.equal(dev.urls.length, 1)
  assert.equal(await page.getByRole('button', { name: '打开 Nook HMR 2', exact: true }).count(), 1)
  await writeFile(sourcePath, original.replace('aria-label="打开 Nook"', 'aria-label="打开 Nook recovered"'))
  await page.getByRole('button', { name: '打开 Nook recovered', exact: true }).waitFor({ timeout: 30_000 })
  const cssPath = resolve(root, 'packages/ui-notes/src/client/styles/index.css')
  await writeFile(cssPath, (await readFile(cssPath, 'utf8')) + '\n.nook-workspace { --nook-hmr-probe: verified; }\n')
  await page.waitForFunction(() => {
    const element = document.querySelector('.nook-workspace')
    return element && getComputedStyle(element).getPropertyValue('--nook-hmr-probe').trim() === 'verified'
  })
  assert.equal(await page.locator('.nook-workspace').count(), 1, 'workspace Slot must not duplicate after remount')
  assert.equal(dev.urls.length, 1, 'CSS update must not restart the Host')
  const host = resolve(root, 'packages/ui-sidebar/src/index.ts')
  await writeFile(host, (await readFile(host, 'utf8')) + '\nexport const devAcceptance = true\n')
  await until(() => dev.urls.length === 2, dev.logs, 30_000)
  assert.equal(new URL(dev.urls[0]!).origin, new URL(dev.urls[1]!).origin)
  // Exercise real RPC after reconnect without reloading the document.
  const workspace = page.getByRole('dialog', { name: 'Nook 笔记工作区', exact: true })
  await workspace
    .getByRole('button', { name: /写一条笔记/ })
    .first()
    .click()
  await workspace.getByRole('textbox', { name: '笔记标题', exact: true }).fill('saved after Host restart')
  await waitForNoteSave(page)
  assert.equal(await page.evaluate(() => (window as Window & { nookHmrProbe?: string }).nookHmrProbe), 'same document')
  await stablePage.reload()
  await stablePage.getByRole('button', { name: '打开 Nook', exact: true }).waitFor()
  assert.deepEqual(errors, [])
  const devOrigin = new URL(dev.urls[0]!).origin
  const stableOrigin = new URL(stable.urls[0]!).origin
  await stop(dev.child)
  await stop(stable.child)
  await assert.rejects(readFile(resolve(root, 'user-state/harness/nook.lock/owner.json')), { code: 'ENOENT' })
  await assert.rejects(fetch(devOrigin))
  await assert.rejects(fetch(stableOrigin))
})
