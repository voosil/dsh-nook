import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { dismissOnboarding } from '../browser/notebook.mjs'
import { withNotebookPage } from '../browser/page.mjs'
async function createTask(page, expectUnconfigured = false) {
  const title = '任务系统端到端验收 ' + randomUUID().slice(0, 8)
  await page.getByRole('button', { name: '任务与日程', exact: true }).click()
  if (expectUnconfigured) await page.getByText('需要你的一点判断', { exact: true }).waitFor()
  await page.getByRole('button', { name: '任务设置', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '任务设置', exact: true })
  const enable = settings.getByRole('button', { name: '使用这台设备执行', exact: true })
  if (await enable.count()) await enable.click()
  else await settings.getByText('这台设备负责后台执行', { exact: true }).waitFor()
  await settings.getByRole('button', { name: '保存设置', exact: true }).click()
  await settings.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '＋ 新建任务', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '新建任务', exact: true })
  await editor.getByLabel('任务名称', { exact: true }).fill(title)
  await editor.getByLabel('希望完成什么', { exact: true }).fill('手动建立任务，检查日历与完成流程。')
  await editor.getByRole('button', { name: '保存任务', exact: true }).click()
  await editor.waitFor({ state: 'hidden' })

  return title
}
export async function taskCalendar(page) {
  const title = await createTask(page, true)
  await page
    .getByRole('button', { name: new RegExp(title) })
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
    .getByRole('button', { name: new RegExp(title) })
    .first()
    .waitFor()
  await page.screenshot({ path: join(tmpdir(), 'nook-tasks-calendar.png') })
}
export async function taskCompletion(page) {
  const title = await createTask(page)
  await page.getByRole('button', { name: '计划与清单', exact: true }).click()
  await page.getByRole('button', { name: '完成 ' + title, exact: true }).click()
  await page
    .getByRole('button', { name: new RegExp(title) })
    .first()
    .getByText(/已完成/)
    .waitFor()
  await page.reload()
  await dismissOnboarding(page)
  await page.getByRole('button', { name: '计划与清单', exact: true }).click()
  await page
    .getByRole('button', { name: new RegExp(title) })
    .first()
    .getByText(/已完成/)
    .waitFor()
  await page.getByRole('button', { name: '＋ 新建任务', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: '新建任务', exact: true }).waitFor({ state: 'hidden' })
}
export const taskScenarios = [
  ['task calendar scheduling', taskCalendar],
  ['task completion survives reload', taskCompletion],
]
export async function runTaskAcceptance(t, { url }) {
  for (const [name, scenario] of taskScenarios) {
    let finished = false
    await t.test(name, { timeout: 120_000 }, async () => {
      await withNotebookPage(url, scenario, { name })
      finished = true
    })
    if (!finished) throw new Error('Task scenario failed: ' + name)
  }
}
