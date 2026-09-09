import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { acquireDataLock, createBackup, physicalPath, restoreBackup, verifyBackup } from './index.js'

interface Receipt {
  version: 1
  status: 'prepared' | 'complete'
  source: string
  target: string
  staging: string
  retained: string
  sourceBackup: string
  targetBackup?: string
  mergedBackup: string
}

function receiptPath(source: string, output: string) {
  const key = createHash('sha256').update(physicalPath(source)).digest('hex')
  return join(output, 'migrations', `${key}.json`)
}

export function migrationComplete(source: string, output: string): boolean {
  const path = receiptPath(source, output)
  if (!existsSync(path)) return false
  const receipt = JSON.parse(readFileSync(path, 'utf8')) as Receipt
  return receipt.version === 1 && receipt.status === 'complete' && receipt.source === physicalPath(source)
}

function writeReceipt(path: string, receipt: Receipt) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  writeFileSync(temporary, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600, flag: 'wx', flush: true })
  renameSync(temporary, path)
  syncDirectory(dirname(path))
  syncDirectory(dirname(dirname(path)))
}

function syncDirectory(path: string) {
  const fd = openSync(path, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/** Refuse to start an empty store while a previous directory handoff is pending. */
export function resumeMigrations(target: string, output: string): void {
  const directory = join(output, 'migrations')
  if (!existsSync(directory)) return
  for (const name of readdirSync(directory).filter(name => name.endsWith('.json'))) {
    const receipt = JSON.parse(readFileSync(join(directory, name), 'utf8')) as Receipt
    if (receipt.version !== 1 || !['prepared', 'complete'].includes(receipt.status))
      throw new Error('Invalid migration receipt')
    if (receipt.status !== 'prepared') continue
    if (receipt.target !== physicalPath(target) || !existsSync(receipt.source))
      throw new Error('Pending data migration requires inspection before Nook can start')
    migrateData(receipt.source, target, output)
  }
}

function equivalent(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical)
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, canonical(item)]),
      )
    return value
  }
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

function mergeProjects(source: string, target: string) {
  const incoming = JSON.parse(readFileSync(source, 'utf8'))
  const current = JSON.parse(readFileSync(target, 'utf8'))
  for (const store of [incoming, current])
    if (
      store.version !== 1 ||
      !Array.isArray(store.projects) ||
      store.projects.some((p: { id?: unknown }) => typeof p?.id !== 'string')
    )
      throw new Error('Unsupported project data during migration')
  const projects = new Map<string, unknown>(current.projects.map((p: { id: string }) => [p.id, p]))
  for (const project of incoming.projects) {
    if (projects.has(project.id) && !equivalent(projects.get(project.id), project))
      throw new Error(`Migration conflict in project ${project.id}; both originals and backups are preserved`)
    projects.set(project.id, project)
  }
  writeFileSync(target, JSON.stringify({ version: 1, projects: [...projects.values()] }, null, 2) + '\n', {
    mode: 0o600,
    flush: true,
  })
}

