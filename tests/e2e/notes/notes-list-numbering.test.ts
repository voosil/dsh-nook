import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { createDevSandbox } from '../../../scripts/profile/dev-sandbox.mjs'
import { seedDevData } from '../../../scripts/profile/dev-seed.mjs'
import { withWebRuntime } from '../../helpers/runtime/web.mjs'
import { dismissOnboarding, waitForNoteSave } from '../../helpers/browser/notebook.mjs'
import { ROOT, dshBin } from '../../../scripts/profile/profile-lib.mjs'

const require = createRequire(import.meta.url)
const { chromium } = createRequire(require.resolve('dsh-browser-playwright/playwright'))('playwright-core')

test('nested ordered lists number levels as 1. → α. → ① → a)', { timeout: 180_000 }, async t => {
  const sandbox = await createDevSandbox()
  t.after(() => sandbox.dispose())
  await seedDevData(sandbox.home)
  await withWebRuntime(
    { bin: dshBin(), cwd: ROOT, env: { ...sandbox.env, NOOK_DEV_RUNTIME: '1' } },
    async (url: string) => {
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
        // Wait for the new note, rather than editing the previously selected
        // note while its asynchronous create request is still in flight.
        await page.waitForFunction(() => {
          const input = document.querySelector<HTMLInputElement>('input[aria-label="笔记标题"]')
          return input?.value === ''
        })
        const title = `列表编号验收 ${crypto.randomUUID()}`
        await workspace.getByRole('textbox', { name: '笔记标题', exact: true }).fill(title)
        const body = page.getByRole('textbox', { name: '笔记正文', exact: true })
        await body.click()

        // 逐层构造四层有序列表:回车续项,Tab 下钻一层。
        const ols = body.locator('ol')
        await body.pressSequentially('1. 一', { delay: 40 })
        await ols.first().waitFor()
        for (const [index, text] of ['二', '三', '四'].entries()) {
          await body.press('Enter')
          await body.press('Tab')
          await body.pressSequentially(text, { delay: 40 })
          await ols.nth(index + 1).waitFor()
        }
        assert.equal(await ols.count(), 4, `Rendered list after keyboard input: ${await body.innerHTML()}`)
        // 外层 li 的 textContent 含嵌套文本,直接断言各层 li 的首段文字。
        assert.deepEqual(await body.locator('ol > li > p').allTextContents(), ['一', '二', '三', '四'])

        const computedListStyle = (index: number) =>
          ols.nth(index).evaluate((element: Element) => getComputedStyle(element).listStyleType)
        assert.deepEqual(await Promise.all([0, 1, 2, 3].map(computedListStyle)), [
          'decimal',
          'lower-greek',
          'nook-list-circled',
          'nook-list-alpha-paren',
        ])

        // Chromium 对 ::marker 的 computed content 恒为 normal,marker 实际字形靠截图人工核验。
        await body.screenshot({ path: `${tmpdir()}/nook-list-numbering.png` })

        // 切走再切回,markdown 往返后嵌套结构与序号样式不变。
        await waitForNoteSave(page)
        await workspace.getByRole('button', { name: '未分类', exact: true }).click()
        await workspace.locator('.nook-note-card').filter({ hasText: title }).click()
        await ols.nth(3).waitFor()
        assert.equal(await ols.count(), 4)
        assert.deepEqual(await body.locator('ol > li > p').allTextContents(), ['一', '二', '三', '四'])
        assert.deepEqual(await Promise.all([0, 1, 2, 3].map(computedListStyle)), [
          'decimal',
          'lower-greek',
          'nook-list-circled',
          'nook-list-alpha-paren',
        ])
        assert.deepEqual(errors, [])
      } finally {
        await browser.close()
      }
    },
  )
})
