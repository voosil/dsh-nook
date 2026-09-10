import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { startWebDav } from '../../tests/helpers/webdav.mjs'

const require = createRequire(import.meta.url)
const { chromium } = createRequire(require.resolve('dsh-browser-playwright/playwright'))('playwright-core')

/** Exercise the shipped Client against the actual Host, including packed installs. */
export async function notebookSmoke(url, screenshot, providedPage, verifySync = false) {
  const dav = verifySync ? await startWebDav() : undefined
  const browser = providedPage ? undefined : await chromium.launch({ channel: 'chrome', headless: true })
  const errors = []
  const page = providedPage ?? (await browser.newPage({ viewport: { width: 1440, height: 1000 } }))
  page.setDefaultTimeout(30_000)
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
    await workspace.getByRole('status').filter({ hasText: '已保存' }).waitFor()
    await workspace.getByRole('button', { name: '置顶', exact: true }).click()
    await workspace.getByRole('status').filter({ hasText: '已保存' }).waitFor()
    assert.ok((await workspace.innerText()).includes('创建于'))
    assert.ok((await workspace.innerText()).includes('更新于'))
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
      await workspace.getByRole('status').filter({ hasText: '已保存' }).waitFor()
      await otherWorkspace.getByRole('status').filter({ hasText: '已保存' }).waitFor()
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
    await workspace.getByRole('button', { name: '历史版本', exact: true }).click()
    const history = workspace.getByRole('dialog', { name: '笔记历史', exact: true })
    await history.waitFor()
    const versions = history.getByRole('navigation', { name: '历史版本列表' }).getByRole('button')
    await versions.first().waitFor()
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
    const restoredPin = workspace.getByRole('button', { name: '置顶', exact: true })
    if (await restoredPin.count()) {
      await restoredPin.click()
      await workspace.getByRole('status').filter({ hasText: '已保存' }).waitFor()
    }
    assert.ok(
      !(await workspace.getByRole('textbox', { name: '笔记正文', exact: true }).innerText()).includes('窗口补充'),
    )
    if (screenshot) await page.screenshot({ path: screenshot })
    if (process.env.NOOK_NOTE_SCREENSHOT) await page.screenshot({ path: process.env.NOOK_NOTE_SCREENSHOT })
    await page.reload()
    await workspace.waitFor()
    await dismissOnboarding(page)
    await workspace.getByRole('searchbox', { name: '搜索笔记' }).fill(suffix)
    await workspace.locator('.nook-note-card').filter({ hasText: title }).click()
    assert.equal(await workspace.getByRole('textbox', { name: '笔记标题', exact: true }).inputValue(), title)
    assert.ok(
      (await workspace.getByRole('textbox', { name: '笔记正文', exact: true }).innerText()).includes('劳动异化'),
    )
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
    await noteCard.click({ button: 'right' })
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
    await workspace.getByRole('button', { name: '恢复笔记', exact: true }).click()
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
    await workspace.getByRole('textbox', { name: '笔记正文', exact: true }).fill(draft + '删除项目后继续编辑。')
    await workspace.getByRole('status').filter({ hasText: '已保存' }).waitFor()
    await workspace.getByRole('button', { name: '未分类', exact: true }).click()
    await workspace.locator('.nook-note-card').filter({ hasText: title }).click()
    assert.equal(await workspace.getByRole('combobox', { name: '笔记所属项目' }).innerText(), '未分类')
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
    if (dav) {
      await workspace.getByRole('button', { name: /数据同步/ }).click()
      const sync = workspace.getByRole('dialog', { name: '数据同步', exact: true })
      assert.equal(await sync.getByRole('tab', { name: '同步信息', exact: true }).getAttribute('aria-selected'), 'true')
      assert.equal(await sync.getByRole('link', { name: '配置指南' }).count(), 0)
      assert.equal(await sync.getByLabel('WebDAV 同步目录').isVisible(), false)
      const information = sync.getByRole('tabpanel', { name: '同步信息', exact: true })
      await information.getByRole('button', { name: '去配置', exact: true }).waitFor()
      assert.equal(await information.getByRole('button').count(), 1)
      if (process.env.NOOK_SYNC_SETTINGS_SCREENSHOT)
        await page.screenshot({ path: process.env.NOOK_SYNC_SETTINGS_SCREENSHOT })
      await information.getByRole('button', { name: '去配置', exact: true }).click()
      await workspace.waitFor({ state: 'hidden' })
      const initialComposer = page
        .locator('[contenteditable="true"]')
        .filter({ hasText: '请协助我配置 Nook 数据同步。' })
      await initialComposer.waitFor()
      const initialPrompt = await initialComposer.innerText()
      await page.getByRole('button', { name: '打开 Nook', exact: true }).click()
      await workspace.waitFor()
      await workspace.getByRole('button', { name: /数据同步/ }).click()
      const syncFrame = await sync.boundingBox()
      await sync.getByRole('tab', { name: '同步信息', exact: true }).focus()
      await page.keyboard.press('ArrowRight')
      assert.equal(await sync.getByRole('tab', { name: '配置', exact: true }).getAttribute('aria-selected'), 'true')
      assert.deepEqual(await sync.boundingBox(), syncFrame, 'Switching tabs must preserve the dialog frame')
      await sync.getByLabel('WebDAV 同步目录').fill(dav.url)
      assert.equal(await sync.locator('.nook-sync-guide-body').count(), 0)
      if (process.env.NOOK_SYNC_CONFIG_SCREENSHOT) {
        await page.screenshot({ path: process.env.NOOK_SYNC_CONFIG_SCREENSHOT })
        const viewport = page.viewportSize()
        await page.setViewportSize({ width: 390, height: 720 })
        const narrow = await sync.boundingBox()
        assert.ok(narrow.x >= 0 && narrow.y >= 0 && narrow.x + narrow.width <= 390 && narrow.y + narrow.height <= 720)
        await page.screenshot({ path: process.env.NOOK_SYNC_CONFIG_SCREENSHOT.replace('.png', '-narrow.png') })
        await page.setViewportSize(viewport)
      }
      await sync.getByRole('link', { name: '配置指南' }).click()
      const guide = workspace.getByRole('region', { name: '同步配置指南' })
      await guide.waitFor()
      await sync.waitFor({ state: 'hidden' })
      assert.equal(new URL(page.url()).hash, '#nook-sync-guide')
      await guide.getByRole('heading', { name: '配置同步', exact: true }).waitFor()
      await guide.getByText('查看提示词', { exact: true }).click()
      const configurationPrompt = await guide.getByLabel('同步配置提示词', { exact: true }).inputValue()
      const normalizeParagraphs = text => text.trim().replace(/\n+/g, '\n')
      assert.equal(normalizeParagraphs(initialPrompt), normalizeParagraphs(configurationPrompt))
      assert.ok(configurationPrompt.startsWith('请协助我配置 Nook 数据同步。'))
      assert.ok(configurationPrompt.includes('/releases/download/sync-assistant-v'))
      assert.ok(configurationPrompt.includes('助手 SHA-256：'))
      assert.ok(configurationPrompt.includes('## 连接已有服务'))
      assert.ok(configurationPrompt.includes('## 故障排查'))
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: async () => {
              throw new Error('clipboard denied')
            },
          },
        })
      })
      await guide.getByText('查看提示词', { exact: true }).click()
      await guide.getByRole('button', { name: '复制提示词', exact: true }).click()
      await guide.getByRole('alert').filter({ hasText: '无法访问剪贴板' }).waitFor()
      await guide.getByLabel('同步配置提示词', { exact: true }).waitFor({ state: 'visible' })
      assert.equal(await guide.getByLabel('同步配置提示词', { exact: true }).inputValue(), configurationPrompt)
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: async text => {
              window.__nookCopiedPrompt = text
            },
          },
        })
      })
      await guide.getByRole('button', { name: '复制提示词', exact: true }).click()
      await guide.getByRole('button', { name: '已复制提示词', exact: true }).waitFor()
      assert.equal(await page.evaluate(() => window.__nookCopiedPrompt), configurationPrompt)
      await page.evaluate(() => {
        delete navigator.clipboard
        delete window.__nookCopiedPrompt
      })
      await guide.getByText('手动配置', { exact: true }).click()
      await guide.getByText('查看安装命令', { exact: true }).click()
      const assistantCommand = await guide.getByLabel('服务器安装命令', { exact: true }).inputValue()
      assert.ok(assistantCommand.startsWith("bash -c '"))
      assert.ok(assistantCommand.includes('/releases/download/sync-assistant-v'))
      assert.ok(assistantCommand.includes('sha256sum -c'))
      await guide.getByText('查看安装命令', { exact: true }).click()
      await guide.getByText('手动部署、其他网络环境与 NAS', { exact: true }).click()
      await guide.getByRole('heading', { name: 'Linux 服务器一键配置', exact: true }).waitFor()
      await guide.getByRole('heading', { name: 'Docker / Compose 部署', exact: true }).waitFor()
      const deployment = guide.getByRole('link', { name: '下载 Docker 部署包', exact: true })
      assert.equal(await deployment.getAttribute('download'), 'nook-sync-0.1.0.tar.gz')
      assert.ok((await deployment.getAttribute('href')).startsWith('data:application/gzip;base64,'))
      assert.ok(
        await guide
          .locator('article p')
          .first()
          .evaluate(element => parseFloat(getComputedStyle(element).fontSize) >= 14),
        'Guide paragraphs must not inherit the navigation footer font size',
      )
      await guide.getByText('查看完整的一行命令', { exact: true }).click()
      const command = await guide.getByLabel('一键配置命令').inputValue()
      assert.ok(command.startsWith("sudo python3 -c '"))
      assert.ok(!command.includes('\n'))
      await guide.getByText('查看完整的一行命令', { exact: true }).click()
      if (process.env.NOOK_SYNC_GUIDE_SCREENSHOT) {
        await guide.getByText('手动部署、其他网络环境与 NAS', { exact: true }).click()
        await guide.evaluate(element => {
          element.scrollTop = 0
        })
        await page.screenshot({ path: process.env.NOOK_SYNC_GUIDE_SCREENSHOT })
      }
      const previousViewport = page.viewportSize()
      await page.setViewportSize({ width: 720, height: 900 })
      assert.ok(
        await guide.evaluate(element => element.scrollWidth <= element.clientWidth + 1),
        'Guide page must fit a narrow viewport',
      )
      await page.setViewportSize(previousViewport)
      await guide.getByRole('button', { name: '返回数据同步' }).click()
      await sync.waitFor()
      await guide.waitFor({ state: 'hidden' })
      assert.equal(await sync.getByLabel('WebDAV 同步目录').inputValue(), dav.url)
      const input = sync.getByLabel('连接配置文件', { exact: true })
      await input.setInputFiles({
        name: 'invalid.json',
        mimeType: 'application/json',
        buffer: Buffer.from('{"password":"private-input"'),
      })
      await sync.getByRole('alert').filter({ hasText: '连接信息无效' }).waitFor()
      assert.equal(await sync.getByLabel('WebDAV 同步目录').inputValue(), dav.url)
      assert.ok(!(await sync.innerText()).includes('private-input'))
      const connection = {
        format: 'nook-sync-connection',
        version: 1,
        url: dav.url,
        username: 'tester',
        password: 'secret',
        caCert: '',
      }
      await input.setInputFiles({
        name: 'connection.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(connection)),
      })
      await sync.getByText('连接信息已导入', { exact: true }).waitFor()
      assert.equal(await sync.getByLabel('存储用户名').inputValue(), 'tester')
      assert.equal(await sync.getByLabel('存储密码或应用令牌').inputValue(), 'secret')
      assert.equal(await sync.getByLabel('服务器 CA 证书（可选）').inputValue(), '')
      assert.equal(dav.data.size, 0, 'Import must not contact the remote or enable sync')
      await sync.getByRole('button', { name: '使用其他连接信息' }).click()
      await sync
        .getByLabel('粘贴连接信息', { exact: true })
        .fill('NOOK-SYNC-1:' + Buffer.from(JSON.stringify(connection)).toString('base64'))
      await sync.getByText('连接信息已导入', { exact: true }).waitFor()
      assert.equal(await sync.getByLabel('粘贴连接信息', { exact: true }).count(), 0)
      assert.equal(dav.data.size, 0, 'Pasting connection information must not contact the server')
      if (process.env.NOOK_SYNC_IMPORT_SCREENSHOT)
        await page.screenshot({ path: process.env.NOOK_SYNC_IMPORT_SCREENSHOT })
      await sync.getByRole('button', { name: '验证并开启同步', exact: true }).click()
      await sync.getByRole('status').filter({ hasText: '已同步' }).waitFor({ timeout: 30000 })
      assert.ok([...dav.data.keys()].some(path => path.endsWith('/index.json')))
      assert.equal(await sync.getByRole('tab', { name: '同步信息', exact: true }).getAttribute('aria-selected'), 'true')
      assert.equal(await sync.getByRole('link', { name: '配置指南' }).count(), 0)
      assert.ok((await information.innerText()).includes(dav.url))
      await sync.getByRole('tab', { name: '配置', exact: true }).click()
      assert.equal(await sync.getByLabel('存储密码或应用令牌').inputValue(), '')
      await sync.getByLabel('WebDAV 同步目录').fill('https://unsaved.invalid/nook/')
      await sync.getByRole('tab', { name: '同步信息', exact: true }).click()
      await sync.getByRole('button', { name: '关闭同步', exact: true }).click()
      await sync.getByRole('status').filter({ hasText: '同步未开启' }).waitFor()
      assert.ok((await information.innerText()).includes(dav.url))
      await information.getByRole('button', { name: '开启同步', exact: true }).click()
      await sync.getByRole('status').filter({ hasText: '已同步' }).waitFor()
      await sync.getByRole('button', { name: '关闭同步设置', exact: true }).click()
      await workspace.getByRole('button', { name: /数据同步/ }).click()
      assert.equal(await sync.getByRole('tab', { name: '同步信息', exact: true }).getAttribute('aria-selected'), 'true')
      await sync.getByRole('tab', { name: '配置', exact: true }).click()
      assert.equal(await sync.getByLabel('WebDAV 同步目录').inputValue(), dav.url)
      await sync.getByRole('link', { name: '配置指南' }).click()
      await guide.getByRole('button', { name: '让 AI 帮我配置', exact: true }).click()
      await workspace.waitFor({ state: 'hidden' })
      const composer = page.locator('[contenteditable="true"]').filter({ hasText: 'nook_sync_deployment_guide' })
      await composer.waitFor()
      assert.equal(normalizeParagraphs(await composer.innerText()), normalizeParagraphs(configurationPrompt))
    }
    assert.deepEqual(errors, [])
    return { title, errors }
  } catch (error) {
    await page.screenshot({ path: '/tmp/nook-smoke-failure.png' }).catch(() => {})
    throw error
  } finally {
    page.off('pageerror', onError)
    await browser?.close()
    await dav?.close()
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
