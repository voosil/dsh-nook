import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { dismissOnboarding, waitForNoteSave, verifySavedNotebook } from '../browser/notebook.mjs'
export async function notebookLifecycle(page, { screenshot } = {}) {
  const workspace = page.getByRole('dialog', { name: 'Nook 笔记工作区', exact: true })
  const suffix = Date.now().toString(36)
  const title = `Nook 验收 ${suffix}`
  let project = `验收项目 ${suffix}`
  await workspace.getByRole('button', { name: '新建项目', exact: true }).click()
  await workspace.getByLabel('项目名称', { exact: true }).fill(project)
  await workspace.getByLabel('描述', { exact: true }).fill('仅用于自动化验收')
  await workspace.getByRole('button', { name: '保存项目', exact: true }).click()
  await workspace.getByRole('button', { name: project, exact: true }).waitFor()
  const secondProject = `排序项目 ${suffix}`
  await workspace.getByRole('button', { name: '新建项目', exact: true }).click()
  await workspace.getByLabel('项目名称', { exact: true }).fill(secondProject)
  await workspace.getByRole('button', { name: '保存项目', exact: true }).click()
  const projectRow = name =>
    workspace.locator('.nook-project-row').filter({ has: page.getByRole('button', { name, exact: true }) })
  await projectRow(secondProject).waitFor()
  await projectRow(secondProject).dragTo(projectRow(project))
  await page.waitForFunction(
    ({ first, second }) => {
      const rows = [...document.querySelectorAll('.nook-project-row')].map(row => row.textContent)
      return rows.indexOf(first) >= 0 && rows.indexOf(first) < rows.indexOf(second)
    },
    { first: secondProject, second: project },
    { timeout: 30_000 },
  )
  await page.reload()
  await workspace.waitFor()
  await dismissOnboarding(page)
  await projectRow(project).waitFor()
  const orderedNames = await workspace.locator('.nook-project-row').allTextContents()
  assert.ok(orderedNames.indexOf(secondProject) < orderedNames.indexOf(project))
  await projectRow(project).hover()
  await workspace.getByRole('button', { name: `项目操作：${project}`, exact: true }).click()
  await workspace.getByRole('menuitem', { name: '编辑项目', exact: true }).click()
  project += ' 改名'
  await workspace.getByLabel('项目名称', { exact: true }).fill(project)
  await workspace.getByLabel('描述', { exact: true }).fill('更新后的项目描述')
  await workspace.getByRole('button', { name: '保存项目', exact: true }).click()
  await projectRow(project).waitFor()
  await projectRow(secondProject).click({ button: 'right' })
  await workspace.getByRole('menuitem', { name: '删除项目', exact: true }).click()
  await workspace
    .getByRole('alertdialog', { name: '删除项目' })
    .getByRole('button', { name: '删除项目', exact: true })
    .click()
  await projectRow(secondProject).waitFor({ state: 'hidden' })

  await workspace
    .getByRole('button', { name: /写一条笔记/ })
    .first()
    .click()
  await workspace.getByRole('textbox', { name: '笔记标题', exact: true }).fill(title)
  await workspace
    .getByRole('textbox', { name: '笔记正文', exact: true })
    .fill('劳动异化与自由实践：今天学习了新的概念。\n保留完整的思考过程。')
  await workspace.getByRole('combobox', { name: '笔记所属项目' }).click()
  await workspace.getByRole('option', { name: project, exact: true }).click()
  await waitForNoteSave(page)
  await workspace.getByRole('button', { name: '置顶', exact: true }).click()
  await waitForNoteSave(page)
  await workspace.getByRole('button', { name: '已置顶', exact: true }).click()
  await waitForNoteSave(page)
  await workspace.getByRole('button', { name: '置顶', exact: true }).click()
  await waitForNoteSave(page)
  assert.ok((await workspace.innerText()).includes('创建于'))
  assert.ok((await workspace.innerText()).includes('更新于'))
  await workspace.getByRole('searchbox', { name: '搜索笔记' }).fill(suffix)
  await workspace.getByRole('button', { name: '返回 AI 对话', exact: true }).click()
  await workspace.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '打开 Nook', exact: true }).click()
  await workspace.waitFor()
  assert.equal(await workspace.getByRole('textbox', { name: '笔记标题', exact: true }).inputValue(), title)
  assert.equal(await workspace.getByRole('searchbox', { name: '搜索笔记' }).inputValue(), suffix)

  const noteActions = workspace.getByRole('button', { name: '笔记操作', exact: true })
  if (screenshot) await page.screenshot({ path: screenshot })
  if (process.env.NOOK_NOTE_SCREENSHOT) await page.screenshot({ path: process.env.NOOK_NOTE_SCREENSHOT })
  await page.reload()
  await workspace.waitFor()
  await dismissOnboarding(page)
  await workspace.getByRole('searchbox', { name: '搜索笔记' }).fill(suffix)
  await workspace.locator('.nook-note-card').filter({ hasText: title }).click()
  assert.equal(await workspace.getByRole('textbox', { name: '笔记标题', exact: true }).inputValue(), title)
  assert.ok((await workspace.getByRole('textbox', { name: '笔记正文', exact: true }).innerText()).includes('劳动异化'))
  const noteCard = workspace.locator('.nook-note-card').filter({ hasText: title })
  const draft = '劳动异化：右键操作必须保留刚输入的正文。'
  await workspace.getByRole('textbox', { name: '笔记正文', exact: true }).fill(draft)
  await noteCard.click({ button: 'right' })
  await workspace.getByRole('menuitem', { name: '取消置顶', exact: true }).click()
  await workspace.getByRole('button', { name: '置顶', exact: true }).waitFor()
  assert.ok((await workspace.getByRole('textbox', { name: '笔记正文', exact: true }).innerText()).includes(draft))
  await noteCard.click({ button: 'right' })
  await workspace.getByRole('menuitem', { name: '置顶', exact: true }).click()
  await workspace.getByRole('button', { name: '已置顶', exact: true }).waitFor()
  await noteCard.click({ button: 'right' })
  await page.keyboard.press('Escape')
  await workspace.getByRole('menu').waitFor({ state: 'hidden' })
  await workspace.waitFor()
  const desktopExport = await page.evaluate(() => Boolean(window.nookDesktop))
  const download = desktopExport ? undefined : page.waitForEvent('download')
  await noteActions.click()
  await workspace.getByRole('menuitem', { name: '导出', exact: true }).click()
  await workspace.locator('.nui-toast').waitFor()
  if (download) {
    const file = await download
    assert.ok((await readFile(await file.path(), 'utf8')).includes(draft))
  } else await workspace.getByRole('button', { name: '打开文件夹', exact: true }).click()
  await workspace.getByRole('button', { name: '关闭导出提示', exact: true }).click()
  await noteCard.click({ button: 'right' })
  await workspace.getByRole('menuitem', { name: '删除', exact: true }).click()

  await workspace.getByRole('button', { name: '回收站', exact: true }).click()
  await workspace.locator('.nook-note-card').filter({ hasText: title }).click()
  await noteCard.click({ button: 'right' })
  await workspace.getByRole('menuitem', { name: '恢复笔记', exact: true }).click()
  await workspace.getByRole('button', { name: project, exact: true }).click()
  await noteCard.click()
  await projectRow(project).hover()
  await workspace.getByRole('button', { name: `项目操作：${project}`, exact: true }).click()
  await workspace.getByRole('menuitem', { name: '删除项目', exact: true }).click()
  await workspace
    .getByRole('alertdialog', { name: '删除项目' })
    .getByRole('button', { name: '删除项目', exact: true })
    .click()
  await workspace.getByRole('alertdialog', { name: '删除项目' }).waitFor({ state: 'hidden' })
  assert.equal(await workspace.getByRole('combobox', { name: '笔记所属项目' }).innerText(), '未分类')
  const markdown = draft + '删除项目后继续编辑。'
  const expected = { title, markdown, trash: true }
  await workspace.getByRole('textbox', { name: '笔记正文', exact: true }).fill(markdown)
  await waitForNoteSave(page)
  await workspace.getByRole('button', { name: '未分类', exact: true }).click()
  await workspace.locator('.nook-note-card').filter({ hasText: title }).click()
  assert.equal(await workspace.getByRole('combobox', { name: '笔记所属项目' }).innerText(), '未分类')
  await noteCard.click({ button: 'right' })
  await workspace.getByRole('menuitem', { name: '删除', exact: true }).click()
  await workspace.getByRole('button', { name: '工具市集', exact: true }).click()
  await workspace.getByRole('button', { name: '日 / 周总结', exact: true }).click()
  await workspace.getByRole('dialog', { name: '笔记总结', exact: true }).waitFor()
  await workspace
    .getByRole('dialog', { name: '笔记总结', exact: true })
    .getByRole('button', { name: '关闭', exact: true })
    .click()
  await workspace.getByRole('button', { name: '工具市集', exact: true }).click()
  await workspace.getByRole('button', { name: '视频转文稿', exact: true }).click()
  await workspace.getByRole('dialog', { name: '视频转文稿', exact: true }).waitFor()
  await workspace
    .getByRole('dialog', { name: '视频转文稿', exact: true })
    .getByRole('button', { name: '关闭', exact: true })
    .click()

  await verifySavedNotebook(new URL(page.url()).origin, expected, await page.context().cookies())
  return expected
}
