import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { createDevSandbox } from '../../scripts/profile/dev-sandbox.mjs'
import { seedDevData } from '../../scripts/profile/dev-seed.mjs'
import { bootAndVerifyWeb } from '../../scripts/verify/runtime-verify.mjs'
import { dismissOnboarding } from '../../scripts/verify/notebook-smoke.mjs'
import { ROOT, dshBin } from '../../scripts/profile/profile-lib.mjs'

const require = createRequire(import.meta.url)
const { chromium } = createRequire(require.resolve('dsh-browser-playwright/playwright'))('playwright-core')

test('trailing empty ordered list item stays editable across note switches', { timeout: 180_000 }, async t => {
  const sandbox = await createDevSandbox()
  t.after(() => sandbox.dispose())
  await seedDevData(sandbox.home)
  await bootAndVerifyWeb({
    bin: dshBin(),
    cwd: ROOT,
    env: { ...sandbox.env, NOOK_DEV_RUNTIME: '1' },
    acceptance: async (url: string) => {
      const browser = await chromium.launch({ channel: 'chrome', headless: true })
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
        const errors: string[] = []
        page.on('pageerror', (error: Error) => errors.push(error.message))
        await page.goto(url)
        const workspace = page.getByRole('dialog', { name: 'Nook 笔记工作区', exact: true })
        await workspace.waitFor()
        await dismissOnboarding(page)

        // 新建笔记，输入 "1. xxx" 后回车，TipTap 自动续出空序号项 "2."
        await workspace.getByRole('button', { name: '写一条笔记', exact: true }).click()
        const body = page.getByRole('textbox', { name: '笔记正文', exact: true })
        await body.click()
        await page.keyboard.type('1. ', { delay: 40 })
        await page.keyboard.type('xxx', { delay: 40 })
        await page.keyboard.press('Enter')
        await page.waitForTimeout(1500)

        // 切走再切回，触发笔记重新加载（markdown 往返）
        await workspace.getByRole('button', { name: '未分类', exact: true }).click()
        await page.locator('.nook-note-card', { hasText: 'xxx' }).first().click()
        const emptyItem = page.locator('ol li').nth(1)
        await emptyItem.waitFor()

        // 修复前：空 <li> 无可编辑内容，光标无法落入、无法输入、getMarkdown 崩溃
        await emptyItem.click()
        await page.keyboard.type('好', { delay: 40 })
        assert.equal(await page.locator('ol li').nth(0).textContent(), 'xxx')
        assert.equal(await page.locator('ol li').nth(1).textContent(), '好')

        // 保存后再次切走切回，内容不丢
        await page.waitForTimeout(1500)
        await workspace.getByRole('button', { name: '未分类', exact: true }).click()
        await page.locator('.nook-note-card', { hasText: 'xxx' }).first().click()
        await page.locator('ol li').nth(1).getByText('好', { exact: true }).waitFor()

        assert.deepEqual(errors, [])
      } finally {
        await browser.close()
      }
    },
  })
})
