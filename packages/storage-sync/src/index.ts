import { createHash, randomUUID } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { writeRecoveryRecord } from '@nook-dsh/storage-backup'
import { durableRename, syncPath } from '@nook-dsh/storage-backup/durability'
import { historyRewriteMigration, planHistoryRewrite } from './history-rewrite.js'
import {
  canonicalJson,
  SyncError,
  recordKey,
  validateVersion,
  epochBaseline,
  syncEpoch,
  validateEpochTransition,
  type Json,
  type BlobRef,
  type RecordVersion,
  type SyncIndex,
  type SyncReplica,
  type VersionItem,
  type SyncConflict,
  type SyncTypeHandler,
  type RecordWrite,
  type SyncEpochMigration,
  type SyncEpochTransition,
} from '@nook-dsh/capability-sync'

export function encode(value: unknown): Uint8Array {
  return Buffer.from(canonicalJson(value))
}
export function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
export function versionHash(value: RecordVersion): string {
  return digest(encode(value))
}
export type RecordHandler = SyncTypeHandler
/** One transaction owner shared with business storage. Remote versions remain recoverable. */
export class Replica implements SyncReplica {
  private readonly lifecycle = new AbortController()
  private depth = 0
  private changed = false
  private readonly listeners = new Set<() => void>()
  private readonly handlers = new Map<string, RecordHandler>()
  private readonly migrations = new Map<string, SyncEpochMigration>()
  afterApply: () => void = () => {}
  constructor(
    readonly db: DatabaseSync,
    readonly files: string,
    readonly backups: string,
    private readonly backup: () => void,
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS sync_versions(hash TEXT PRIMARY KEY, body TEXT NOT NULL, pending INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_heads(key TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(key,hash));
      CREATE TABLE IF NOT EXISTS sync_working(key TEXT PRIMARY KEY,hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);`)
    db.exec(
      'CREATE TABLE IF NOT EXISTS sync_epoch_archive(epoch TEXT NOT NULL,hash TEXT NOT NULL,body BLOB NOT NULL,PRIMARY KEY(epoch,hash))',
    )
    mkdirSync(files, { recursive: true, mode: 0o700 })
    this.registerEpochMigration(historyRewriteMigration(this.handlers))
  }
  transaction<T>(fn: () => T): T {
    if (this.depth) return fn()
    this.db.exec('BEGIN IMMEDIATE')
    this.depth++
    try {
      const value = fn()
      this.db.exec('COMMIT')
      this.depth--
      if (this.changed) {
        this.changed = false
        for (const listener of this.listeners) {
          try {
            listener()
          } catch {
            /* observers cannot roll back a commit */
          }
        }
      }
      return value
    } catch (error) {
      this.depth--
      this.changed = false
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  register(handler: RecordHandler): () => void {
    if (this.handlers.has(handler.type)) throw new Error(`Duplicate sync handler: ${handler.type}`)
    recordKey(handler.type, 'registration')
    if (!Number.isSafeInteger(handler.schema) || handler.schema < 1) throw new SyncError('无效的数据版本。')
    this.handlers.set(handler.type, handler)
    return () => {
      if (this.handlers.get(handler.type) === handler) this.handlers.delete(handler.type)
    }
  }
  registerType(handler: SyncTypeHandler) {
    return this.register(handler)
  }
  records(type: string): readonly VersionItem[] {
    return Object.entries(this.snapshot().heads)
      .filter(([key]) => key.startsWith(type + '/'))
      .map(([, heads]) => {
        const version = this.version(heads[0]!)!
        const current = this.working(type, version.id) ?? heads[0]!
        return { hash: current, value: this.version(current)! }
      })
  }
  writeRecords(writes: readonly RecordWrite[]): readonly VersionItem[] {
    return this.transaction(() => {
      const keys = new Set<string>()
      for (const write of writes) {
        const key = recordKey(write.type, write.id)
        if (keys.has(key) || this.working(write.type, write.id) !== write.expected)
          throw new SyncError('记录已变化，请重新读取。')
        keys.add(key)
        if (this.handlers.get(write.type)?.schema !== write.schema) throw new SyncError('此数据类型或版本尚未注册。')
      }
      const result = writes.map(w => {
        const hash = this.capture(w.type, w.id, w.data, w.deleted, w.blobs)
        const value = this.version(hash)!
        if (w.expected) writeRecoveryRecord(this.backups, 'record-write', { versions: [this.version(w.expected)] })
        this.handlers.get(w.type)!.apply?.(value, hash)
        return { hash, value }
      })
      this.afterApply()
      return result
    })
  }
  dispose() {
    this.lifecycle.abort()
    this.listeners.clear()
    this.handlers.clear()
    this.migrations.clear()
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
  private touch() {
    this.changed = true
    this.set('change', String(Number(this.get('change') ?? 0) + 1))
  }
  private get(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM sync_state WHERE key=?').get(key)
    return row ? String(row.value) : null
  }
  private set(key: string, value: string) {
    this.db
      .prepare('INSERT INTO sync_state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, value)
  }
  working(type: string, id: string): string | null {
    const row = this.db.prepare('SELECT hash FROM sync_working WHERE key=?').get(recordKey(type, id))
    return row ? String(row.hash) : null
  }
  version(hash: string): RecordVersion | null {
    const row = this.db.prepare('SELECT body FROM sync_versions WHERE hash=?').get(hash)
    return row ? (JSON.parse(String(row.body)) as RecordVersion) : null
  }
  private save(item: VersionItem, pending: boolean) {
    validateVersion(item.value)
    if (encode(item.value).length > 4_000_000) throw new SyncError('同步版本超出大小限制。')
    if (versionHash(item.value) !== item.hash) throw new SyncError('版本校验失败。')
    this.db
      .prepare('INSERT OR IGNORE INTO sync_versions VALUES(?,?,?)')
      .run(item.hash, JSON.stringify(item.value), pending ? 1 : 0)
  }
  private heads(key: string): string[] {
    return this.db
      .prepare('SELECT hash FROM sync_heads WHERE key=? ORDER BY hash')
      .all(key)
      .map(r => String(r.hash))
  }
  private replaceHeads(key: string, heads: readonly string[]) {
    this.db.prepare('DELETE FROM sync_heads WHERE key=?').run(key)
    for (const hash of heads) this.db.prepare('INSERT INTO sync_heads VALUES(?,?)').run(key, hash)
  }
  private setWorking(key: string, hash: string) {
    this.db
      .prepare('INSERT INTO sync_working VALUES(?,?) ON CONFLICT(key) DO UPDATE SET hash=excluded.hash')
      .run(key, hash)
  }
  ancestors(hash: string): Set<string> {
    const found = new Set<string>()
    const stack = [hash]
    while (stack.length) {
      const current = stack.pop()!
      if (found.has(current)) continue
      found.add(current)
      if (found.size > 100000) throw new SyncError('版本历史超出首版容量。')
      const v = this.version(current)
      if (!v) throw new SyncError('版本历史不完整。')
      stack.push(...v.parents)
    }
    return found
  }
  reduce(heads: readonly string[]): string[] {
    const unique = [...new Set(heads)].sort()
    const old = new Set<string>()
    for (const hash of unique) for (const parent of this.ancestors(hash)) if (parent !== hash) old.add(parent)
    return unique.filter(h => !old.has(h))
  }
  capture(
    type: string,
    id: string,
    data: Json,
    deleted = false,
    blobs: readonly BlobRef[] = [],
    parents?: readonly string[],
  ): string {
    return this.transaction(() => {
      const key = recordKey(type, id),
        previous = this.working(type, id)
      const value: RecordVersion = {
        format: 1,
        type,
        id,
        schema: this.handlers.get(type)?.schema ?? 1,
        parents: parents ?? (previous ? [previous] : []),
        deleted,
        data,
        blobs,
      }
      for (const ref of blobs) {
        const bytes = this.blob(ref.hash)
        if (!bytes || bytes.length !== ref.bytes) throw new SyncError('本地附件缺失或大小不一致。')
      }
      this.handlers.get(type)?.validate(value)
      const hash = versionHash(value)
      this.save({ hash, value }, true)
      this.replaceHeads(key, this.reduce([...this.heads(key), hash]))
      this.setWorking(key, hash)
      this.touch()
      return hash
    })
  }
  snapshot() {
    const heads: Record<string, string[]> = {}
    for (const row of this.db.prepare('SELECT key,hash FROM sync_heads ORDER BY key,hash').all())
      (heads[String(row.key)] ??= []).push(String(row.hash))
    return {
      heads,
      pending: this.db
        .prepare('SELECT hash FROM sync_versions WHERE pending=1 ORDER BY rowid')
        .all()
        .map(r => String(r.hash)),
    }
  }
  binding() {
    const value = this.get('binding')
    return value ? (JSON.parse(value) as { target: string; vaultId: string }) : null
  }
  bind(target: string, vaultId: string) {
    this.transaction(() => {
      const b = this.binding()
      if (b && (b.target !== target || b.vaultId !== vaultId))
        throw new SyncError('当前数据已绑定另一同步目录。请保留当前库，使用独立数据目录连接其他目标。')
      this.set('binding', JSON.stringify({ target, vaultId }))
    })
  }
  prepare() {
    this.backup()
  }
  acknowledge(hashes: readonly string[]) {
    this.transaction(() => {
      for (const hash of hashes) this.db.prepare('UPDATE sync_versions SET pending=0 WHERE hash=?').run(hash)
    })
  }
  hasPack(hash: string): boolean {
    return this.get(`pack/${hash}`) === '1'
  }
  remoteIndex(): SyncIndex | null {
    const value = this.get('remote')
    return value ? (JSON.parse(value) as SyncIndex) : null
  }
  registerEpochMigration(migration: SyncEpochMigration): () => void {
    const key = `${migration.id}@${migration.version}`
    if (this.migrations.has(key)) throw new SyncError('同步迁移处理器重复注册。')
    this.migrations.set(key, migration)
    return () => {
      if (this.migrations.get(key) === migration) this.migrations.delete(key)
    }
  }
  supportsEpochMigration(id: string, version: number): boolean {
    return this.migrations.has(`${id}@${version}`)
  }
  planHistoryRewrite(remove: readonly string[]) {
    const from = this.remoteIndex(),
      snapshot = this.snapshot()
    if (!from || snapshot.pending.length || canonicalJson(snapshot.heads) !== canonicalJson(from.heads))
      throw new SyncError('请先完成同步，再精简历史。')
    const versions = this.db
      .prepare('SELECT hash,body FROM sync_versions')
      .all()
      .map(row => ({
        hash: String(row.hash),
        value: JSON.parse(String(row.body)) as RecordVersion,
      }))
    return planHistoryRewrite(from, versions, remove, this.handlers)
  }
  /** A browser draft may arrive after Host migration. Rebase its archived baseline on demand. */
  rebaseSavedVersion(hash: string): string | null {
    if (this.version(hash)) return hash
    const alias = this.get(`draft-alias/${hash}`)
    if (alias && this.version(alias)) return alias
    const receipts = this.db
      .prepare("SELECT value FROM sync_state WHERE key LIKE 'epoch/%'")
      .all()
      .map(row => JSON.parse(String(row.value)) as { manifest?: SyncEpochTransition })
      .filter((r): r is { manifest: SyncEpochTransition } => Boolean(r.manifest))
      .sort((a, b) => (BigInt(a.manifest.from.generation) < BigInt(b.manifest.from.generation) ? -1 : 1))
    const first = receipts.findIndex(({ manifest }) =>
      this.db.prepare('SELECT 1 FROM sync_epoch_archive WHERE epoch=? AND hash=?').get(syncEpoch(manifest.from), hash),
    )
    if (first < 0) return null
    const staged = new Map<string, RecordVersion>()
    let result = hash
    for (const { manifest } of receipts.slice(first)) {
      const strategy = this.migrations.get(`${manifest.migration.id}@${manifest.migration.version}`)
      if (!strategy) throw new SyncError('旧草稿需要更新应用后恢复，输入已保留。')
      const memo = new Map<string, string>(),
        visiting = new Set<string>()
      const move = (id: string): string => {
        const mapped = strategy.mapped(id, manifest)
        if (mapped) return mapped
        if (memo.has(id)) return memo.get(id)!
        if (visiting.has(id)) throw new SyncError('草稿历史引用循环。')
        const row = this.db
          .prepare('SELECT body FROM sync_epoch_archive WHERE epoch=? AND hash=?')
          .get(syncEpoch(manifest.from), id)
        const value =
          staged.get(id) ??
          (row
            ? (JSON.parse(
                gunzipSync(row.body as Uint8Array, { maxOutputLength: 4_000_000 }).toString(),
              ) as RecordVersion)
            : this.version(id))
        if (!value) return id
        if (versionHash(value) !== id) throw new SyncError('旧草稿的历史归档校验失败。')
        visiting.add(id)
        const next = strategy.rewrite(value, move, manifest),
          nextHash = versionHash(next)
        staged.set(nextHash, next)
        memo.set(id, nextHash)
        visiting.delete(id)
        return nextHash
      }
      result = move(result)
    }
    this.transaction(() => {
      const todo = [result],
        needed = new Map<string, RecordVersion>()
      while (todo.length) {
        const id = todo.pop()!
        if (needed.has(id) || this.version(id)) continue
        const value = staged.get(id)
        if (!value) throw new SyncError('草稿迁移后的基线缺失。')
        needed.set(id, value)
        todo.push(...value.parents)
        for (const ref of this.handlers.get(value.type)?.references?.(value) ?? []) if (staged.has(ref)) todo.push(ref)
      }
      for (const [hash, value] of needed) this.save({ hash, value }, true)
      this.set(`draft-alias/${hash}`, result)
    })
    return result
  }
  adoptEpoch(transition: SyncEpochTransition, hash: string, items: readonly VersionItem[], packs: readonly string[]) {
    validateEpochTransition(transition)
    const previous = this.remoteIndex()
    if (
      !previous ||
      syncEpoch(previous) !== syncEpoch(transition.from) ||
      previous.vaultId !== transition.from.vaultId ||
      BigInt(previous.generation) > BigInt(transition.from.generation)
    )
      throw new SyncError('同步迁移基线不一致，已保留本地数据。')
    const strategy = this.migrations.get(`${transition.migration.id}@${transition.migration.version}`)
    if (!strategy) throw new SyncError('此数据代次需要更新应用后才能同步，本地修改已保留。')
    strategy.validate(transition)
    for (const h of Object.values(previous.heads).flat())
      if (strategy.mapped(h, transition) === undefined) throw new SyncError('同步迁移缺少已知历史的映射。')
    for (const handler of this.handlers.values())
      if (handler.apply && !handler.reset) throw new SyncError('数据 Provider 尚不支持安全切换同步代次，请升级应用。')
    const incoming = new Map(items.map(item => [item.hash, item.value]))
    const baseline = new Map<string, RecordVersion>(),
      stack = Object.values(transition.baseline.heads).flat()
    while (stack.length) {
      const id = stack.pop()!
      if (baseline.has(id)) continue
      const value = incoming.get(id) ?? this.version(id)
      if (!value || versionHash(value) !== id || baseline.size >= 100000) throw new SyncError('新同步基线不完整。')
      baseline.set(id, value)
      stack.push(...value.parents)
    }
    const pending = new Map<string, RecordVersion>(),
      rebased = new Map<string, string>(),
      visiting = new Set<string>()
    const rewrite = (id: string): string => {
      const known = strategy.mapped(id, transition)
      if (known) {
        if (!baseline.has(known)) throw new SyncError('迁移映射指向缺失的版本。')
        return known
      }
      if (rebased.has(id)) return rebased.get(id)!
      if (visiting.has(id)) throw new SyncError('本地修改的迁移引用循环。')
      const value = this.version(id)
      if (!value) return id // An external version reference may not belong to this vault.
      visiting.add(id)
      const next = strategy.rewrite(value, rewrite, transition),
        mapped = versionHash(next)
      rebased.set(id, mapped)
      pending.set(mapped, next)
      visiting.delete(id)
      if (pending.size + baseline.size > 100000) throw new SyncError('迁移后的历史超出容量。')
      return mapped
    }
    // Recreate only genuinely local branches. Mapped/pruned published versions stay retired.
    for (const id of this.snapshot().pending) if (strategy.mapped(id, transition) === undefined) rewrite(id)
    for (const value of pending.values())
      for (const parent of value.parents) {
        const ancestor = pending.get(parent) ?? baseline.get(parent)
        if (!ancestor || recordKey(ancestor.type, ancestor.id) !== recordKey(value.type, value.id))
          throw new SyncError('迁移后的本地修改引用了错误的记录。')
      }
    this.backup()
    const recovery = writeRecoveryRecord(this.backups, 'before-sync-epoch', {
      transition: hash,
      versions: this.db.prepare('SELECT * FROM sync_versions').all(),
      heads: this.db.prepare('SELECT * FROM sync_heads').all(),
      working: this.db.prepare('SELECT * FROM sync_working').all(),
      state: this.db.prepare('SELECT * FROM sync_state').all(),
    })
    this.transaction(() => {
      for (const row of this.db.prepare('SELECT hash,body FROM sync_versions').all())
        this.db
          .prepare('INSERT OR IGNORE INTO sync_epoch_archive VALUES(?,?,?)')
          .run(syncEpoch(previous), String(row.hash), gzipSync(Buffer.from(String(row.body))))
      for (const handler of this.handlers.values()) handler.reset?.()
      this.db.exec(
        "DELETE FROM sync_versions; DELETE FROM sync_heads; DELETE FROM sync_working; DELETE FROM sync_state WHERE key='remote' OR key LIKE 'pack/%';",
      )
      this.receive(
        [...baseline].map(([hash, value]) => ({ hash, value })),
        epochBaseline(transition, hash),
        packs,
      )
      for (const [hash, value] of pending) {
        this.save({ hash, value }, true)
      }
      for (const [hash, value] of pending) {
        const key = recordKey(value.type, value.id)
        this.replaceHeads(key, this.reduce([...this.heads(key), hash]))
      }
      for (const key of new Set([...pending.values()].map(v => recordKey(v.type, v.id)))) {
        const heads = this.heads(key)
        if (heads.length !== 1) continue
        const value = this.version(heads[0]!)!,
          handler = this.handlers.get(value.type)
        if (handler?.schema === value.schema) {
          handler.validate(value)
          handler.apply?.(value, heads[0]!)
          this.setWorking(key, heads[0]!)
        }
      }
      this.afterApply()
      this.set(`epoch/${transition.epoch}`, JSON.stringify({ transition: hash, recovery, manifest: transition }))
      this.touch()
    })
  }
  receive(items: readonly VersionItem[], remote: SyncIndex, packs: readonly string[] = []) {
    this.transaction(() => {
      for (const item of items) this.save(item, false)
      const before = this.get('remote')
      const previous = before ? (JSON.parse(before) as SyncIndex) : null
      if (previous) {
        if (
          previous.vaultId !== remote.vaultId ||
          syncEpoch(previous) !== syncEpoch(remote) ||
          BigInt(previous.generation) > BigInt(remote.generation) ||
          (previous.generation === remote.generation && canonicalJson(previous) !== canonicalJson(remote))
        )
          throw new SyncError('远端索引发生回退或被替换，已停止同步以保留数据。')
        for (const [key, heads] of Object.entries(previous.heads)) {
          if (canonicalJson(heads) === canonicalJson(remote.heads[key] ?? [])) continue
          const reachable = new Set((remote.heads[key] ?? []).flatMap(h => [...this.ancestors(h)]))
          if (heads.some(h => !reachable.has(h))) throw new SyncError('远端版本历史缺失，已停止同步。')
        }
      }
      const apply: VersionItem[] = []
      for (const [key, heads] of Object.entries(remote.heads)) {
        const unchanged = canonicalJson(previous?.heads[key] ?? []) === canonicalJson(heads)
        for (const h of unchanged ? [] : heads) {
          const value = this.version(h)!
          if (recordKey(value.type, value.id) !== key) throw new SyncError('远端记录标识与索引不一致。')
          for (const parent of this.ancestors(h)) {
            const p = this.version(parent)!
            if (recordKey(p.type, p.id) !== key) throw new SyncError('远端版本跨记录引用。')
            this.db.prepare('UPDATE sync_versions SET pending=0 WHERE hash=?').run(parent)
          }
        }
        const merged = unchanged ? this.heads(key) : this.reduce([...this.heads(key), ...heads])
        if (!unchanged) this.replaceHeads(key, merged)
        const old = this.db.prepare('SELECT hash FROM sync_working WHERE key=?').get(key)
        const selected = merged.length === 1 ? merged[0]! : old ? String(old.hash) : merged[0]!
        if (old?.hash !== selected) {
          const value = this.version(selected)!
          const handler = this.handlers.get(value.type)
          if (handler?.schema === value.schema) {
            handler.validate(value)
            apply.push({ hash: selected, value })
          }
        }
      }
      if (apply.length) {
        const originals = apply
          .map(({ value }) => {
            const h = this.working(value.type, value.id)
            return h ? this.version(h) : null
          })
          .filter(v => v !== null)
        if (originals.length) writeRecoveryRecord(this.backups, 'sync-receive', { versions: originals })
        // Registration order is the dependency order owned by business storage.
        for (const handler of this.handlers.values())
          for (const item of apply.filter(i => i.value.type === handler.type)) {
            handler.apply?.(item.value, item.hash)
            this.setWorking(recordKey(item.value.type, item.value.id), item.hash)
          }
        this.afterApply()
        this.touch()
      }
      this.set('remote', JSON.stringify(remote))
      for (const hash of packs) this.set(`pack/${hash}`, '1')
    })
  }
  conflicts(): readonly SyncConflict[] {
    return Object.entries(this.snapshot().heads)
      .filter(([, h]) => h.length > 1)
      .map(([key, heads]) => {
        const v = this.version(heads[0]!)!
        return { key, type: v.type, id: v.id, versions: heads.map(hash => ({ hash, value: this.version(hash)! })) }
      })
  }
  history(type: string, id: string): readonly VersionItem[] {
    const hashes = new Set<string>()
    for (const head of this.heads(recordKey(type, id)))
      for (const hash of this.ancestors(head)) {
        hashes.add(hash)
        if (hashes.size > 100000) throw new SyncError('版本历史超出首版容量。')
      }
    return [...hashes].map(hash => ({ hash, value: this.version(hash)! }))
  }
  /** Durable local branch first; merging may run outside the SQLite transaction. */
  writeBranch(type: string, id: string, data: Json, deleted: boolean, parents?: readonly string[]) {
    return this.transaction(() => {
      const old = this.working(type, id)
      if (old) writeRecoveryRecord(this.backups, 'record-write', { versions: [this.version(old)] })
      const hash = this.capture(type, id, data, deleted, [], parents)
      this.handlers.get(type)!.apply?.(this.version(hash)!, hash)
      this.afterApply()
      return hash
    })
  }
  async reconcile(signal?: AbortSignal): Promise<void> {
    const cancellation = signal ? AbortSignal.any([signal, this.lifecycle.signal]) : this.lifecycle.signal
    // Business registration order keeps project projections ahead of note projections.
    for (const handler of this.handlers.values()) {
      if (!handler.merge) continue
      for (const conflict of this.conflicts().filter(c => c.type === handler.type)) {
        for (let attempt = 0; attempt < 16; attempt++) {
          cancellation.throwIfAborted()
          const heads = this.heads(conflict.key)
          if (heads.length < 2) break
          const versions = this.history(conflict.type, conflict.id)
          if (versions.some(v => v.value.schema !== handler.schema)) break
          for (const item of versions) handler.validate(item.value)
          const merged = await handler.merge({ heads, versions }, cancellation)
          cancellation.throwIfAborted()
          const committed = this.transaction(() => {
            if (canonicalJson(this.heads(conflict.key)) !== canonicalJson(heads)) return false
            const old = this.working(conflict.type, conflict.id)
            writeRecoveryRecord(this.backups, 'sync-auto-merge', {
              versions: [...new Set([...heads, ...(old ? [old] : [])])].map(hash => this.version(hash)),
            })
            const hash = this.capture(conflict.type, conflict.id, merged.data, merged.deleted, merged.blobs, heads)
            handler.apply?.(this.version(hash)!, hash)
            this.afterApply()
            return true
          })
          if (committed) break
          if (attempt === 15) throw new SyncError('内容仍在更新，自动合并将重试。')
        }
      }
    }
  }
  resolve(key: string, expected: readonly string[], selected: string, copy: boolean) {
    this.transaction(() => {
      const heads = this.heads(key)
      if (JSON.stringify([...expected].sort()) !== JSON.stringify(heads) || !heads.includes(selected))
        throw new SyncError('冲突版本已经变化，请重新查看。')
      const value = this.version(selected)!,
        handler = this.handlers.get(value.type)
      if (!handler || handler.schema !== value.schema) throw new SyncError('请升级应用以处理此数据类型。')
      if (copy && !handler.copy) throw new SyncError('此数据类型不支持另存副本。')
      writeRecoveryRecord(this.backups, 'sync-resolve', { versions: heads.map(h => this.version(h)) })
      if (copy) {
        for (const h of heads.filter(h => h !== selected)) {
          const v = this.version(h)!
          const id = randomUUID()
          const data = handler.copy!(v, id)
          const hash = this.capture(v.type, id, data, false, v.blobs, [])
          handler.apply?.(this.version(hash)!, hash)
        }
      }
      const hash = this.capture(value.type, value.id, value.data, value.deleted, value.blobs, heads)
      handler.apply?.(this.version(hash)!, hash)
      this.afterApply()
    })
  }
  stats() {
    const snapshot = this.snapshot()
    return {
      pending: snapshot.pending.length,
      conflicts: Object.values(snapshot.heads).filter(h => h.length > 1).length,
      unsupported: Object.values(snapshot.heads).filter(heads =>
        heads.some(h => {
          const v = this.version(h)!
          return this.handlers.get(v.type)?.schema !== v.schema
        }),
      ).length,
      change: Number(this.get('change') ?? 0),
    }
  }
  blob(hash: string) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new SyncError('无效的文件标识。')
    const file = join(this.files, hash)
    if (!existsSync(file)) return null
    const bytes = readFileSync(file)
    if (digest(bytes) !== hash) throw new SyncError('本地文件校验失败。')
    return bytes
  }
  receiveBlob(ref: BlobRef, bytes: Uint8Array) {
    if (!Number.isSafeInteger(ref.bytes) || ref.bytes < 0 || ref.bytes > 20_000_000)
      throw new SyncError('同步文件超出大小限制。')
    if (bytes.length !== ref.bytes || digest(bytes) !== ref.hash) throw new SyncError('文件大小或内容校验失败。')
    if (this.blob(ref.hash)) return
    const temp = join(this.files, `.partial-${randomUUID()}`)
    writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600 })
    syncPath(temp)
    durableRename(temp, join(this.files, ref.hash))
    syncPath(this.files)
  }
}
