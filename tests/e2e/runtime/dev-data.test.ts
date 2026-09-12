import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { createDevSandbox } from '../../../scripts/profile/dev-sandbox.mjs'
import { seedDevData } from '../../../scripts/profile/dev-seed.mjs'
import { withWebRuntime } from '../../helpers/runtime/web.mjs'
import { dismissOnboarding } from '../../helpers/browser/notebook.mjs'
import { ROOT, dshBin } from '../../../scripts/profile/profile-lib.mjs'

const require = createRequire(import.meta.url)
const { chromium } = createRequire(require.resolve('dsh-browser-playwright/playwright'))('playwright-core')

test(
  'development runtime shows examples and disables sync including guide deep links',
  { timeout: 180_000 },
  async t => {
    const sandbox = await createDevSandbox()
    t.after(() => sandbox.dispose())
    await seedDevData(sandbox.home)
    await withWebRuntime(
      { bin: dshBin(), cwd: ROOT, env: { ...sandbox.env, NOOK_DEV_RUNTIME: '1' } },
      async (url: string) => {
        const browser = await chromium.launch({ channel: 'chrome', headless: true })
        try {
          const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
          const errors: string[] = []
          page.on('pageerror', (error: Error) => errors.push(error.message))
          await page.goto(url)
          await dismissOnboarding(page)
          const workspace = page.getByRole('dialog', { name: 'Nook 笔记工作区', exact: true })
          await workspace.waitFor()
          await workspace.getByText('欢迎来到开发工作区', { exact: true }).first().waitFor()
          await workspace.getByRole('button', { name: '设置', exact: true }).click()
          const settings = page.getByRole('dialog', { name: '设置', exact: true })
          const sync = settings.getByRole('button', { name: '数据同步', exact: true })
          assert.equal(await sync.isDisabled(), true)
          assert.equal(await sync.getAttribute('title'), '开发环境已禁用数据同步')
          await settings.getByRole('button', { name: '夜晚', exact: false }).click()
          assert.equal(await workspace.getAttribute('data-nook-theme'), 'night')
          await page.evaluate(() => {
            window.location.hash = 'nook-sync-guide'
          })
          await settings.getByRole('button', { name: '外观', exact: true }).click()
          assert.equal(await page.getByRole('button', { name: '让 AI 帮我配置', exact: true }).count(), 0)
          assert.equal(await page.getByRole('region', { name: '数据同步', exact: true }).count(), 0)
          await mkdir(resolve(ROOT, '.pack'), { recursive: true })
          await page.screenshot({ path: resolve(ROOT, '.pack/dev-sync-disabled.png') })
          assert.deepEqual(errors, [])
        } finally {
          await browser.close()
        }
      },
    )
    await assert.rejects(readFile(resolve(sandbox.home, 'nook-sync/settings.json')), { code: 'ENOENT' })
  },
)
