import { readFileSync, accessSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** Windows npm shims cannot be spawned directly. Use the package's declared CLI. */
export function corepackCommand(
  args,
  { platform = process.platform, env = process.env, node = process.execPath } = {},
) {
  if (platform !== 'win32') return ['corepack', args]
  const path = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? ''
  for (const directory of [...path.split(';').filter(Boolean), dirname(node)]) {
    const manifestPath = join(directory.replace(/^"|"$/g, ''), 'node_modules/corepack/package.json')
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.corepack
      if (!bin) continue
      const entry = resolve(dirname(manifestPath), bin)
      accessSync(entry)
      return [node, [entry, ...args]]
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error
    }
  }
  throw new Error('Cannot locate the Corepack CLI. Install Corepack alongside Node or on PATH, then retry.')
}