function mergeNotebook(source: string, target: string) {
  // Identical snapshots can move with their complete sync history and binding.
  const identical = readFileSync(source).equals(readFileSync(target))
  const incoming = new DatabaseSync(source, { readOnly: true })
  const current = new DatabaseSync(target)
  try {
    for (const db of [incoming, current]) {
      if (!identical && db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='sync_state'").get())
        throw new Error(
          'Cannot automatically merge different sync-enabled notebooks; preserve both libraries and use data sync to reconcile them. Originals and verified backups are retained.',
        )
    }
    // These are Nook-owned schemas, verified against provider-notebook-local.
    const expected = {
      notes: [
        'id',
        'title',
        'markdown',
        'project_id',
        'pinned',
        'created_at',
        'updated_at',
        'deleted_at',
        'revision',
        'source',
      ],
      chunks: ['id', 'note_id', 'start', 'end', 'text'],
      knowledge_sessions: ['id', 'enabled', 'project_id'],
      knowledge_fts: ['terms'],
    }
    const syncExpected = current.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='sync_state'").get()
      ? {
          projects: ['id', 'data', 'deleted'],
          sync_versions: ['hash', 'body', 'pending'],
          sync_heads: ['key', 'hash'],
          sync_working: ['key', 'hash'],
          sync_state: ['key', 'value'],
        }
      : {}
    const allExpected = { ...expected, ...syncExpected }
    const tables = new Set([
      ...Object.keys(allExpected),
      'knowledge_fts_data',
      'knowledge_fts_idx',
      'knowledge_fts_content',
      'knowledge_fts_docsize',
      'knowledge_fts_config',
    ])
    for (const db of [incoming, current]) {
      for (const row of db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all())
        if (!String(row.name).startsWith('sqlite_') && !tables.has(String(row.name)))
          throw new Error(`Unsupported notebook table: ${row.name}`)
      for (const [table, names] of Object.entries(allExpected))
        if (
          !equivalent(
            db
              .prepare(`PRAGMA table_info(${table})`)
              .all()
              .map(row => row.name),
            names,
          )
        )
          throw new Error(`Unsupported notebook schema: ${table}`)
    }
    if (identical) return
    current.exec('BEGIN IMMEDIATE')
    for (const table of ['notes', 'knowledge_sessions'] as const) {
      const columns = expected[table]
      const insert = current.prepare(
        `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
      )
      for (const row of incoming.prepare(`SELECT * FROM ${table}`).all()) {
        const existing = current.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(row.id!)
        if (existing) {
          if (!equivalent(existing, row))
            throw new Error(`Migration conflict in ${table} ${row.id}; both originals and backups are preserved`)
          continue
        }
        insert.run(...columns.map(name => row[name] as SQLInputValue))
        if (table === 'notes')
          for (const chunk of incoming.prepare('SELECT * FROM chunks WHERE note_id = ? ORDER BY id').all(row.id!)) {
            const result = current
              .prepare('INSERT INTO chunks(note_id,start,end,text) VALUES(?,?,?,?)')
              .run(chunk.note_id!, chunk.start!, chunk.end!, chunk.text!)
            const fts = incoming.prepare('SELECT terms FROM knowledge_fts WHERE rowid = ?').get(chunk.id!)
            if (!fts) throw new Error('Missing knowledge index during migration')
            current
              .prepare('INSERT INTO knowledge_fts(rowid,terms) VALUES(?,?)')
              .run(result.lastInsertRowid, fts.terms!)
          }
      }
    }
    current.exec('COMMIT')
    const integrity = current.prepare('PRAGMA integrity_check').all()
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok')
      throw new Error('Merged notebook integrity check failed')
  } finally {
    incoming.close()
    current.close()
  }
}

function sameSnapshot(left: string, right: string): boolean {
  const a = verifyBackup(left)
  const b = verifyBackup(right)
  return equivalent(a.files, b.files) && equivalent(a.directories, b.directories)
}

function finish(receipt: Receipt, path: string, output: string): Receipt {
  const { target, staging, retained, mergedBackup, targetBackup } = receipt
  if (existsSync(staging)) {
    if (!sameSnapshot(createBackup(staging, output, 'verify-migration-staging'), mergedBackup))
      throw new Error('Migration staging changed; preserved for inspection')
    if (existsSync(target)) {
      if (
        existsSync(retained) ||
        !targetBackup ||
        !sameSnapshot(createBackup(target, output, 'verify-migration-target'), targetBackup)
      )
        throw new Error('Migration target changed; preserved for inspection')
      renameSync(target, retained)
      syncDirectory(dirname(target))
    }
    renameSync(staging, target)
    syncDirectory(dirname(target))
  } else if (
    !existsSync(target) ||
    !sameSnapshot(createBackup(target, output, 'verify-migration-commit'), mergedBackup)
  ) {
    throw new Error('Incomplete migration; preserved backups require inspection')
  }
  receipt.status = 'complete'
  writeReceipt(path, receipt)
  return receipt
}

/** Merge only Nook business data. Both source trees and verified snapshots survive. */
export function migrateData(source: string, target: string, output: string): Receipt | undefined {
  source = physicalPath(source)
  target = physicalPath(target)
  output = physicalPath(output)
  if (!existsSync(source)) return undefined
  const related = (a: string, b: string) => {
    const part = relative(a, b)
    return !part || (!isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`))
  }
  if (related(source, target) || related(target, source)) throw new Error('Migration directories must be separate')
  if (realpathSync(source) === (existsSync(target) ? realpathSync(target) : target))
    throw new Error('Migration source and target must differ')
  const path = receiptPath(source, output)
  if (migrationComplete(source, output)) {
    const receipt = JSON.parse(readFileSync(path, 'utf8')) as Receipt
    if (receipt.target !== target) throw new Error('Source was already migrated to a different target')
    return receipt
  }
  const releases: (() => void)[] = []
  try {
    for (const directory of [source, target].sort()) releases.push(acquireDataLock(directory))
    if (existsSync(path)) {
      const receipt = JSON.parse(readFileSync(path, 'utf8')) as Receipt
      if (
        receipt.version !== 1 ||
        receipt.status !== 'prepared' ||
        receipt.source !== source ||
        receipt.target !== target ||
        dirname(receipt.staging) !== dirname(target) ||
        !receipt.staging.startsWith(join(dirname(target), '.nook-merge-')) ||
        dirname(receipt.retained) !== dirname(target) ||
        !receipt.retained.startsWith(`${target}.before-merge-`)
      )
        throw new Error('Invalid migration receipt')
      return finish(receipt, path, output)
    }
    const sourceBackup = createBackup(source, output, 'before-web-data-migration')
    const targetBackup = existsSync(target) ? createBackup(target, output, 'before-desktop-data-migration') : undefined
    const staging = join(dirname(target), `.nook-merge-${randomUUID()}`)
    if (targetBackup) restoreBackup(targetBackup, staging)
    else mkdirSync(staging, { recursive: true, mode: 0o700 })
    const sourceManifest = verifyBackup(sourceBackup)
    for (const directory of sourceManifest.directories)
      mkdirSync(join(staging, directory), { recursive: true, mode: 0o700 })
    for (const file of sourceManifest.files) {
      const incoming = join(sourceBackup, 'data', file.path)
      const destination = join(staging, file.path)
      if (!existsSync(destination)) {
        copyFileSync(incoming, destination)
        if (file.path === 'notebook.sqlite') mergeNotebook(incoming, destination)
        else if (file.path === 'projects.json') mergeProjects(incoming, destination)
      } else if (file.path === 'notebook.sqlite') mergeNotebook(incoming, destination)
      else if (file.path === 'projects.json') mergeProjects(incoming, destination)
      else if (!readFileSync(incoming).equals(readFileSync(destination)))
        throw new Error(`Migration file conflict: ${file.path}; both originals and backups are preserved`)
    }
    const mergedBackup = createBackup(staging, output, 'merged-web-and-desktop-data')
    const receipt: Receipt = {
      version: 1,
      status: 'prepared',
      source,
      target,
      staging,
      retained: `${target}.before-merge-${randomUUID()}`,
      sourceBackup,
      ...(targetBackup ? { targetBackup } : {}),
      mergedBackup,
    }
    writeReceipt(path, receipt)
    return finish(receipt, path, output)
  } finally {
    for (const release of releases.reverse()) release()
  }
}
