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

for (const key of ['Backspace', 'Delete']) {
  test(`${key} on an empty middle list item keeps subsequent numbering continuous`, { timeout: 180_000 }, async t => {
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
          const page = await browser.newPage()
          const errors: string[] = []
          page.on('pageerror', (error: Error) => errors.push(error.message))
          await page.goto(url)
          const workspace = page.getByRole('dialog', { name: 'Nook 笔记工作区', exact: true })
          await workspace.waitFor()
          await dismissOnboarding(page)
          await workspace.getByRole('button', { name: '写一条笔记', exact: true }).click()
          const body = page.getByRole('textbox', { name: '笔记正文', exact: true })
          await body.click()
          await page.keyboard.type('1. aaa', { delay: 40 })
          await page.keyboard.press('Enter')
          await page.keyboard.type('bbb')
          await page.keyboard.press('Enter')
          await page.keyboard.type('ccc')

          // 从 ccc 末尾回到 bbb 末尾，清空文字，再按一次退格。
          await page.keyboard.press('ArrowUp')
          for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace')
          assert.deepEqual(await body.locator('ol > li').allTextContents(), ['aaa', '', 'ccc'])
          await page.keyboard.press(key)
          assert.equal(await body.locator('ol').count(), 1)
          assert.deepEqual(await body.locator('ol > li').allTextContents(), ['aaa', 'ccc'])
          assert.equal(await body.locator(':scope > p:not(:last-child)').count(), 0)

          // 工具栏撤销只恢复这次结构删除，重做再次移除空项。
          await workspace.getByRole('button', { name: '撤销', exact: true }).click()
          assert.deepEqual(await body.locator('ol > li').allTextContents(), ['aaa', '', 'ccc'])
          await workspace.getByRole('button', { name: '重做', exact: true }).click()
          assert.deepEqual(await body.locator('ol > li').allTextContents(), ['aaa', 'ccc'])

          // 自动保存与 Markdown 重载之后仍为同一有序列表。
          await page.waitForTimeout(1500)
          await workspace.getByRole('button', { name: '未分类', exact: true }).click()
          await page.locator('.nook-note-card', { hasText: 'aaa' }).first().click()
          await body.locator('ol > li').nth(1).waitFor()
          assert.equal(await body.locator('ol').count(), 1)
          assert.deepEqual(await body.locator('ol > li').allTextContents(), ['aaa', 'ccc'])
          assert.deepEqual(errors, [])
        } finally {
          await browser.close()
        }
      },
    })
  })
}
