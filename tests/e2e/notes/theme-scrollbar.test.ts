import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { createDevSandbox } from '../../../scripts/profile/dev-sandbox.mjs'
import { seedDevData } from '../../../scripts/profile/dev-seed.mjs'
import { withWebRuntime } from '../../helpers/runtime/web.mjs'
import { dismissOnboarding, verifyThemedScrollbar, renderedAppearance } from '../../helpers/browser/notebook.mjs'
import { ROOT, dshBin } from '../../../scripts/profile/profile-lib.mjs'

const require = createRequire(import.meta.url)
const { chromium } = createRequire(require.resolve('dsh-browser-playwright/playwright'))('playwright-core')

test('every appearance themes Nook scrollbars with its own narrow light thumb', { timeout: 180_000 }, async t => {
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
        const workspace = page.getByRole('dialog', { name: 'Nook 笔记工作区', exact: true })
        await workspace.waitFor()
        await dismissOnboarding(page)
        await workspace.getByRole('button', { name: '设置', exact: true }).click()
        const settings = workspace.getByRole('dialog', { name: '设置', exact: true })
        await settings.waitFor()

        const seen = new Set<string>()
        const appearances = new Set<string>()
        let gutters = 0
        for (const [name, theme] of [
          ['Claude 暖纸', 'claude'],
          ['夜晚', 'night'],
          ['Nook 纸感', 'paper'],
          ['孟菲斯', 'memphis'],
        ]) {
          await settings.getByRole('button', { name: new RegExp(name) }).click()
          const scrollbar = await verifyThemedScrollbar(page, theme, name)
          seen.add(scrollbar.thumb)
          if (scrollbar.gutter > 0) gutters++
          appearances.add(JSON.stringify(await renderedAppearance(page)))
        }
        assert.equal(seen.size, 4, 'Each appearance renders a distinct scrollbar thumb')
        assert.equal(appearances.size, 4, 'Each appearance changes the rendered workspace')
        assert.ok([0, 4].includes(gutters), 'Either every themed gutter narrows or the engine overlays scrollbars')
        assert.deepEqual(errors, [])
      } finally {
        await browser.close()
      }
    },
  )
})
