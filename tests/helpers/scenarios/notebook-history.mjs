import assert from 'node:assert/strict'

import {
  waitForNoteSave,
  verifySavedNotebook,
  createNotebookNote,
  initialMarkdown,
  initialSavedMarkdown,
} from '../browser/notebook.mjs'
export async function notebookHistory(page, { screenshot } = {}) {
  const { workspace, suffix, title } = await createNotebookNote(page, { pinned: true })
  await workspace
    .getByRole('textbox', { name: '笔记正文', exact: true })
    .fill('左窗口补充。\n' + initialMarkdown + '\n右窗口补充。')
  await waitForNoteSave(page)
  const noteActions = workspace.getByRole('button', { name: '笔记操作', exact: true })
  await noteActions.focus()
  await page.keyboard.press('Enter')
  await workspace.getByRole('menu').waitFor()
  await workspace.getByRole('menuitem', { name: '历史版本', exact: true }).waitFor()
  await workspace.getByRole('menuitem', { name: '导出', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await workspace.getByRole('menu').waitFor({ state: 'hidden' })
  await noteActions.click()
  await workspace.getByRole('menuitem', { name: '历史版本', exact: true }).click()
  const history = workspace.getByRole('dialog', { name: '笔记历史', exact: true })
  await history.waitFor()
  const versions = history.locator('.nook-history-version:visible')
  await versions.first().waitFor()
  const details = history.locator('.nook-history-details')
  assert.ok((await details.count()) > 0, 'Continuous saves are grouped by default')
  const collapsedCount = await versions.count()
  for (const summary of await details.locator('summary').all()) await summary.click()
  assert.ok((await versions.count()) > collapsedCount, 'Expanding reveals individual saved versions')
  let foundOriginal = false
  for (let index = 0; index < (await versions.count()); index++) {
    await versions.nth(index).click()
    await history.locator('.nook-history-content').first().waitFor()
    const content = await history.locator('.nook-history-content').first().innerText()
    const historicalTitle = await history.locator('.nook-history-comparison h4').first().innerText()
    if (historicalTitle === title && content.includes('劳动异化') && !content.includes('窗口补充')) {
      foundOriginal = true
      break
    }
  }
  assert.ok(foundOriginal, 'Original saved content is available in note history')
  if (screenshot) await page.screenshot({ path: screenshot.replace(/\.png$/, '-history.png') })
  if (process.env.NOOK_NOTE_HISTORY_SCREENSHOT)
    await page.screenshot({ path: process.env.NOOK_NOTE_HISTORY_SCREENSHOT })
  const historyViewport = page.viewportSize()
  await page.setViewportSize({ width: 600, height: 850 })
  assert.ok(
    await history.evaluate(element => element.scrollWidth <= element.clientWidth + 1),
    'Note history fits a narrow viewport',
  )
  await page.setViewportSize(historyViewport)
  await history.getByRole('button', { name: '恢复此版本', exact: true }).click()
  await history.waitFor({ state: 'hidden' })
  await noteActions.click()
  await workspace.getByRole('menuitem', { name: '历史版本', exact: true }).click()
  await history.waitFor()
  await history.locator('.nook-history-stage').first().getByText('恢复版本 · 当前版本', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await history.waitFor({ state: 'hidden' })
  const restoredPin = workspace.getByRole('button', { name: '置顶', exact: true })
  if (await restoredPin.count()) {
    await restoredPin.click()
    await waitForNoteSave(page)
  }
  assert.ok(!(await workspace.getByRole('textbox', { name: '笔记正文', exact: true }).innerText()).includes('窗口补充'))

  await verifySavedNotebook(
    new URL(page.url()).origin,
    { title, markdown: initialSavedMarkdown, trash: false },
    await page.context().cookies(),
  )
}
