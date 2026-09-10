import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const { chromium } = createRequire(require.resolve('dsh-browser-playwright/playwright'))('playwright-core')

// The selected-item check is absolutely positioned; it must stay centered in the
// option row for both Select variants (plain and searchable).
const checkCenteredInRow = () => {
  const item = document.querySelector('.nui-select-item[data-selected]')
  const check = item?.querySelector('.nui-select-check')
  if (!item || !check) return false
  const itemBox = item.getBoundingClientRect()
  const checkBox = check.getBoundingClientRect()
  return Math.abs(itemBox.top + itemBox.height / 2 - (checkBox.top + checkBox.height / 2)) <= 1
}

test(
  'kit controls preserve geometry, keyboard interaction, floating placement and reduced motion',
  { timeout: 60_000 },
  async t => {
    const directory = await mkdtemp(resolve(tmpdir(), 'nook-ui-kit-'))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const outfile = resolve(directory, 'fixture.js')
    await build({
      entryPoints: ['tests/fixtures/ui-kit.tsx'],
      outfile,
      bundle: true,
      format: 'iife',
      jsx: 'automatic',
      loader: { '.css': 'text' },
    })
    const browser = await chromium.launch({ channel: 'chrome', headless: true })
    t.after(() => browser.close())
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
    const errors: string[] = []
    page.on('pageerror', (error: Error) => errors.push(error.message))
    await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>')
    await page.addScriptTag({ path: outfile })
    const primary = page.getByRole('button', { name: '主操作', exact: true })
    await primary.waitFor()
    const colors = await primary.evaluate((element: HTMLElement) => {
      const css = getComputedStyle(element)
      return [css.color, css.backgroundColor]
    })
    assert.notEqual(colors[0], colors[1])
    const bounds = await primary.boundingBox()
    await primary.hover()
    await page.mouse.down()
    assert.deepEqual(await primary.boundingBox(), bounds, 'Pressing must not scale the target')
    await page.mouse.up()
    assert.equal(await page.getByRole('button', { name: '不可用', exact: true }).isDisabled(), true)
    await page.getByLabel('正文', { exact: true }).fill('多行\n笔记')
    assert.equal(await page.getByLabel('正文', { exact: true }).inputValue(), '多行\n笔记')
    await page.getByRole('switch', { name: '自动保存', exact: true }).click()
    assert.equal(await page.getByRole('switch').getAttribute('aria-checked'), 'true')
    const select = page.getByRole('combobox', { name: '项目', exact: true })
    await select.focus()
    await page.keyboard.press('ArrowDown')
    await page.getByRole('option', { name: '阅读笔记', exact: true }).waitFor()
    const popupBounds = await page.getByRole('listbox').boundingBox()
    assert.ok(popupBounds.width >= (await select.boundingBox()).width - 2)
    assert.equal(await page.getByRole('option', { name: '不可用项目' }).getAttribute('aria-disabled'), 'true')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    assert.equal(await select.innerText(), '阅读笔记')
    await select.focus()
    await page.keyboard.press('ArrowDown')
    await page.getByRole('option', { name: '阅读笔记', exact: true }).waitFor()
    await page.waitForFunction(checkCenteredInRow)
    await page.keyboard.press('Escape')
    await page.getByRole('combobox', { name: '搜索项目', exact: true }).click()
    const search = page.getByRole('combobox', { name: '搜索选项', exact: true })
    await search.fill('没有这个项目')
    await page.getByText('没有匹配的选项', { exact: true }).waitFor()
    await search.fill('项目 10')
    await page.getByRole('option', { name: '项目 10 · 研究和阅读中的长期记录', exact: true }).click()
    await page.getByRole('combobox', { name: '搜索项目', exact: true }).click()
    await page.getByRole('option', { name: '项目 10 · 研究和阅读中的长期记录', exact: true }).waitFor()
    await page.waitForFunction(checkCenteredInRow)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '打开弹窗', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '设置', exact: true })
    await dialog.getByRole('combobox').click()
    await page.getByRole('option', { name: '未分类', exact: true }).click()
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(
      await page.getByRole('button', { name: '打开弹窗' }).evaluate((el: HTMLElement) => el === document.activeElement),
      true,
    )
    const target = page.getByRole('button', { name: '右键目标', exact: true })
    const targetBounds = await target.boundingBox()
    const point = { x: targetBounds.x + 20, y: targetBounds.y + 10 }
    await page.mouse.click(point.x, point.y, { button: 'right' })
    const menu = page.getByRole('menu')
    await menu.waitFor()
    await page.waitForFunction(({ x, y }) => {
      const box = document.querySelector('.nui-menu')?.getBoundingClientRect()
      return box && Math.abs(box.x - x) <= 2 && Math.abs(box.y - y - 2) <= 2
    }, point)
    const menuBounds = await menu.boundingBox()
    assert.ok(Math.abs(menuBounds.x - point.x) <= 2, 'Context menu must start at pointer X')
    assert.ok(Math.abs(menuBounds.y - point.y - 2) <= 2, 'Context menu must start below pointer Y')
    await page.keyboard.press('Escape')
    await menu.waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: '边缘目标', exact: true }).click({ button: 'right' })
    await menu.waitFor()
    await page.waitForFunction(() => {
      const box = document.querySelector('.nui-menu')?.getBoundingClientRect()
      return box && box.x > 700 && box.y > 500
    })
    const edge = await menu.boundingBox()
    assert.ok(edge.x >= 0 && edge.x + edge.width <= 1000 && edge.y >= 0 && edge.y + edge.height <= 800)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '导出', exact: true }).click()
    await page.getByText('已导出', { exact: true }).waitFor()
    await page.getByRole('button', { name: '关闭', exact: true }).click()
    await page.getByText('已导出', { exact: true }).waitFor({ state: 'hidden' })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    assert.ok(
      (await primary.evaluate((el: HTMLElement) => getComputedStyle(el).transitionDuration))
        .split(',')
        .every((value: string) => value.trim() === '0s'),
    )
    assert.deepEqual(errors, [])
  },
)
