import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { setTimeout } from 'node:timers/promises'

async function collect(directory, accept, result = new Map(), base = directory) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return result
    throw error
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '__pycache__') continue
    const file = resolve(directory, entry.name)
    const path = relative(base, file).replaceAll('\\', '/')
    if (!accept(path, entry.isDirectory())) continue
    if (entry.isDirectory()) await collect(file, accept, result, base)
    else {
      try {
        result.set(
          path,
          createHash('sha256')
            .update(await readFile(file))
            .digest('hex'),
        )
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
  }
  return result
}

export async function sourceSnapshot(root) {
  const files = await collect(resolve(root, 'packages'), path => !/^[^/]+\/lib(?:\/|$)/.test(path))
  for (const [name, value] of await collect(resolve(root, 'scripts/sync-server'), () => true))
    files.set('scripts/sync-server/' + name, value)
  for (const name of [
    'package.json',
    'tsconfig.json',
    'tsconfig.base.json',
    'tsconfig.package.json',
    'pnpm-workspace.yaml',
  ]) {
    try {
      files.set(name, await readFile(resolve(root, name), 'utf8'))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return files
}

export function hostSnapshot(root) {
  return collect(resolve(root, 'packages'), (path, directory) =>
    directory
      ? !path.split('/').includes('src') && !path.split('/').includes('client')
      : /\/lib\/(?!client[./]).*\.js$/.test(path),
  )
}

function changed(before, after) {
  return [...new Set([...before.keys(), ...after.keys()])].filter(key => before.get(key) !== after.get(key))
}

/** Serialized polling supports atomic saves and linked workspaces without native watcher limits. */
export async function watchSources({ root, initial, signal, build, restart, report = console.log }) {
  let sources = initial
  let host = await hostSnapshot(root)
  while (!signal.aborted) {
    try {
      await setTimeout(300, undefined, { signal })
    } catch (error) {
      if (signal.aborted) break
      throw error
    }
    const next = await sourceSnapshot(root)
    const changes = changed(sources, next)
    if (!changes.length) continue
    sources = next
    report(`[nook dev] Rebuilding (${changes.length} changed files)…`)
    try {
      await build()
      if (signal.aborted) break
      const nextHost = await hostSnapshot(root)
      if (changed(host, nextHost).length || changes.some(path => !path.includes('/src/client/'))) {
        await restart()
        report('[nook dev] Host restarted.')
      } else {
        report('[nook dev] Client updated.')
      }
      host = nextHost
    } catch (error) {
      if (!signal.aborted) report(`[nook dev] Build/reload failed; waiting for the next edit. ${error.message}`)
    }
  }
}
