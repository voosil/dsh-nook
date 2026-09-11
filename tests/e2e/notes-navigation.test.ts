import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import * as Notebook from '../../packages/provider-notebook-local/src/index.js'
import { createDevSandbox } from '../../scripts/profile/dev-sandbox.mjs'
import { bootAndVerifyWeb } from '../../scripts/verify/runtime-verify.mjs'
import { dismissOnboarding, waitForNoteSave } from '../../scripts/verify/notebook-smoke.mjs'
import { ROOT, dshBin } from '../../scripts/profile/profile-lib.mjs'

const require = createRequire(import.meta.url)
const { chromium } = createRequire(require.resolve('dsh-browser-playwright/playwright'))('playwright-core')

test(
  'notebook navigation retains selection, filters, pagination, scrolling and editor history',
  { timeout: 180_000 },
  async t => {
    const sandbox = await createDevSandbox()
    t.after(() => sandbox.dispose())
    const ctx = new Context()
    try {
      await ctx.plugin(Notebook, {
        file: join(sandbox.home, 'nook/notebook.sqlite'),
        projectsFile: join(sandbox.home, 'nook/projects.json'),
      })
      const project = await ctx.nookProjects.create({ name: '页面状态项目', description: '' })
      for (let index = 0; index < 55; index++) {
        await ctx.nookNotes.create({
          id: randomUUID(),
          title: `保留页面 ${String(index).padStart(2, '0')}`,
          markdown: Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 段：切换应用后继续阅读和编辑。`).join('\n\n'),
          projectId: project.id,
          pinned: false,
          source: { kind: 'personal', url: null, author: null, basedOn: [] },
        })
      }
    } finally {
      await ctx.fiber.dispose()
    }
    await bootAndVerifyWeb({
      bin: dshBin(),
      cwd: ROOT,
      env: { ...sandbox.env, NOOK_DEV_RUNTIME: '1' },
      acceptance: async (url: string) => {
        const browser = await chromium.launch({ channel: 'chrome', headless: true })
        try {
          const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
          page.setDefaultTimeout(15_000)
          const errors: string[] = []
          page.on('pageerror', (error: Error) => errors.push(error.message))
          await page.goto(url)
          const workspace = page.getByRole('dialog', { name: 'Nook 笔记工作区', exact: true })
          await workspace.waitFor()
          await dismissOnboarding(page)
          await workspace.getByRole('button', { name: '页面状态项目', exact: true }).click()
          const search = workspace.getByRole('searchbox', { name: '搜索笔记' })
          await search.fill('保留页面')
          const sort = workspace.getByRole('combobox', { name: '笔记排序' })
          await sort.click()
          await page.getByRole('option', { name: '标题顺序', exact: true }).click()
          await workspace.locator('.nook-pagination').getByText('1 / 2', { exact: true }).waitFor()
          await workspace.getByRole('button', { name: '下一页', exact: true }).click()
          await workspace.locator('.nook-note-card').filter({ hasText: '保留页面 54' }).click()
          const title = workspace.getByRole('textbox', { name: '笔记标题', exact: true })
          const body = workspace.getByRole('textbox', { name: '笔记正文', exact: true })
          await body.click()
          await page.keyboard.press('ControlOrMeta+End')
          await page.keyboard.type('Keep this edit')
          const edited = await body.innerText()
          const editor = workspace.locator('.nook-editor')
          await editor.evaluate((element: HTMLElement) => {
            element.scrollTop = 600
          })
          const scroll = await editor.evaluate((element: HTMLElement) => element.scrollTop)
          assert.ok(scroll > 0)
          const editorNode = await body.elementHandle()

          for (const exit of ['button', 'escape', 'tasks']) {
            if (exit === 'escape') {
              await workspace.focus()
              await page.keyboard.press('Escape')
            } else {
              await workspace
                .getByRole('button', {
                  name: exit === 'tasks' ? '任务与日程' : '返回 AI 对话',
                  exact: true,
                })
                .click()
            }
            await workspace.waitFor({ state: 'hidden' })
            assert.equal(await page.getByRole('textbox', { name: '笔记正文', exact: true }).count(), 0)
            if (exit === 'tasks') await page.getByRole('link', { name: '返回笔记', exact: true }).click()
            else {
              const entry = page.getByRole('button', { name: '打开 Nook', exact: true })
              await entry.focus()
              await page.keyboard.press('Enter')
            }
            await workspace.waitFor()
            assert.equal(await title.inputValue(), '保留页面 54')
            assert.equal(await search.inputValue(), '保留页面')
            assert.equal(await sort.innerText(), '标题顺序')
            await workspace.locator('.nook-pagination').getByText('2 / 2', { exact: true }).waitFor()
            assert.equal(await body.innerText(), edited)
            assert.equal(await editor.evaluate((element: HTMLElement) => element.scrollTop), scroll)
            assert.equal(
              await body.evaluate((element: HTMLElement, original: HTMLElement) => element === original, editorNode),
              true,
            )
          }
          await body.focus()
          await page.keyboard.press('ControlOrMeta+z')
          assert.ok(!(await body.innerText()).includes('Keep this edit'), 'Editor undo history survives navigation')
          await waitForNoteSave(page)
          await workspace.getByRole('button', { name: '项目', exact: true }).click()
          await workspace.getByRole('button', { name: '返回 AI 对话', exact: true }).click()
          await page.getByRole('button', { name: '打开 Nook', exact: true }).click()
          await workspace.locator('.nook-project-grid').waitFor()
          await workspace.getByRole('button', { name: '回收站', exact: true }).click()
          await workspace.getByRole('button', { name: '返回 AI 对话', exact: true }).click()
          await page.getByRole('button', { name: '打开 Nook', exact: true }).click()
          await workspace.getByRole('heading', { name: /回收站/ }).waitFor()
          assert.deepEqual(errors, [])
        } finally {
          await browser.close()
        }
      },
    })
  },
)
