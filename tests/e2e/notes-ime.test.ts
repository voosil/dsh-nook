import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const { chromium } = createRequire(require.resolve('dsh-browser-playwright/playwright'))('playwright-core')

test('task text keeps its caret when IME candidates are deleted or cancelled', { timeout: 60_000 }, async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'nook-notes-ime-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const outfile = resolve(directory, 'fixture.js')
  await build({
    entryPoints: ['tests/fixtures/notes-ime.tsx'],
    outfile,
    bundle: true,
    format: 'iife',
    jsx: 'automatic',
    loader: { '.css': 'text' },
  })
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  t.after(() => browser.close())
  for (const [name, candidates] of [
    ['delete candidates one by one', ['shili', 'shil', 'shi', 'sh', 's', '']],
    ['cancel the entire composition (Escape)', ['shili', '']],
  ] as const) {
    await t.test(name, async () => {
      const page = await browser.newPage()
      try {
        const errors: string[] = []
        page.on('pageerror', (error: Error) => errors.push(error.message))
        await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>')
        await page.addScriptTag({ path: outfile })
        const body = page.getByRole('textbox', { name: '笔记正文', exact: true })
        await body.waitFor()
        await body.locator('li > div > p').evaluate((p: HTMLElement) => {
          p.closest<HTMLElement>('[contenteditable]')!.focus()
          window.getSelection()!.collapse(p.firstChild, '（这是一个'.length)
        })
        const cdp = await page.context().newCDPSession(page)
        for (const text of candidates) {
          // CDP drives Chromium's real composition lifecycle. An empty candidate
          // cancels composition as the OS IME does for Escape; a synthetic
          // KeyboardEvent alone cannot cancel a native composition.
          await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length })
          // Let composition DOM changes and React's controlled Markdown echo settle.
          await page.waitForTimeout(80)
        }
        const caret = await body.evaluate(() => {
          const selection = window.getSelection()!
          return { text: selection.anchorNode?.textContent, offset: selection.anchorOffset }
        })
        assert.deepEqual(caret, { text: '（这是一个）后续文字', offset: 5 }, candidates.join(' → '))
        await cdp.send('Input.imeSetComposition', { text: 'shili', selectionStart: 5, selectionEnd: 5 })
        await page.waitForTimeout(80)
        await cdp.send('Input.insertText', { text: '示例' })
        await page.waitForTimeout(80)
        assert.equal(await body.locator('li > div > p').textContent(), '（这是一个示例）后续文字')
        assert.equal((await page.getByLabel('保存内容').textContent())?.trim(), '- [ ] （这是一个示例）后续文字')
        const checkbox = body.getByRole('checkbox', { name: '切换待办完成状态' })
        await checkbox.check()
        assert.equal(await checkbox.isChecked(), true)
        assert.equal((await page.getByLabel('保存内容').textContent())?.trim(), '- [x] （这是一个示例）后续文字')
        assert.deepEqual(errors, [])
      } finally {
        await page.close()
      }
    })
  }
})
