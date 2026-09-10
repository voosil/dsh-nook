import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { canonicalPath, safeHome, within } from './policy.js'

export interface TreeEntry {
  path: string
  kind: 'directory' | 'file' | 'link'
  digest: string
  executable: number
}
export interface PayloadManifest {
  schemaVersion: 1
  platform: string
  arch: string
  nodeVersion: string
  electronVersion: string
  entries: TreeEntry[]
}
export interface RuntimeConfig {
  home: string
  bin: string
  node: string
  supervisor: string
  cwd: string
  profile: string
  port?: number
  updateControl?: { socket: string; token: string }
  updateValidating?: boolean
}

export async function inventory(root: string, signal?: AbortSignal): Promise<TreeEntry[]> {
  const entries: TreeEntry[] = []
  const realRoot = await realpath(root)
  async function visit(part: string) {
    signal?.throwIfAborted()
    const path = join(root, part)
    const stat = await lstat(path)
    let kind: TreeEntry['kind']
    let digest = ''
    if (stat.isSymbolicLink()) {
      kind = 'link'
      digest = await readlink(path)
      if (!within(realRoot, await realpath(path))) throw new Error(`Runtime link escapes payload: ${part}`)
      if (digest.startsWith('/')) throw new Error(`Runtime link is not relocatable: ${part}`)
    } else if (stat.isDirectory()) kind = 'directory'
    else if (stat.isFile()) {
      kind = 'file'
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(path)) hash.update(chunk)
      digest = hash.digest('hex')
    } else throw new Error(`Unsupported runtime file: ${part}`)
    // Symlink inode permissions vary with umask on macOS and do not control
    // execution. The target string and the target file's actual mode are checked.
    entries.push({ path: part, kind, digest, executable: kind === 'link' ? 0 : stat.mode & 0o111 })
    if (kind === 'directory')
      for (const name of (await readdir(path)).sort()) await visit(part ? `${part}/${name}` : name)
  }
  await visit('')
  return entries
}

export async function verifyPayload(root: string, manifest: PayloadManifest, signal?: AbortSignal): Promise<void> {
  if (
    manifest.schemaVersion !== 1 ||
    manifest.platform !== process.platform ||
    manifest.arch !== process.arch ||
    !Array.isArray(manifest.entries)
  )
    throw new Error('Desktop runtime platform or manifest is incompatible')
  const actual = await inventory(root, signal)
  if (JSON.stringify(actual) !== JSON.stringify(manifest.entries)) {
    const index = actual.findIndex((entry, index) => JSON.stringify(entry) !== JSON.stringify(manifest.entries[index]))
    const path = actual[index]?.path ?? manifest.entries[actual.length]?.path ?? '(root)'
    throw new Error(`Desktop runtime integrity check failed at ${path}`)
  }
}

async function createOnce(path: string, content: string) {
  try {
    await writeFile(path, content, { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

/** Runtime versions are retained; upgrades never replace user patches or data. */
export async function installPayload(seed: string, state: string, signal?: AbortSignal): Promise<RuntimeConfig> {
  const home = safeHome(join(state, 'harness'))
  const manifest = JSON.parse(await readFile(join(seed, 'manifest.json'), 'utf8')) as PayloadManifest
  const fingerprint = createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
  const versions = join(state, 'runtimes')
  const destination = join(versions, fingerprint)
  await mkdir(versions, { recursive: true, mode: 0o700 })
  let existing = false
  try {
    await lstat(destination)
    existing = true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (!existing) {
    await verifyPayload(join(seed, 'payload'), manifest, signal)
    const staging = await mkdtemp(join(versions, '.install-'))
    try {
      await cp(join(seed, 'payload'), join(staging, 'payload'), {
        recursive: true,
        verbatimSymlinks: true,
        filter: () => {
          signal?.throwIfAborted()
          return true
        },
      })
      await verifyPayload(join(staging, 'payload'), manifest, signal)
      await rename(join(staging, 'payload'), destination)
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
  } else await verifyPayload(destination, manifest, signal)

  return activateProfile({
    state,
    seedProfile: join(destination, 'home', 'profiles', 'nook'),
    node: join(destination, 'node', 'bin', 'node'),
    supervisor: join(destination, 'boot', 'supervisor.mjs'),
  })
}

/** Attach a fixed installed package snapshot to the writable user Profile. */
export async function activateProfile({
  state,
  seedProfile,
  node,
  supervisor,
}: {
  state: string
  seedProfile: string
  node: string
  supervisor: string
}): Promise<RuntimeConfig> {
  const home = safeHome(join(state, 'harness'))
  const versions = join(state, 'runtimes')
  const profile = join(home, 'profiles', 'nook')
  await mkdir(profile, { recursive: true, mode: 0o700 })
  await mkdir(join(home, 'agents'), { recursive: true, mode: 0o700 })
  const source = JSON.parse(await readFile(join(seedProfile, 'package.json'), 'utf8'))
  await createOnce(
    join(profile, 'package.json'),
    JSON.stringify(
      {
        name: 'nook-desktop-profile',
        private: true,
        dsh: { profile: { bundles: source.dsh.profile.bundles, patchReload: 'startup' } },
      },
      null,
      2,
    ) + '\n',
  )
  await createOnce(join(profile, 'cordis.patch.yml'), '[]\n')
  await createOnce(join(home, 'cordis.patch.yml'), '[]\n')
  // Only the small writable Profile owns fallback links. Installed packages
  // stay in the immutable payload, including when DSH heals its fallback map.
  const modules = join(profile, 'node_modules')
  await mkdir(modules, { recursive: true })
  const sourceModules = join(seedProfile, 'node_modules')
  const names: string[] = []
  for (const name of await readdir(sourceModules)) {
    if (name.startsWith('.')) continue
    if (name.startsWith('@'))
      for (const scoped of await readdir(join(sourceModules, name))) names.push(`${name}/${scoped}`)
    else names.push(name)
  }
  for (const name of names) {
    const link = join(modules, name)
    await mkdir(dirname(link), { recursive: true })
    let existingLink
    try {
      existingLink = await lstat(link)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (existingLink && (!existingLink.isSymbolicLink() || !within(canonicalPath(versions), canonicalPath(link))))
      throw new Error(`Desktop dependency ${name} is not application-owned; preserving it for manual migration`)
    const temporary = `${link}.nook-${randomUUID()}`
    await symlink(join(sourceModules, name), temporary, 'junction')
    try {
      // Windows cannot rename over a directory junction. The broker holds the
      // runtime lock; only verified application-owned links may be replaced.
      if (process.platform === 'win32' && existingLink) await rm(link)
      await rename(temporary, link)
    } finally {
      await rm(temporary, { force: true })
    }
  }
  const cwd = join(state, 'workspace')
  await mkdir(cwd, { recursive: true })
  const dsh = join(seedProfile, 'node_modules', '@deepseek-ai', 'dsh')
  const metadata = JSON.parse(await readFile(join(dsh, 'package.json'), 'utf8'))
  if (typeof metadata.bin?.dsh !== 'string' || !within(dsh, resolve(dsh, metadata.bin.dsh)))
    throw new Error('Invalid DSH CLI manifest')
  return {
    home,
    node,
    supervisor,
    bin: resolve(dsh, metadata.bin.dsh),
    cwd,
    profile: 'nook',
  }
}
