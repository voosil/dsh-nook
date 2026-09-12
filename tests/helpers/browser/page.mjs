import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ROOT } from '../../../scripts/profile/profile-lib.mjs'
import { dismissOnboarding } from './notebook.mjs'

const require = createRequire(import.meta.url)
const { chromium } = createRequire(require.resolve('dsh-browser-playwright/playwright'))('playwright-core')

/** Own only resources created here; the desktop harness owns a supplied page. */
export async function withNotebookPage(url, callback, { page: supplied, name = 'browser' } = {}) {
  let browser
  let page
  const errors = []
  const onError = error => errors.push(error.message)
  try {
    browser = supplied ? undefined : await chromium.launch({ channel: 'chrome', headless: true })
    page = supplied ?? (await browser.newPage({ viewport: { width: 1440, height: 1000 } }))
    page.setDefaultTimeout(30_000)
    page.on('pageerror', onError)
    await page.goto(url)
    await page.getByRole('dialog', { name: 'Nook 笔记工作区', exact: true }).waitFor()
    await dismissOnboarding(page)
    const result = await callback(page)
    if (errors.length) throw new Error(`Unhandled browser errors: ${errors.join('\n')}`)
    return result
  } catch (error) {
    const directory = join(ROOT, '.pack/test-results', randomUUID())
    await mkdir(directory, { recursive: true })
    const screenshot = join(directory, name.replace(/[^a-z0-9-]+/gi, '-') + '.png')
    await page?.screenshot({ path: screenshot }).catch(() => {})
    console.error(`Browser failure artifact: ${screenshot}`)
    throw error
  } finally {
    page?.off('pageerror', onError)
    await browser?.close()
  }
}
