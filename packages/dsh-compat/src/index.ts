import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Context } from '@deepseek-ai/cordis'

export const DSH_VERSION = '0.1.3-alpha.2' as const
export const CORDIS_VERSION = '4.0.2' as const
export const COMMUNITY_BROWSER_VERSION = '0.1.1' as const

const require = createRequire(import.meta.url)

function versionOf(packageName: string): string {
  const file = require.resolve(`${packageName}/package.json`)
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown }
  if (typeof manifest.version !== 'string') throw new Error(`${packageName} has no string version`)
  return manifest.version
}

export function assertDshCompatibility(): void {
  const expected = new Map<string, string>([
    ['@deepseek-ai/dsh', DSH_VERSION],
    ['@deepseek-ai/dsh-tools', DSH_VERSION],
    ['@deepseek-ai/cordis', CORDIS_VERSION],
    ['dsh-browser-playwright', COMMUNITY_BROWSER_VERSION],
  ])
  for (const [packageName, wanted] of expected) {
    const actual = versionOf(packageName)
    if (actual !== wanted) {
      throw new Error(`Nook compatibility guard: ${packageName}@${actual} is active; expected exactly ${wanted}`)
    }
  }
}

/** Cordis plugin entry: fail before product services mount against an unverified runtime. */
export function apply(_ctx: Context): void {
  assertDshCompatibility()
}
