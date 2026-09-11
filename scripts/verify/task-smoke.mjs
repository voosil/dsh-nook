import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dismissOnboarding } from './notebook-smoke.mjs'
const require = createRequire(import.meta.url)
const { chromium } = createRequire(require.resolve('dsh-browser-playwright/playwright'))('playwright-core')
export async function taskSmoke(url) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true }),
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
    errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(15000)
  try {
    await page.goto(url)
    await dismissOnboarding(page)
    await page.getByRole('button', { name: '任务与日程', exact: true }).click()
    await page.getByText('需要你的一点判断', { exact: true }).waitFor()
    await page.getByRole('button', { name: '任务设置', exact: true }).click()
    const settings = page.getByRole('dialog', { name: '任务设置', exact: true })
    await settings.getByRole('button', { name: '使用这台设备执行', exact: true }).click()
    await settings.getByRole('button', { name: '保存设置', exact: true }).click()
    await settings.waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: '＋ 新建任务', exact: true }).click()
    const editor = page.getByRole('dialog', { name: '新建任务', exact: true })
    await editor.getByLabel('任务名称', { exact: true }).fill('任务系统端到端验收')
    await editor.getByLabel('希望完成什么', { exact: true }).fill('手动建立任务，检查日历与完成流程。')
    await editor.getByRole('button', { name: '保存任务', exact: true }).click()
    await editor.waitFor({ state: 'hidden' })
    await page
      .getByRole('button', { name: /任务系统端到端验收/ })
      .first()
      .click()
    await page.getByRole('button', { name: '编辑', exact: true }).click()
    const edit = page.getByRole('dialog', { name: '编辑任务', exact: true })
    await edit.getByText('时间与重复安排', { exact: true }).click()
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(9, 0, 0, 0)
    const local = new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    await edit.getByLabel('开始时间', { exact: true }).fill(local)
    await edit.getByRole('button', { name: '保存任务', exact: true }).click()
    await edit.waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: '日历与日程', exact: true }).click()
    await page
      .getByRole('button', { name: /任务系统端到端验收/ })
      .first()
      .waitFor()
    await page.screenshot({ path: '/tmp/nook-tasks-calendar.png' })
    await page.getByRole('button', { name: '计划与清单', exact: true }).click()
    await page.getByRole('button', { name: '完成 任务系统端到端验收', exact: true }).click()
    await page
      .getByRole('button', { name: /任务系统端到端验收/ })
      .first()
      .getByText(/已完成/)
      .waitFor()
    await page.getByRole('button', { name: '＋ 新建任务', exact: true }).click()
    await page.keyboard.press('Escape')
    await page.getByRole('dialog', { name: '新建任务', exact: true }).waitFor({ state: 'hidden' })
    assert.deepEqual(errors, [])
  } catch (error) {
    await page.screenshot({ path: '/tmp/nook-tasks-failure.png' }).catch(() => {})
    throw error
  } finally {
    await browser.close()
  }
}
