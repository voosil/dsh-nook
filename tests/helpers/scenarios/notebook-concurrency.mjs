import assert from 'node:assert/strict'

import { dismissOnboarding, waitForNoteSave, createNotebookNote } from '../browser/notebook.mjs'
export async function notebookConcurrency(page) {
  const { workspace, suffix, title } = await createNotebookNote(page)
  // Both browser saves start from the same version; Host merging must be invisible.
  const secondContext = await page
    .context()
    .browser()
    .newContext({ storageState: await page.context().storageState() })
  const secondWindow = await secondContext.newPage()
  try {
    await secondWindow.goto(new URL('/#nook', page.url()).href)
    const otherWorkspace = secondWindow.getByRole('dialog', { name: 'Nook 笔记工作区', exact: true })
    await otherWorkspace.waitFor()
    await dismissOnboarding(secondWindow)
    await otherWorkspace.getByRole('searchbox', { name: '搜索笔记' }).fill(suffix)
    await otherWorkspace.locator('.nook-note-card').filter({ hasText: title }).click()
    await otherWorkspace.getByRole('textbox', { name: '笔记正文', exact: true }).waitFor()
    await workspace
      .getByRole('textbox', { name: '笔记正文', exact: true })
      .fill('左窗口补充。\n劳动异化与自由实践：今天学习了新的概念。\n保留完整的思考过程。')
    await otherWorkspace
      .getByRole('textbox', { name: '笔记正文', exact: true })
      .fill('劳动异化与自由实践：今天学习了新的概念。\n保留完整的思考过程。\n右窗口补充。')
    await waitForNoteSave(page)
    await waitForNoteSave(secondWindow)
  } finally {
    await secondContext.close()
  }
  await page.reload()
  await workspace.waitFor()
  await dismissOnboarding(page)
  await workspace.getByRole('searchbox', { name: '搜索笔记' }).fill(suffix)
  await workspace.locator('.nook-note-card').filter({ hasText: title }).click()
  const mergedBody = await workspace.getByRole('textbox', { name: '笔记正文', exact: true }).innerText()
  assert.ok(mergedBody.includes('左窗口补充。') && mergedBody.includes('右窗口补充。'), mergedBody)
  assert.ok(!(await workspace.innerText()).includes('有同步冲突'))
}
