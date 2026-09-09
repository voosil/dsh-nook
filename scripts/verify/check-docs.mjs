#!/usr/bin/env node
// Minimal documentation gates, adapted from DeepSeek Harness upstream
// (verify-md-links + verify-agent-note-format). No dependencies.
// Checks:
//   1. Every relative Markdown link (path and #anchor) resolves.
//   2. Agent Notes under .notes/{proposed,implemented,rejected} follow the
//      header format and carry the mandatory skeleton sections.
//   3. Notes never sit outside a lifecycle folder.

import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const LIFECYCLE = new Set(['proposed', 'implemented', 'rejected'])
const SKIP_DIRS = new Set(['node_modules', 'wip', 'lib', '.git'])

const errors = []

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    if (entry.name.startsWith('.') && entry.name !== '.notes' && entry.name !== '.agents') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) await walk(full, out)
    else if (entry.name.endsWith('.md')) out.push(full)
  }
  return out
}

function slugify(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
}

async function checkLink(file, target) {
  if (/^(https?:|mailto:)/.test(target)) return
  const [pathPart, anchor] = target.split('#')
  if (isAbsolute(pathPart)) {
    errors.push(`${relative(ROOT, file)}: absolute link target "${target}"`)
    return
  }
  if (pathPart) {
    let exists = false
    try {
      exists = (await stat(resolve(dirname(file), pathPart))).isFile()
    } catch {
      exists = false
    }
    if (!exists) {
      errors.push(`${relative(ROOT, file)}: broken link "${target}"`)
      return
    }
  }
  if (anchor) {
    const doc = pathPart ? resolve(dirname(file), pathPart) : file
    const text = await readFile(doc, 'utf8')
    const anchors = new Set([...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map(m => slugify(m[1])))
    if (!anchors.has(slugify(anchor))) {
      errors.push(`${relative(ROOT, file)}: broken anchor "#${anchor}" in "${target}"`)
    }
  }
}

const files = []
for (const dir of [ROOT, join(ROOT, 'docs'), join(ROOT, '.notes'), join(ROOT, '.agents')]) {
  files.push(...(await walk(dir)))
}

for (const file of [...new Set(files)]) {
  const rel = relative(ROOT, file)
  const text = await readFile(file, 'utf8')
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    await checkLink(file, match[1])
  }

  if (!rel.startsWith(`.notes${sep}`)) continue
  const parts = rel.split(sep) // .notes / <lifecycle|AGENTS.md> / ...
  if (parts.length === 2) continue // .notes/AGENTS.md
  const folder = parts[1]
  if (!LIFECYCLE.has(folder)) {
    errors.push(`${rel}: note outside a lifecycle folder (proposed/implemented/rejected)`)
    continue
  }
  const lines = text.split('\n')
  if (!lines[0].startsWith('# Agent Note: ')) {
    errors.push(`${rel}: first line must start "# Agent Note: "`)
  }
  if (lines[1] !== '') {
    errors.push(`${rel}: line 2 must be blank (header block)`)
  }
  const status = lines[2] ?? ''
  const statusOk = status === `Status: ${folder}` || (folder === 'rejected' && /^Status: rejected — .+/.test(status))
  if (!statusOk) {
    errors.push(`${rel}: line 3 must be "Status: ${folder}" (or "rejected — reason")`)
  }
  if (!/^## Problem$/m.test(text)) {
    errors.push(`${rel}: missing "## Problem" section`)
  }
  if (!/^## Alternatives considered$/m.test(text)) {
    errors.push(`${rel}: missing "## Alternatives considered" section`)
  }
}

if (errors.length > 0) {
  console.error(`docs check: ${errors.length} error(s)`)
  for (const error of errors) console.error(`  ${error}`)
  process.exit(1)
}
console.log(`docs check: ${files.length} file(s) OK`)
