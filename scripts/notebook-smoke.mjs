import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = createRequire(require.resolve('dsh-browser-playwright/playwright'))('playwright-core')

/** Exercise the shipped Client against the actual Host, including packed installs. */
export async function notebookSmoke(url, screenshot, providedPage) {
  const browser = providedPage ? undefined : await chromium.launch({ channel: 'chrome', headless: true })
  const errors = []
  const page = providedPage ?? (await browser.newPage({ viewport: { width: 1440, height: 1000 } }))
  const onError = error => errors.push(error.message)
  try {
    page.on('pageerror', onError)
    await page.goto(url)
    const workspace = page.getByRole('dialog', { name: 'Nook 笔记工作区', exact: true })
    await workspace.waitFor()
    await dismissOnboarding(page)
    for (let attempt = 0; attempt < 2; attempt++) {
      await workspace.getByRole('button', { name: '返回 AI 对话', exact: true }).click()
      await workspace.waitFor({ state: 'hidden' })
      assert.equal(await page.getByRole('button', { name: '打开 Nook 笔记', exact: true }).count(), 0)
      const entry = page.getByRole('button', { name: '打开 Nook', exact: true })
      assert.equal(await entry.count(), 1)
      await entry.click()
      await workspace.waitFor()
    }
    const suffix = Date.now().toString(36)
    const title = `Nook 验收 ${suffix}`
    const project = `验收项目 ${suffix}`
    await workspace.getByRole('button', { name: '新建项目', exact: true }).click()
    await workspace.getByLabel('项目名称', { exact: true }).fill(project)
    await workspace.getByLabel('描述', { exact: true }).fill('仅用于自动化验收')
    await workspace.getByRole('button', { name: '保存项目', exact: true }).click()
    await workspace.getByRole('button', { name: project, exact: true }).waitFor()
    await workspace
      .getByRole('button', { name: /写一条笔记/ })
      .first()
      .click()
    await workspace.getByRole('textbox', { name: '笔记标题', exact: true }).fill(title)
    await workspace
      .getByRole('textbox', { name: '笔记正文', exact: true })
      .fill('劳动异化与自由实践：今天学习了新的概念。\n保留完整的思考过程。')
    await workspace.getByRole('combobox', { name: '笔记所属项目' }).selectOption({ label: project })
    await workspace.getByRole('status').filter({ hasText: '已保存' }).waitFor()
    await workspace.getByRole('button', { name: '置顶', exact: true }).click()
    await workspace.getByRole('status').filter({ hasText: '已保存' }).waitFor()
    assert.ok((await workspace.innerText()).includes('创建于'))
    assert.ok((await workspace.innerText()).includes('更新于'))
    if (screenshot) await page.screenshot({ path: screenshot })
    await page.reload()
    await workspace.waitFor()
    await dismissOnboarding(page)
    await workspace.getByRole('searchbox', { name: '搜索笔记' }).fill(suffix)
    await workspace.locator('.nook-note-card').filter({ hasText: title }).click()
    assert.equal(await workspace.getByRole('textbox', { name: '笔记标题', exact: true }).inputValue(), title)
    assert.ok(
      (await workspace.getByRole('textbox', { name: '笔记正文', exact: true }).innerText()).includes('劳动异化'),
    )
    await workspace.getByRole('button', { name: '移到回收站', exact: true }).click()
    await workspace.getByRole('button', { name: '回收站', exact: true }).click()
    await workspace.locator('.nook-note-card').filter({ hasText: title }).click()
    await workspace.getByRole('button', { name: '恢复笔记', exact: true }).click()
    await workspace.getByRole('button', { name: '项目', exact: true }).click()
    const card = workspace.locator('.nook-project-grid article').filter({ hasText: project })
    await card.getByRole('button', { name: '删除项目', exact: true }).click()
    await workspace
      .getByRole('alertdialog', { name: '删除项目' })
      .getByRole('button', { name: '删除项目', exact: true })
      .click()
    await workspace.getByRole('alertdialog', { name: '删除项目' }).waitFor({ state: 'hidden' })
    await workspace.getByRole('button', { name: '未分类', exact: true }).click()
    await workspace.locator('.nook-note-card').filter({ hasText: title }).click()
    assert.equal(await workspace.getByRole('combobox', { name: '笔记所属项目' }).inputValue(), '')
    await workspace.getByRole('button', { name: '移到回收站', exact: true }).click()
    await workspace.getByRole('button', { name: '日 / 周总结', exact: true }).click()
    await workspace.getByRole('dialog', { name: '笔记总结', exact: true }).waitFor()
    await workspace
      .getByRole('dialog', { name: '笔记总结', exact: true })
      .getByRole('button', { name: '关闭', exact: true })
      .click()
    await workspace.getByRole('button', { name: '视频转文稿', exact: true }).click()
    await workspace.getByRole('dialog', { name: '视频转文稿', exact: true }).waitFor()
    await workspace
      .getByRole('dialog', { name: '视频转文稿', exact: true })
      .getByRole('button', { name: '关闭', exact: true })
      .click()
    assert.deepEqual(errors, [])
    return { title, errors }
  } finally {
    page.off('pageerror', onError)
    await browser?.close()
  }
}

export async function dismissOnboarding(page) {
  for (const name of ['继续', '稍后配置']) {
    const button = page.getByRole('button', { name, exact: true })
    try {
      await button.waitFor({ timeout: 4000 })
      await button.click()
    } catch (error) {
      if (error.name !== 'TimeoutError') throw error
    }
  }
}
