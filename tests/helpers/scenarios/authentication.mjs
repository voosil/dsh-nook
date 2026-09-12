import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dismissOnboarding } from '../browser/notebook.mjs'
import { prepareWorkspace } from '../runtime/workspace.mjs'
const require = createRequire(import.meta.url)
const { chromium } = createRequire(require.resolve('dsh-browser-playwright/playwright'))('playwright-core')
export async function verifySafeUi(url, { profileDirectory }) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage()
    const errors = []
    const onError = error => errors.push(error.message)
    page.on('pageerror', onError)
    try {
      await page.goto(url)
      await dismissOnboarding(page)
      const workspace = await prepareWorkspace(page, profileDirectory)
      await page.reload()
      await dismissOnboarding(page)
      await page.getByRole('button', { name: '新建会话', exact: true }).first().click()
      await page.getByRole('button', { name: '选择工作区', exact: true }).click()
      await page.getByRole('menuitem', { name: workspace.title, exact: true }).click()
      await dismissOnboarding(page)
      const composer = page.locator('[contenteditable="true"]').first()
      await composer.pressSequentially('Safe UI 验收草稿')
      assert.equal(await composer.innerText(), 'Safe UI 验收草稿')
      assert.equal(await page.getByRole('button', { name: '打开 Nook', exact: true }).count(), 0)
      assert.equal(await page.getByRole('dialog', { name: 'Nook 笔记工作区', exact: true }).count(), 0)
      assert.deepEqual(errors, [])
    } catch (error) {
      console.error(await page.locator('body').innerText())
      throw error
    } finally {
      page.off('pageerror', onError)
    }
  } finally {
    await browser.close()
  }
}

export async function verifyAuthentication(launchUrl) {
  const url = new URL(launchUrl).origin
  const unauthenticated = await fetch(url, { signal: AbortSignal.timeout(5000) })
  await unauthenticated.body?.cancel()
  assert.equal(unauthenticated.status, 401)
  const exchange = await fetch(launchUrl, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
  const cookie = exchange.headers.get('set-cookie')?.split(';', 1)[0]
  await exchange.body?.cancel()
  assert.equal(exchange.status, 303)
  assert.ok(cookie, 'Launch token establishes an authenticated cookie')
  const response = await fetch(url, { headers: { cookie }, signal: AbortSignal.timeout(5000) })
  await response.body?.cancel()
  assert.equal(response.status, 200)
  return { url, status: response.status }
}
