import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  copyFileSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

interface Entry {
  path: string
  bytes: number
  sha256: string
}
export interface BackupManifest {
  format: 'nook-backup'
  version: 1
  kind: 'directory' | 'recovery-record'
  createdAt: string
  reason: string
  directories: string[]
  files: Entry[]
}

function syncPath(path: string): void {
  const fd = openSync(path, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

function durableWrite(path: string, data: string): void {
  writeFileSync(path, data, { flag: 'wx', mode: 0o600, flush: true })
}

function durableDirectory(path: string): void {
  const firstCreated = mkdirSync(path, { recursive: true, mode: 0o700 })
  if (!firstCreated) return
  // Flush each new directory entry, including the entry in its existing parent.
  const parent = dirname(resolve(firstCreated))
  for (let current = resolve(path); ; current = dirname(current)) {
    syncPath(current)
    if (current === parent) break
  }
}

function fingerprint(path: string): Omit<Entry, 'path'> {
  if (!lstatSync(path).isFile()) throw new Error(`Backup requires a regular file: ${path}`)
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const hash = createHash('sha256')
    const buffer = Buffer.alloc(1024 * 1024)
    let bytes = 0
    let count: number
    while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      bytes += count
      hash.update(buffer.subarray(0, count))
    }
    return { bytes, sha256: hash.digest('hex') }
  } finally {
    closeSync(fd)
  }
}

function tree(root: string): { directories: string[]; files: string[] } {
  const directories: string[] = []
  const files: string[] = []
  const walk = (path: string) => {
    const info = lstatSync(path)
    const name = relative(root, path).split(sep).join('/')
    if (info.isDirectory()) {
      if (name) directories.push(name)
      for (const child of readdirSync(path).sort()) walk(join(path, child))
    } else if (info.isFile()) files.push(name)
    else throw new Error(`Backup refuses symlinks and special files: ${path}`)
  }
  walk(root)
  return { directories: directories.sort(), files: files.sort() }
}

function within(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return !rel || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

// Resolve existing ancestors as well, so a symlink cannot hide a nested destination.
function physicalPath(path: string): string {
  const absolute = resolve(path)
  if (existsSync(absolute)) return realpathSync(absolute)
  return join(physicalPath(dirname(absolute)), basename(absolute))
}

function requireSeparate(source: string, destination: string): void {
  const left = physicalPath(source)
  const right = physicalPath(destination)
  if (within(left, right) || within(right, left))
    throw new Error('Backup source and destination must be separate, non-nested directories')
}

function publish(directory: string, manifest: BackupManifest): string {
  durableWrite(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  verifyBackup(directory)
  for (const child of [...manifest.directories].reverse()) syncPath(join(directory, 'data', child))
  syncPath(join(directory, 'data'))
  syncPath(directory)
  const destination = join(dirname(directory), `${manifest.createdAt.replaceAll(':', '-')}-${randomUUID()}`)
  renameSync(directory, destination)
  syncPath(dirname(destination))
  return destination
}

function staging(output: string): string {
  durableDirectory(output)
  const directory = mkdtempSync(join(output, '.partial-'))
  mkdirSync(join(directory, 'data'), { mode: 0o700 })
  return directory
}

/** A durable, verified pre-mutation record. Any failure must abort the mutation. */
export function writeRecoveryRecord(output: string, reason: string, value: unknown): string {
  const serialized = `${JSON.stringify(value, null, 2)}\n`
  const directory = staging(resolve(output))
  const file = join(directory, 'data', 'record.json')
  durableWrite(file, serialized)
  return publish(directory, {
    format: 'nook-backup',
    version: 1,
    kind: 'recovery-record',
    createdAt: new Date().toISOString(),
    reason,
    directories: [],
    files: [
      {
        path: 'record.json',
        bytes: Buffer.byteLength(serialized),
        sha256: createHash('sha256').update(serialized).digest('hex'),
      },
    ],
  })
}

function isSqlite(path: string): boolean {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const header = Buffer.alloc(16)
    return readSync(fd, header, 0, 16, 0) === 16 && header.toString() === 'SQLite format 3\0'
  } finally {
    closeSync(fd)
  }
}

function checkSqlite(path: string): void {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const result = db.prepare('PRAGMA integrity_check').all()
    if (result.length !== 1 || result[0]?.integrity_check !== 'ok') throw new Error(`Invalid SQLite backup: ${path}`)
  } finally {
    db.close()
  }
}

