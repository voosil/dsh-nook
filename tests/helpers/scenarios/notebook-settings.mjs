import assert from 'node:assert/strict'

import { dismissOnboarding, renderedAppearance, verifyThemedScrollbar } from '../browser/notebook.mjs'
export async function notebookSettings(page) {
  const workspace = page.getByRole('dialog', { name: 'Nook 笔记工作区', exact: true })
  for (let attempt = 0; attempt < 2; attempt++) {
    await workspace.getByRole('button', { name: '返回 AI 对话', exact: true }).click()
    await workspace.waitFor({ state: 'hidden' })
    assert.equal(await page.getByRole('button', { name: '打开 Nook 笔记', exact: true }).count(), 0)
    const entry = page.getByRole('button', { name: '打开 Nook', exact: true })
    assert.equal(await entry.count(), 1)
    await entry.click()
    await workspace.waitFor()
  }
  await workspace.getByRole('button', { name: '设置', exact: true }).click()
  const settings = workspace.getByRole('dialog', { name: '设置', exact: true })
  await settings.waitFor()
  assert.deepEqual(await settings.boundingBox(), { x: 0, y: 0, ...page.viewportSize() })
  await settings.getByRole('button', { name: '应用更新', exact: true }).click()
  await settings.getByRole('region', { name: '应用更新', exact: true }).waitFor()
  await settings
    .getByText('请从源码运行 pnpm start 以启用更新。', { exact: true })
    .or(settings.getByText('请先从源码运行 pnpm start 以启用应用更新。', { exact: true }))
    .waitFor()
  assert.ok(await settings.getByRole('button', { name: '检查更新', exact: true }).isDisabled())
  assert.equal(
    await settings.getByRole('button', { name: '应用更新', exact: true }).getAttribute('aria-current'),
    'page',
  )
  if (process.env.NOOK_UPDATE_SCREENSHOT) {
    await settings.evaluate(async element => {
      await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})))
    })
    await page.screenshot({ path: process.env.NOOK_UPDATE_SCREENSHOT })
  }
  await settings.getByRole('button', { name: '外观', exact: true }).click()
  const scrollbarThumbs = new Set()
  const appearances = new Set()
  for (const [name, theme] of [
    ['Claude 暖纸', 'claude'],
    ['夜晚', 'night'],
    ['Nook 纸感', 'paper'],
    ['孟菲斯', 'memphis'],
  ]) {
    await settings.getByRole('button', { name: new RegExp(name) }).click()
    assert.equal(await settings.getByRole('button', { name: new RegExp(name) }).getAttribute('aria-pressed'), 'true')
    const scrollbar = await verifyThemedScrollbar(page, theme, name)
    scrollbarThumbs.add(scrollbar.thumb)
    appearances.add(JSON.stringify(await renderedAppearance(page)))
    await settings.evaluate(async element => {
      await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})))
    })
    if (process.env.NOOK_APPEARANCE_SCREENSHOT)
      await page.screenshot({ path: process.env.NOOK_APPEARANCE_SCREENSHOT.replace('.png', `-${theme}.png`) })
  }
  assert.equal(scrollbarThumbs.size, 4, 'Every appearance themes the scrollbar thumb separately')
  assert.equal(appearances.size, 4, 'Selecting an appearance changes the rendered workspace')
  await settings.getByRole('button', { name: /夜晚/ }).click()
  const nightAppearance = await renderedAppearance(page)
  await page.keyboard.press('Escape')
  await settings.waitFor({ state: 'hidden' })
  assert.ok(await workspace.isVisible(), 'Escape closes only settings')
  await page.reload()
  await workspace.waitFor()
  await dismissOnboarding(page)
  assert.deepEqual(await renderedAppearance(page), nightAppearance, 'Rendered appearance survives reload')
  await workspace.getByRole('button', { name: '设置', exact: true }).click()
  const viewport = page.viewportSize()
  await page.setViewportSize({ width: 390, height: 720 })
  assert.deepEqual(await settings.boundingBox(), { x: 0, y: 0, width: 390, height: 720 })
  assert.ok(await settings.evaluate(element => element.scrollWidth <= element.clientWidth))
  if (process.env.NOOK_APPEARANCE_SCREENSHOT)
    await page.screenshot({ path: process.env.NOOK_APPEARANCE_SCREENSHOT.replace('.png', '-narrow.png') })
  await page.setViewportSize(viewport)
  await settings.getByRole('button', { name: /Nook 纸感/ }).click()
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click()
}
