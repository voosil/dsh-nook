import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { verifySavedNotebook, createNotebookNote, initialSavedMarkdown } from '../browser/notebook.mjs'
import { startWebDav } from '../services/webdav.mjs'
import { verifySyncTransfer } from './notebook-outcomes.mjs'
export async function notebookSync(page, { profileDirectory, node } = {}) {
  const { workspace, title } = await createNotebookNote(page)
  const expected = { title, markdown: initialSavedMarkdown, trash: true }
  await workspace.locator('.nook-note-card').filter({ hasText: title }).click({ button: 'right' })
  await workspace.getByRole('menuitem', { name: '删除', exact: true }).click()
  const dav = await startWebDav()
  try {
    await workspace.getByRole('button', { name: '设置', exact: true }).click()
    await workspace.getByRole('button', { name: '数据同步', exact: true }).click()
    const sync = workspace.getByRole('dialog', { name: '设置', exact: true })
    assert.equal(await sync.getByRole('tab', { name: '同步信息', exact: true }).getAttribute('aria-selected'), 'true')
    assert.equal(await sync.getByRole('link', { name: '配置指南' }).count(), 0)
    assert.equal(await sync.getByLabel('WebDAV 同步目录').isVisible(), false)
    const information = sync.getByRole('tabpanel', { name: '同步信息', exact: true })
    await information.getByRole('button', { name: '去配置', exact: true }).waitFor()
    if (process.env.NOOK_SYNC_SETTINGS_SCREENSHOT)
      await page.screenshot({ path: process.env.NOOK_SYNC_SETTINGS_SCREENSHOT })
    await information.getByRole('button', { name: '去配置', exact: true }).click()
    await workspace.waitFor({ state: 'hidden' })
    const initialComposer = page.locator('[contenteditable="true"]').filter({ hasText: '请协助我配置 Nook 数据同步。' })
    await initialComposer.waitFor()
    await initialComposer.click()
    assert.ok(
      await initialComposer.evaluate(element => element.contains(document.activeElement)),
      'Hidden settings release the conversation focus',
    )
    const initialPrompt = await initialComposer.innerText()
    await page.getByRole('button', { name: '打开 Nook', exact: true }).click()
    await workspace.waitFor()
    await sync.waitFor()
    const syncFrame = await sync.boundingBox()
    await sync.getByRole('tab', { name: '同步信息', exact: true }).focus()
    await page.keyboard.press('ArrowRight')
    await sync.getByRole('tab', { name: '配置', exact: true, selected: true }).waitFor()
    assert.deepEqual(await sync.boundingBox(), syncFrame, 'Switching tabs must preserve the dialog frame')
    await sync.getByLabel('WebDAV 同步目录').fill(dav.url)
    assert.equal(await workspace.getByRole('region', { name: '同步配置指南' }).isVisible(), false)
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
    assert.ok(configurationPrompt.trim(), 'The configuration draft must contain instructions')
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
    assert.ok(assistantCommand.trim(), 'Manual installation instructions are available')
    await guide.getByText('查看安装命令', { exact: true }).click()
    await guide.getByText('手动部署、其他网络环境与 NAS', { exact: true }).click()
    await guide.getByRole('heading', { name: 'Linux 服务器一键配置', exact: true }).waitFor()
    await guide.getByRole('heading', { name: 'Docker / Compose 部署', exact: true }).waitFor()
    const deployment = guide.getByRole('link', { name: '下载 Docker 部署包', exact: true })
    const downloaded = page.waitForEvent('download')
    await deployment.click()
    const archive = await downloaded
    const tar = gunzipSync(await readFile(await archive.path()))
    assert.ok(tar.length >= 1024, 'The downloaded deployment archive must decompress to nonempty content')
    assert.ok(
      await guide
        .locator('article p')
        .first()
        .evaluate(element => parseFloat(getComputedStyle(element).fontSize) >= 14),
      'Guide paragraphs must not inherit the navigation footer font size',
    )
    await guide.getByText('查看完整的一行命令', { exact: true }).click()
    const command = await guide.getByLabel('一键配置命令').inputValue()
    assert.ok(command.trim() && !command.includes('\n'), 'The one-line instructions must be copyable as one line')
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
    assert.equal(dav.connections(), 0, 'Import must not contact the remote or enable sync')
    await sync.getByRole('button', { name: '使用其他连接信息' }).click()
    await sync
      .getByLabel('粘贴连接信息', { exact: true })
      .fill('NOOK-SYNC-1:' + Buffer.from(JSON.stringify(connection)).toString('base64'))
    await sync.getByText('连接信息已导入', { exact: true }).waitFor()
    assert.equal(await sync.getByLabel('粘贴连接信息', { exact: true }).count(), 0)
    assert.equal(dav.connections(), 0, 'Pasting connection information must not contact the server')
    if (process.env.NOOK_SYNC_IMPORT_SCREENSHOT)
      await page.screenshot({ path: process.env.NOOK_SYNC_IMPORT_SCREENSHOT })
    await sync.getByRole('button', { name: '验证并开启同步', exact: true }).click()
    await sync.getByRole('status').filter({ hasText: '已同步' }).waitFor({ timeout: 30000 })
    await verifySyncTransfer({ url: dav.url, username: 'tester', password: 'secret' }, expected, {
      profileDirectory,
      node,
    })
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
    await sync.getByRole('button', { name: '关闭设置', exact: true }).click()
    await workspace.getByRole('button', { name: '设置', exact: true }).click()
    await workspace.getByRole('button', { name: '数据同步', exact: true }).click()
    assert.equal(await sync.getByRole('tab', { name: '同步信息', exact: true }).getAttribute('aria-selected'), 'true')
    await sync.getByRole('tab', { name: '配置', exact: true }).click()
    assert.equal(await sync.getByLabel('WebDAV 同步目录').inputValue(), dav.url)
    await sync.getByRole('link', { name: '配置指南' }).click()
    await guide.getByRole('button', { name: '让 AI 帮我配置', exact: true }).click()
    await workspace.waitFor({ state: 'hidden' })
    const composer = page.locator('[contenteditable="true"]').filter({ hasText: '请协助我配置 Nook 数据同步。' })
    await composer.waitFor()
    assert.equal(normalizeParagraphs(await composer.innerText()), normalizeParagraphs(configurationPrompt))

    await verifySavedNotebook(new URL(page.url()).origin, expected, await page.context().cookies())
  } finally {
    await dav.close()
  }
}
