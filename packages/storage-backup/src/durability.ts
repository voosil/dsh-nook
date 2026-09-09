import { closeSync, fsyncSync, lstatSync, openSync, renameSync } from 'node:fs'
import { createRequire } from 'node:module'
import { toNamespacedPath } from 'node:path'

/** Windows file flushes require write access; Node cannot flush directory handles. */
export function syncPath(path: string): void {
  if (process.platform === 'win32' && lstatSync(path).isDirectory()) return
  const fd = openSync(path, process.platform === 'win32' ? 'r+' : 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/** Publish already-flushed contents with Windows write-through namespace updates. */
export function durableRename(source: string, destination: string, replace = false): void {
  if (process.platform !== 'win32') return renameSync(source, destination)
  const koffi = createRequire(import.meta.url)('koffi') as typeof import('koffi')
  const library = koffi.load('kernel32.dll')
  try {
    const move = library.func('__stdcall', 'MoveFileExW', 'int', ['str16', 'str16', 'uint'])
    const lastError = library.func('__stdcall', 'GetLastError', 'uint', [])
    if (!move(toNamespacedPath(source), toNamespacedPath(destination), 8 | (replace ? 1 : 0)))
      throw new Error(`Cannot publish backup data: MoveFileExW failed (${lastError()}): ${source} -> ${destination}`)
  } finally {
    library.unload()
  }
}
