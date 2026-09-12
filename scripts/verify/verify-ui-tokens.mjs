import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ROOT } from '../profile/profile-lib.mjs'

// tsx/内联样式硬编码色值门禁：扫描所有 ui-* 包的 ts/tsx/css，
// tokens.css（Nook 色卡）是唯一豁免文件。
const SCOPES = (await readdir(resolve(ROOT, 'packages'), { withFileTypes: true }))
  .filter(entry => entry.isDirectory() && entry.name.startsWith('ui-'))
  .map(entry => entry.name)
  .sort()
if (SCOPES.length === 0) throw new Error('No UI packages found; refusing an empty token verification.')
const EXEMPT = new Set([resolve(ROOT, 'packages/ui-kit/styles/tokens.css')])

// 检查色值集中管理这一仓库约束，不以 CSS 变量/选择器的拼写推断渲染正确性。
const PATTERNS = [
  [/#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/, 'hex literal'],
  [/\brgba?\(/, 'rgb()/rgba()'],
  [/\bhsla?\(/, 'hsl()/hsla()'],
  [/\boklch\(/, 'oklch()'],
  [/\bcolor\(/, 'color()'],
  [/\bhwb\(/, 'hwb()'],
  [/\blab\(/, 'lab()'],
  [/\blch\(/, 'lch()'],
  [/\bcolor-mix\(/, 'color-mix()'],
]

async function filesBelow(directory) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) result.push(...(await filesBelow(path)))
    else if (/\.(?:ts|tsx|css)$/.test(path) && !EXEMPT.has(path)) result.push(path)
  }
  return result
}

let hits = 0
for (const scope of SCOPES) {
  for (const file of await filesBelow(resolve(ROOT, 'packages', scope))) {
    const source = await readFile(file, 'utf8')
    const lines = source.split('\n')
    for (let index = 0; index < lines.length; index++) {
      for (const [pattern, label] of PATTERNS) {
        if (pattern.test(lines[index] ?? '')) {
          hits++
          process.stderr.write(`${file}:${index + 1}: ${label}: ${(lines[index] ?? '').trim()}\n`)
        }
      }
    }
  }
}

if (hits > 0) throw new Error(`Found ${hits} hardcoded color value(s); use var(--nook-*) tokens instead.`)
process.stdout.write(`Verified no hardcoded color values across ${SCOPES.length} UI packages.\n`)
