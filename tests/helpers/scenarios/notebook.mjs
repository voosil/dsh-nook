import { withNotebookPage } from '../browser/page.mjs'
import { notebookSettings } from './notebook-settings.mjs'
import { notebookLifecycle } from './notebook-lifecycle.mjs'
import { notebookConcurrency } from './notebook-concurrency.mjs'
import { notebookHistory } from './notebook-history.mjs'
import { notebookSync } from './notebook-sync.mjs'
export const notebookScenarios = [
  ['settings and navigation', notebookSettings],
  ['concurrent edits', notebookConcurrency],
  ['history restoration', notebookHistory],
  ['projects, saved notes and export', notebookLifecycle],
  ['sync configuration and transfer', notebookSync],
]
export async function runNotebookAcceptance(t, { url, page, screenshot, verifySync = true, profileDirectory, node }) {
  let expected
  for (const [name, scenario] of notebookScenarios) {
    if (!verifySync && scenario === notebookSync) continue
    let finished = false
    await t.test(name, { timeout: 180_000 }, async () => {
      const result = await withNotebookPage(url, p => scenario(p, { screenshot, profileDirectory, node }), {
        page,
        name,
      })
      if (scenario === notebookLifecycle) expected = result
      finished = true
    })
    if (!finished) throw new Error('Notebook scenario failed: ' + name)
  }
  return expected
}
