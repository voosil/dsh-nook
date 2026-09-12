import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
const require = createRequire(import.meta.url)
const { chromium } = createRequire(require.resolve('dsh-browser-playwright/playwright'))('playwright-core')
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

/** Poll the authenticated Note read contract; do not flush the editor or inspect its draft implementation. */
export async function waitForNoteSave(page, { timeoutMs = 30_000 } = {}) {
  const workspace = page.getByRole('dialog', { name: 'Nook 笔记工作区', exact: true })
  const title = await workspace.getByRole('textbox', { name: '笔记标题', exact: true }).inputValue()
  const lines = (await workspace.getByRole('textbox', { name: '笔记正文', exact: true }).innerText())
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
  const pinned = await workspace.getByRole('button', { name: '已置顶', exact: true }).isVisible()
  const deadline = Date.now() + timeoutMs
  do {
    // HTTP envelope verified against pinned dsh-client-connection and api-gateway;
    // the payload/result are Nook's adapter-notes-dsh public list contract.
    const notes = await page.evaluate(async search => {
      const method = 'nookNotebookRpc/list'
      const response = await fetch(`/api/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(5000),
        body: JSON.stringify({
          type: 'client-request',
          rpcId: crypto.randomUUID(),
          method,
          payload: { args: { request: { search } } },
        }),
      })
      if (!response.ok) throw new Error(`Note read failed: HTTP ${response.status}`)
      const { result } = await response.json()
      if (!result.ok || !result.value.ok) throw new Error('The Host could not read saved notes')
      return result.value.value.notes
    }, title)
    // Concurrent edits may add other lines; every line entered here must reach
    // the Host. Exact final text is checked separately after reload/recovery.
    if (
      notes.some(
        note => note.title === title && note.pinned === pinned && lines.every(line => note.markdown.includes(line)),
      )
    )
      return
    await delay(100)
  } while (Date.now() < deadline)
  assert.fail('The edited note did not become readable from the Host before the autosave deadline')
}

/** Read rendered colors, independent of token names and theme attributes. */
export async function renderedAppearance(page) {
  return page.getByRole('dialog', { name: 'Nook 笔记工作区', exact: true }).evaluate(element => {
    const css = getComputedStyle(element)
    return { background: css.backgroundColor, text: css.color }
  })
}

/** Inspect the effective scrollbar and scrolling result, without reading CSS rules. */
export async function verifyThemedScrollbar(page, _theme, name) {
  const result = await page.getByRole('dialog', { name: 'Nook 笔记工作区', exact: true }).evaluate(workspace => {
    const containers = [...workspace.querySelectorAll('*')].filter(element => {
      const css = getComputedStyle(element)
      return element.clientHeight > 40 && /auto|scroll/.test(css.overflowY)
    })
    const container = containers.find(element => element.scrollHeight > element.clientHeight + 2) ?? containers[0]
    if (!container) return null
    const css = getComputedStyle(container)
    const thumb = getComputedStyle(container, '::-webkit-scrollbar-thumb').backgroundColor
    const width = parseFloat(getComputedStyle(container, '::-webkit-scrollbar').width)
    const before = container.scrollTop
    const overflow = container.scrollHeight > container.clientHeight + 2
    container.scrollTop = before === 0 ? 1 : 0
    const scrolled = container.scrollTop !== before
    container.scrollTop = before
    return {
      thumb,
      width,
      gutter:
        container.offsetWidth -
        container.clientWidth -
        parseFloat(css.borderLeftWidth) -
        parseFloat(css.borderRightWidth),
      overflow,
      scrolled,
    }
  })
  assert.ok(result, `${name} must expose a usable scroll container`)
  assert.match(result.thumb, /^rgba?\(/, `${name} must render a scrollbar thumb`)
  assert.ok(result.thumb !== 'rgba(0, 0, 0, 0)', `${name} must not render an invisible thumb`)
  assert.ok(result.width > 0 && result.width <= 10, `${name} must render a narrow scrollbar`)
  if (result.gutter > 0) assert.ok(result.gutter <= 10, `${name} must keep the scroll gutter narrow`)
  if (result.overflow) assert.ok(result.scrolled, `${name} must allow overflowing content to scroll`)
  return { thumb: result.thumb, gutter: result.gutter }
}

/** A fresh browser has no local draft to mask a failed save or restart. */
export async function verifySavedNotebook(url, expected, cookies = []) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage()
    page.setDefaultTimeout(30_000)
    await page.context().addCookies(cookies)
    await page.goto(url)
    const workspace = page.getByRole('dialog', { name: 'Nook 笔记工作区', exact: true })
    await workspace.waitFor()
    await dismissOnboarding(page)
    await workspace.getByRole('button', { name: expected.trash ? '回收站' : '所有笔记', exact: true }).click()
    await workspace.getByRole('searchbox', { name: '搜索笔记' }).fill(expected.title)
    await workspace.locator('.nook-note-card').filter({ hasText: expected.title }).click()
    assert.equal(await workspace.getByRole('textbox', { name: '笔记标题', exact: true }).inputValue(), expected.title)
    assert.equal(
      (await workspace.getByRole('textbox', { name: '笔记正文', exact: true }).innerText()).trim(),
      expected.markdown.trim(),
    )
  } finally {
    await browser.close()
  }
}

export const initialMarkdown = '劳动异化与自由实践：今天学习了新的概念。\n保留完整的思考过程。'
export const initialSavedMarkdown = '劳动异化与自由实践：今天学习了新的概念。\n\n保留完整的思考过程。'
export async function createNotebookNote(page, { pinned = false } = {}) {
  const workspace = page.getByRole('dialog', { name: 'Nook 笔记工作区', exact: true })
  const suffix = crypto.randomUUID().slice(0, 8)
  const title = 'Nook 验收 ' + suffix
  await workspace
    .getByRole('button', { name: /写一条笔记/ })
    .first()
    .click()
  await workspace.getByRole('textbox', { name: '笔记标题', exact: true }).fill(title)
  await workspace.getByRole('textbox', { name: '笔记正文', exact: true }).fill(initialMarkdown)
  await waitForNoteSave(page)
  if (pinned) {
    for (const name of ['置顶', '已置顶', '置顶']) {
      await workspace.getByRole('button', { name, exact: true }).click()
      await waitForNoteSave(page)
    }
  }
  return { workspace, suffix, title }
}
