import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROOT, run } from '../profile/profile-lib.mjs'

export const NODE_VERSION = '24.20.0'
const SHA256 = '40e5607e5ecb3db9192723776da2d75d966260fc74a7a9e731c1bd67dda96bc8'

export async function desktopNode() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw new Error('Desktop Node packaging currently supports macOS arm64')
  const cache = resolve(ROOT, '.pack', 'node')
  const destination = join(cache, `node-v${NODE_VERSION}-darwin-arm64`)
  try {
    if ((await readFile(join(destination, '.archive-sha256'), 'utf8')).trim() === SHA256) return destination
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  await mkdir(cache, { recursive: true })
  const temporary = await mkdtemp(join(cache, '.download-'))
  try {
    const archive = `node-v${NODE_VERSION}-darwin-arm64.tar.gz`
    const response = await fetch(`https://nodejs.org/dist/v${NODE_VERSION}/${archive}`, {
      signal: AbortSignal.timeout(120_000),
    })
    if (!response.ok) throw new Error(`Node download returned HTTP ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (createHash('sha256').update(bytes).digest('hex') !== SHA256) throw new Error('Node archive checksum mismatch')
    await writeFile(join(temporary, archive), bytes)
    await run('tar', ['-xzf', join(temporary, archive), '-C', temporary])
    const extracted = join(temporary, archive.replace('.tar.gz', ''))
    await writeFile(join(extracted, '.archive-sha256'), SHA256 + '\n')
    await rename(extracted, destination)
    return destination
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

export async function copyDesktopNode(destination) {
  const source = await desktopNode()
  await mkdir(join(destination, 'bin'), { recursive: true })
  await cp(join(source, 'bin', 'node'), join(destination, 'bin', 'node'))
  await cp(join(source, 'LICENSE'), join(destination, 'LICENSE'))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(await desktopNode())