/** Caller must stop all writers; SQLite snapshots also include committed WAL data. */
export function createBackup(source: string, output: string, reason = 'manual'): string {
  source = resolve(source)
  output = resolve(output)
  requireSeparate(source, output)
  if (!lstatSync(source).isDirectory()) throw new Error('Backup source must be a directory, not a symlink')
  const before = tree(source)
  const originals = new Map(before.files.map(path => [path, fingerprint(join(source, path))]))
  const databases = new Set(before.files.filter(path => isSqlite(join(source, path))))
  const sidecar = (path: string) => /-(wal|shm)$/.test(path) && databases.has(path.slice(0, -4))
  const directory = staging(output)
  const files: Entry[] = []
  for (const child of before.directories) mkdirSync(join(directory, 'data', child), { mode: 0o700 })
  for (const path of before.files) {
    if (sidecar(path)) continue
    const target = join(directory, 'data', path)
    if (databases.has(path)) {
      const db = new DatabaseSync(join(source, path), { readOnly: true })
      try {
        db.exec('PRAGMA busy_timeout=5000')
        db.prepare('VACUUM INTO ?').run(target)
      } finally {
        db.close()
      }
      chmodSync(target, 0o600)
      checkSqlite(target)
    } else {
      copyFileSync(join(source, path), target, constants.COPYFILE_EXCL)
      chmodSync(target, 0o600)
      if (JSON.stringify(fingerprint(target)) !== JSON.stringify(originals.get(path)))
        throw new Error(`Source changed during backup: ${path}`)
    }
    syncPath(target)
    files.push({ path, ...fingerprint(target) })
  }
  // Opening a clean WAL database read-only creates SHM and an empty WAL itself.
  // Ignore only that new, empty WAL; existing or non-empty WALs remain checked.
  const stable = (files: string[]) =>
    files.filter(path => {
      if (!sidecar(path)) return true
      if (path.endsWith('-shm')) return false
      return originals.has(path) || fingerprint(join(source, path)).bytes !== 0
    })
  const after = tree(source)
  if (
    JSON.stringify(before.directories) !== JSON.stringify(after.directories) ||
    JSON.stringify(stable(before.files)) !== JSON.stringify(stable(after.files))
  )
    throw new Error('Source changed during backup; stop all Nook writers and retry')
  for (const path of stable(before.files)) {
    if (JSON.stringify(fingerprint(join(source, path))) !== JSON.stringify(originals.get(path)))
      throw new Error(`Source changed during backup: ${path}`)
  }
  return publish(directory, {
    format: 'nook-backup',
    version: 1,
    kind: 'directory',
    createdAt: new Date().toISOString(),
    reason,
    directories: before.directories,
    files,
  })
}

function safeRelative(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    !path.includes('\\') &&
    !path.includes('\0') &&
    !path.includes(':') &&
    !isAbsolute(path) &&
    path.split('/').every(part => part && part !== '.' && part !== '..')
  )
}

/** Reject incomplete, corrupt, extra, linked, or path-traversing backup contents. */
export function verifyBackup(directory: string): BackupManifest {
  if (!lstatSync(directory).isDirectory()) throw new Error('Backup must be a directory')
  const manifestPath = join(directory, 'manifest.json')
  if (!lstatSync(manifestPath).isFile()) throw new Error('Backup manifest must be a regular file')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BackupManifest
  if (
    !manifest ||
    manifest.format !== 'nook-backup' ||
    manifest.version !== 1 ||
    !['directory', 'recovery-record'].includes(manifest.kind) ||
    typeof manifest.reason !== 'string' ||
    typeof manifest.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(manifest.createdAt)) ||
    !Array.isArray(manifest.directories) ||
    !manifest.directories.every(safeRelative) ||
    !Array.isArray(manifest.files) ||
    !manifest.files.every(
      entry =>
        entry &&
        safeRelative(entry.path) &&
        Number.isSafeInteger(entry.bytes) &&
        entry.bytes >= 0 &&
        /^[a-f0-9]{64}$/.test(entry.sha256),
    )
  )
    throw new Error('Invalid or unsupported backup manifest')
  const contents = tree(directory)
  const expectedFiles = ['manifest.json', ...manifest.files.map(entry => `data/${entry.path}`)].sort()
  const expectedDirs = ['data', ...manifest.directories.map(path => `data/${path}`)].sort()
  if (
    JSON.stringify(contents.files) !== JSON.stringify(expectedFiles) ||
    JSON.stringify(contents.directories) !== JSON.stringify(expectedDirs)
  )
    throw new Error('Backup contents do not match manifest')
  for (const entry of manifest.files) {
    const actual = fingerprint(join(directory, 'data', entry.path))
    if (entry.bytes !== actual.bytes || entry.sha256 !== actual.sha256)
      throw new Error(`Backup checksum mismatch: ${entry.path}`)
  }
  return manifest
}

/** Restore into a new directory only; never remove or overwrite existing user data. */
export function restoreBackup(directory: string, target: string): BackupManifest {
  directory = resolve(directory)
  target = resolve(target)
  requireSeparate(directory, target)
  const manifest = verifyBackup(directory)
  durableDirectory(dirname(target))
  mkdirSync(target, { mode: 0o700 }) // EEXIST is intentional, including empty destinations.
  for (const child of manifest.directories) mkdirSync(join(target, child), { mode: 0o700 })
  for (const entry of manifest.files) {
    const destination = join(target, entry.path)
    copyFileSync(join(directory, 'data', entry.path), destination, constants.COPYFILE_EXCL)
    chmodSync(destination, 0o600)
    const actual = fingerprint(destination)
    if (entry.bytes !== actual.bytes || entry.sha256 !== actual.sha256)
      throw new Error(`Restored checksum mismatch: ${entry.path}; partial recovery retained at ${target}`)
    syncPath(destination)
  }
  for (const child of [...manifest.directories].reverse()) syncPath(join(target, child))
  syncPath(target)
  syncPath(dirname(target))
  return manifest
}

/** Coordinate repository launchers and offline backups. A crash leaves a fail-closed lock. */
export function acquireDataLock(source: string): () => void {
  const lock = `${physicalPath(source)}.lock`
  mkdirSync(dirname(lock), { recursive: true, mode: 0o700 })
  try {
    mkdirSync(lock, { mode: 0o700 })
  } catch (error) {
    throw new Error(`Nook data is locked: ${lock}. Stop Nook before backup; inspect owner.json after a crash.`, {
      cause: error,
    })
  }
  try {
    durableWrite(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }))
  } catch (error) {
    // This directory contains coordination metadata only, never user data.
    if (existsSync(join(lock, 'owner.json'))) unlinkSync(join(lock, 'owner.json'))
    rmdirSync(lock)
    throw error
  }
  let released = false
  return () => {
    if (released) return
    unlinkSync(join(lock, 'owner.json'))
    rmdirSync(lock)
    released = true
  }
}
