import { mkdirSync, existsSync, readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createBackup, writeRecoveryRecord } from '@nook-dsh/storage-backup'
import {
  NoteError,
  noteTitle,
  type NoteDto,
  type NoteInput,
  type NoteService,
  type NoteQuery,
  type NotePage,
  type CreateNoteRequest,
  type SaveNoteRequest,
  type SaveNoteResult,
  type NoteHistoryQuery,
  type NoteHistoryPage,
  type RestoreNoteRequest,
} from '@nook-dsh/capability-note'
import { Replica } from '@nook-dsh/storage-sync'
import { AutomergeAdapter } from '@nook-dsh/adapter-merge-automerge'
import { canonicalJson, SyncError, type Json, type RecordVersion, type SyncReplica } from '@nook-dsh/capability-sync'
import {
  ProjectError,
  compareProjects,
  reorderProjects,
  type ProjectDto,
  type ProjectEvent,
  type ProjectEventListener,
  type ProjectService,
  type CreateProjectRequest,
  type UpdateProjectRequest,
} from '@nook-dsh/capability-project'
import type { KnowledgeService, KnowledgeQuery, KnowledgeHit } from '@nook-dsh/capability-knowledge'

declare module '@deepseek-ai/cordis' {
  interface Context {
    nookNotes: NoteService
    nookKnowledge: KnowledgeService
    nookProjects: ProjectService
    nookSyncReplica: SyncReplica
  }
}

export interface Config {
  readonly file: string
  readonly projectsFile?: string
}
export const Config: z<Config> = z.object({ file: z.string().required(), projectsFile: z.string() })

/** CJK bigrams plus Latin words make FTS5 usable for Chinese without a model. */
export function tokens(text: string): string[] {
  const result: string[] = []
  for (const part of text
    .normalize('NFKC')
    .toLowerCase()
    .match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+|[\p{L}\p{N}_]+/gu) ?? []) {
    if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(part)) {
      const chars = [...part]
      result.push(...chars)
      for (let i = 0; i < chars.length - 1; i++) result.push(chars[i]! + chars[i + 1]!)
    } else result.push(part)
  }
  return result
}

function validate(input: NoteInput): void {
  if (
    typeof input.title !== 'string' ||
    input.title.length > 300 ||
    typeof input.markdown !== 'string' ||
    input.markdown.length > 500_000 ||
    typeof input.pinned !== 'boolean' ||
    !(input.projectId === null || typeof input.projectId === 'string')
  ) {
    throw new NoteError('INVALID_NOTE', '标题最多 300 字，正文最多 50 万字。')
  }
}

type Row = Record<string, unknown>
function fromRow(row: Row): NoteDto {
  return {
    id: String(row.id),
    title: String(row.title),
    markdown: String(row.markdown),
    projectId: row.project_id === null ? null : String(row.project_id),
    pinned: row.pinned === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deletedAt: row.deleted_at === null ? null : String(row.deleted_at),
    revision: Number(row.revision),
    source: JSON.parse(String(row.source)) as NoteDto['source'],
  }
}

class Notebook {
  readonly db: DatabaseSync
  readonly backups: string
  readonly replica?: Replica
  readonly merger = new AutomergeAdapter()
  constructor(file: string, projectsFile?: string) {
    this.backups = `${resolve(file)}.backups`
    mkdirSync(dirname(resolve(file)), { recursive: true })
    const existed = existsSync(file)
    this.db = new DatabaseSync(resolve(file))
    try {
      if (projectsFile && existed && !this.db.prepare("SELECT name FROM sqlite_schema WHERE name='sync_state'").get())
        createBackup(dirname(resolve(file)), `${dirname(resolve(file))}.sync-backups`, 'sync-schema-migration')
      this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, markdown TEXT NOT NULL, project_id TEXT, pinned INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, revision INTEGER NOT NULL, source TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS notes_project ON notes(project_id, deleted_at);
        CREATE TABLE IF NOT EXISTS chunks (id INTEGER PRIMARY KEY, note_id TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, text TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS chunks_note ON chunks(note_id);
        CREATE TABLE IF NOT EXISTS knowledge_sessions (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL, project_id TEXT);
        CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(terms);
      `)
      if (projectsFile) {
        this.replica = new Replica(this.db, `${resolve(file)}.files`, this.backups, () => {
          createBackup(dirname(resolve(file)), `${dirname(resolve(file))}.sync-backups`, 'enable-sync')
        })
        this.db.exec(
          'CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, data TEXT NOT NULL, deleted INTEGER NOT NULL)',
        )
        this.replica.register({
          type: 'project',
          schema: 1,
          validate: validateProjectVersion,
          merge: (input, signal) => this.merger.merge(input, signal),
          apply: value => {
            this.db
              .prepare(
                'INSERT INTO projects VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,deleted=excluded.deleted',
              )
              .run(value.id, JSON.stringify(value.data), value.deleted ? 1 : 0)
          },
          copy: (v, id) =>
            json({
              ...(v.data as object),
              id,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }),
        })
        this.replica.register({
          type: 'note',
          schema: 1,
          validate: validateNoteVersion,
          merge: (input, signal) => this.merger.merge(input, signal),
          apply: value => {
            const note = value.data as unknown as Omit<NoteDto, 'revision'>
            const previous = this.get(value.id)
            this.db
              .prepare(
                'INSERT INTO notes VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,markdown=excluded.markdown,project_id=excluded.project_id,pinned=excluded.pinned,created_at=excluded.created_at,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,revision=excluded.revision,source=excluded.source',
              )
              .run(
                value.id,
                note.title,
                note.markdown,
                note.projectId,
                note.pinned ? 1 : 0,
                note.createdAt,
                note.updatedAt,
                note.deletedAt,
                (previous?.revision ?? 0) + 1,
                JSON.stringify(note.source),
              )
            this.index(this.get(value.id)!)
          },
          copy: (v, id) =>
            json({
              ...(v.data as object),
              id,
              title: `${String((v.data as Record<string, Json>).title)}（冲突副本）`.slice(0, 300),
              deletedAt: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }),
        })
        this.replica.afterApply = () => this.normalizeProjects()
        this.replica.transaction(() => {
          if (!this.db.prepare("SELECT value FROM sync_state WHERE key='projects-migrated'").get()) {
            if (existsSync(projectsFile)) {
              const legacy = JSON.parse(readFileSync(projectsFile, 'utf8')) as {
                version: number
                projects: ProjectDto[]
              }
              if (legacy.version !== 1 || !Array.isArray(legacy.projects))
                throw new SyncError('旧项目文件格式不受支持。')
              for (const project of legacy.projects) {
                validateProjectVersion({
                  format: 1,
                  type: 'project',
                  id: project.id,
                  schema: 1,
                  parents: [],
                  deleted: false,
                  data: json(project),
                  blobs: [],
                })
                this.db.prepare('INSERT INTO projects VALUES(?,?,0)').run(project.id, JSON.stringify(project))
              }
            }
            this.db.prepare("INSERT INTO sync_state VALUES('projects-migrated','1')").run()
          }
          for (const row of this.db.prepare('SELECT * FROM projects').all())
            if (!this.replica!.working('project', String(row.id)))
              this.replica!.capture('project', String(row.id), JSON.parse(String(row.data)), row.deleted === 1)
          for (const row of this.db.prepare('SELECT * FROM notes').all())
            if (!this.replica!.working('note', String(row.id))) this.capture(fromRow(row))
        })
      }
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  transaction<T>(fn: () => T): T {
    if (this.replica) return this.replica.transaction(fn)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  get(id: string): NoteDto | null {
    const row = this.db.prepare('SELECT * FROM notes WHERE id = ?').get(id)
    return row ? this.withVersion(fromRow(row)) : null
  }

  withVersion(note: NoteDto): NoteDto {
    const versionId = this.replica?.working('note', note.id)
    return versionId ? { ...note, versionId } : note
  }
  capture(note: NoteDto): NoteDto {
    if (this.replica) {
      const { revision: _revision, versionId: _versionId, ...data } = note
      const versionId = this.replica.capture('note', note.id, json(data), note.deletedAt !== null)
      return { ...note, versionId }
    }
    return note
  }
  deleteProject(id: string) {
    this.transaction(() => {
      const row = this.db.prepare('SELECT data FROM projects WHERE id=? AND deleted=0').get(id)
      if (!row) throw new ProjectError('PROJECT_NOT_FOUND', '项目不存在。')
      const project = JSON.parse(String(row.data)) as ProjectDto
      const notes = this.db.prepare('SELECT * FROM notes WHERE project_id=?').all(id).map(fromRow)
      const sessions = this.db.prepare('SELECT * FROM knowledge_sessions WHERE project_id=?').all(id)
      writeRecoveryRecord(this.backups, 'delete-project', { project, notes, sessions })
      this.db.prepare('UPDATE projects SET deleted=1 WHERE id=?').run(id)
      this.replica!.capture('project', id, json(project), true)
      this.db
        .prepare('UPDATE notes SET project_id=NULL,revision=revision+1,updated_at=? WHERE project_id=?')
        .run(new Date().toISOString(), id)
      for (const note of notes) this.capture(this.get(note.id)!)
      this.db.prepare('UPDATE knowledge_sessions SET enabled=0,project_id=NULL WHERE project_id=?').run(id)
    })
  }
  normalizeProjects() {
    const notes = this.db
      .prepare(
        'SELECT * FROM notes WHERE project_id IS NOT NULL AND project_id NOT IN (SELECT id FROM projects WHERE deleted=0)',
      )
      .all()
      .map(fromRow)
    const sessions = this.db
      .prepare(
        'SELECT * FROM knowledge_sessions WHERE project_id IS NOT NULL AND project_id NOT IN (SELECT id FROM projects WHERE deleted=0)',
      )
      .all()
    if (notes.length || sessions.length) writeRecoveryRecord(this.backups, 'sync-detach-project', { notes, sessions })
    this.db
      .prepare(
        'UPDATE notes SET project_id=NULL,revision=revision+1 WHERE project_id IS NOT NULL AND project_id NOT IN (SELECT id FROM projects WHERE deleted=0)',
      )
      .run()
    this.db
      .prepare(
        'UPDATE knowledge_sessions SET project_id=NULL,enabled=0 WHERE project_id IS NOT NULL AND project_id NOT IN (SELECT id FROM projects WHERE deleted=0)',
      )
      .run()
  }
  index(note: NoteDto): void {
    this.db.prepare('DELETE FROM knowledge_fts WHERE rowid IN (SELECT id FROM chunks WHERE note_id = ?)').run(note.id)
    this.db.prepare('DELETE FROM chunks WHERE note_id = ?').run(note.id)
    if (note.deletedAt !== null) return
    // Keep offsets in the canonical Markdown, never in an AI-generated summary.
    for (let start = 0; start < Math.max(1, note.markdown.length); start += 900) {
      const end = Math.min(start + 1200, note.markdown.length)
      const text = note.markdown.slice(start, end)
      const row = this.db
        .prepare('INSERT INTO chunks(note_id,start,end,text) VALUES(?,?,?,?)')
        .run(note.id, start, end, text)
      this.db
        .prepare('INSERT INTO knowledge_fts(rowid,terms) VALUES(?,?)')
        .run(row.lastInsertRowid, tokens(`${note.title}\n${text}`).join(' '))
      if (end === note.markdown.length) break
    }
  }

  list(query: NoteQuery): NotePage {
    const clauses = [query.trash ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL']
    const args: SQLInputValue[] = []
    if (query.projectId !== undefined) {
      clauses.push('project_id IS ?')
      args.push(query.projectId)
    }
    for (const word of query.search?.trim().split(/\s+/u).filter(Boolean) ?? []) {
      clauses.push("(title LIKE ? ESCAPE '\\' OR markdown LIKE ? ESCAPE '\\')")
      const pattern = `%${word.replace(/[\\%_]/g, '\\$&')}%`
      args.push(pattern, pattern)
    }
    if (query.from) {
      clauses.push('created_at >= ?')
      args.push(query.from)
    }
    if (query.to) {
      clauses.push('created_at < ?')
      args.push(query.to)
    }
    const where = clauses.join(' AND ')
    const order =
      query.sort === 'created'
        ? 'created_at DESC'
        : query.sort === 'title'
          ? 'title COLLATE NOCASE ASC'
          : 'updated_at DESC'
    const total = Number(this.db.prepare(`SELECT count(*) AS count FROM notes WHERE ${where}`).get(...args)?.count ?? 0)
    const rows = this.db
      .prepare(`SELECT * FROM notes WHERE ${where} ORDER BY pinned DESC, ${order}, id ASC LIMIT ? OFFSET ?`)
      .all(...args, Math.max(1, Math.min(query.limit ?? 50, 500)), Math.max(0, query.offset ?? 0))
    return { notes: rows.map(row => this.withVersion(fromRow(row))), total }
  }
}

class LocalNotes extends Service implements NoteService {
  deleteProject?: (id: string) => Promise<void>
  constructor(
    ctx: Context,
    private readonly store: Notebook,
  ) {
    super(ctx, 'nookNotes')
    if (store.replica)
      this.deleteProject = async id => {
        store.deleteProject(id)
      }
  }
  async list(query: NoteQuery): Promise<NotePage> {
    return this.store.list(query)
  }
  async get(id: string): Promise<NoteDto | null> {
    return this.store.get(id)
  }
  async create(request: CreateNoteRequest): Promise<NoteDto> {
    validate(request)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.id))
      throw new NoteError('INVALID_NOTE', '无效的笔记标识。')
    return this.store.transaction(() => {
      const previous = this.store.get(request.id)
      if (previous) return previous
      const now = new Date().toISOString()
      const note: NoteDto = { ...request, createdAt: now, updatedAt: now, deletedAt: null, revision: 1 }
      this.store.db
        .prepare('INSERT INTO notes VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(
          note.id,
          note.title,
          note.markdown,
          note.projectId,
          note.pinned ? 1 : 0,
          now,
          now,
          null,
          1,
          JSON.stringify(note.source),
        )
      this.store.index(note)
      return this.store.capture(note)
    })
  }
  async save(request: SaveNoteRequest): Promise<SaveNoteResult> {
    validate(request)
    const replica = this.store.replica
    const fingerprint = canonicalJson({
      id: request.id,
      versionId: request.versionId ?? null,
      revision: request.revision,
      title: request.title,
      markdown: request.markdown,
      pinned: request.pinned,
      projectId: request.projectId,
    })
    const submitted = this.store.transaction(() => {
      const receipt = replica && request.requestId ? this.receipt(`save/${request.requestId}`, fingerprint) : null
      if (receipt) return receipt
      const current = this.store.get(request.id)
      if (!current) throw new NoteError('NOT_FOUND', '笔记不存在。')
      if (replica) {
        const baseline = request.versionId ? replica.version(request.versionId) : null
        if (
          request.versionId &&
          (!baseline || baseline.type !== 'note' || baseline.id !== request.id || baseline.schema !== 1)
        )
          throw new NoteError('INVALID_NOTE', '笔记编辑基线不存在或不匹配。')
        if (!baseline) this.requireRevision(request.id, request.revision)
        const base = baseline ? (baseline.data as unknown as NoteDto) : current
        const data = json({
          id: base.id,
          title: request.title,
          markdown: request.markdown,
          pinned: request.pinned,
          projectId: request.projectId,
          source: base.source,
          createdAt: base.createdAt,
          updatedAt: new Date().toISOString(),
          deletedAt: null,
        })
        const hash = replica.writeBranch(
          'note',
          request.id,
          data,
          false,
          request.versionId ? [request.versionId] : undefined,
        )
        if (request.requestId) this.recordReceipt(`save/${request.requestId}`, fingerprint, hash)
        return hash
      }
      const previous = this.requireRevision(request.id, request.revision)
      if (previous.deletedAt !== null) throw new NoteError('CONFLICT', '这条笔记已进入回收站，请先恢复。')
      const note = {
        ...previous,
        title: request.title,
        markdown: request.markdown,
        pinned: request.pinned,
        projectId: request.projectId,
        revision: previous.revision + 1,
        updatedAt: new Date().toISOString(),
      }
      this.store.db
        .prepare('UPDATE notes SET title=?,markdown=?,project_id=?,pinned=?,revision=?,updated_at=? WHERE id=?')
        .run(note.title, note.markdown, note.projectId, note.pinned ? 1 : 0, note.revision, note.updatedAt, note.id)
      this.store.index(note)
      return null
    })
    await replica?.reconcile()
    return { note: this.store.get(request.id)!, submittedVersionId: submitted }
  }
  private receipt(key: string, fingerprint: string): string | null {
    const row = this.store.db.prepare('SELECT value FROM sync_state WHERE key=?').get(`note-request/${key}`)
    if (!row) return null
    const value = JSON.parse(String(row.value)) as { fingerprint: string; result: string }
    if (value.fingerprint !== createHash('sha256').update(fingerprint).digest('hex'))
      throw new NoteError('INVALID_NOTE', '保存请求标识已被其他内容使用。')
    return value.result
  }
  private recordReceipt(key: string, fingerprint: string, result: string) {
    this.store.db
      .prepare('INSERT INTO sync_state VALUES(?,?)')
      .run(
        `note-request/${key}`,
        JSON.stringify({ fingerprint: createHash('sha256').update(fingerprint).digest('hex'), result }),
      )
  }
  async history(request: NoteHistoryQuery): Promise<NoteHistoryPage> {
    if (!this.store.get(request.id)) throw new NoteError('NOT_FOUND', '笔记不存在。')
    const versions = this.store.replica?.history('note', request.id) ?? []
    // Reverse topological order keeps children before ancestors even with clock skew.
    const children = new Map<string, number>(versions.map(v => [v.hash, 0]))
    const byHash = new Map(versions.map(v => [v.hash, v]))
    for (const v of versions)
      for (const parent of new Set(v.value.parents)) children.set(parent, (children.get(parent) ?? 0) + 1)
    const ready = versions
      .filter(v => !children.get(v.hash))
      .map(v => v.hash)
      .sort()
    const ordered: (typeof versions)[number][] = []
    while (ready.length) {
      const hash = ready.shift()!,
        v = byHash.get(hash)!
      ordered.push(v)
      for (const parent of new Set(v.value.parents)) {
        children.set(parent, children.get(parent)! - 1)
        if (!children.get(parent)) ready.push(parent)
      }
      ready.sort()
    }
    let start = 0
    if (request.cursor) {
      const index = ordered.findIndex(v => v.hash === request.cursor)
      if (index < 0) throw new NoteError('INVALID_NOTE', '历史分页位置无效，请重新打开。')
      start = index + 1
    }
    const limit = Math.min(100, Math.max(1, request.limit ?? 50))
    const page = ordered.slice(start, start + limit)
    return {
      entries: page.map(({ hash, value }) => {
        const n = value.data as unknown as NoteDto
        return {
          versionId: hash,
          title: noteTitle(n),
          updatedAt: n.updatedAt,
          deleted: value.deleted,
          merged: value.parents.length > 1,
        }
      }),
      cursor: start + page.length < ordered.length ? page.at(-1)!.hash : null,
    }
  }
  async getHistoryVersion(id: string, versionId: string): Promise<NoteDto> {
    const value = this.store.replica?.version(versionId)
    if (!value || value.type !== 'note' || value.id !== id || value.schema !== 1 || !this.store.get(id))
      throw new NoteError('NOT_FOUND', '历史版本不存在。')
    validateNoteVersion(value)
    return { ...(value.data as unknown as NoteDto), revision: 1, versionId }
  }
  async restoreHistoryVersion(request: RestoreNoteRequest): Promise<NoteDto> {
    const historical = await this.getHistoryVersion(request.id, request.versionId)
    const replica = this.store.replica!
    const fingerprint = canonicalJson(request)
    const id = this.store.transaction(() => {
      const receipt = this.receipt(`restore/${request.requestId}`, fingerprint)
      if (receipt) return receipt
      const id = request.copy ? randomUUID() : request.id
      const now = new Date().toISOString()
      const current = this.store.get(request.id)!
      const { revision: _revision, versionId: _versionId, ...content } = historical
      const projectId =
        content.projectId &&
        this.store.db.prepare('SELECT 1 FROM projects WHERE id=? AND deleted=0').get(content.projectId)
          ? content.projectId
          : null
      replica.writeBranch(
        'note',
        id,
        json({
          ...content,
          id,
          projectId,
          deletedAt: null,
          createdAt: request.copy ? now : current.createdAt,
          updatedAt: now,
        }),
        false,
        request.copy ? [] : replica.snapshot().heads[`note/${id}`],
      )
      this.recordReceipt(`restore/${request.requestId}`, fingerprint, id)
      return id
    })
    return this.store.get(id)!
  }
  async setDeleted(id: string, revision: number, deleted: boolean): Promise<NoteDto> {
    return this.store.transaction(() => {
      const previous = this.requireRevision(id, revision)
      if (deleted) writeRecoveryRecord(this.store.backups, 'trash-note', { notes: [previous], sessions: [] })
      const now = new Date().toISOString()
      const note = { ...previous, deletedAt: deleted ? now : null, updatedAt: now, revision: previous.revision + 1 }
      this.store.db
        .prepare('UPDATE notes SET deleted_at=?,updated_at=?,revision=? WHERE id=?')
        .run(note.deletedAt, now, note.revision, id)
      this.store.index(note)
      return this.store.capture(note)
    })
  }
  async detachProject(projectId: string): Promise<void> {
    this.store.transaction(() => {
      const notes = this.store.db.prepare('SELECT * FROM notes WHERE project_id=?').all(projectId).map(fromRow)
      const sessions = this.store.db.prepare('SELECT * FROM knowledge_sessions WHERE project_id=?').all(projectId)
      if (notes.length || sessions.length)
        writeRecoveryRecord(this.store.backups, 'detach-project', { projectId, notes, sessions })
      this.store.db
        .prepare('UPDATE notes SET project_id=NULL, revision=revision+1, updated_at=? WHERE project_id=?')
        .run(new Date().toISOString(), projectId)
      for (const note of notes) this.store.capture(this.store.get(note.id)!)
      // Deleting a scoped project must not silently broaden retrieval to every project.
      this.store.db
        .prepare('UPDATE knowledge_sessions SET enabled=0, project_id=NULL WHERE project_id=?')
        .run(projectId)
    })
  }
  private requireRevision(id: string, revision: number): NoteDto {
    const note = this.store.get(id)
    if (!note) throw new NoteError('NOT_FOUND', '笔记不存在。')
    if (note.revision !== revision)
      throw new NoteError('CONFLICT', '笔记已在其他窗口更新。当前输入已保留，请重新载入或另存为新笔记。')
    return note
  }
}

class LocalKnowledge extends Service implements KnowledgeService {
  constructor(
    ctx: Context,
    private readonly store: Notebook,
  ) {
    super(ctx, 'nookKnowledge')
  }
  async session(id: string) {
    const row = this.store.db.prepare('SELECT enabled,project_id FROM knowledge_sessions WHERE id=?').get(id)
    return { enabled: row?.enabled === 1, projectId: row?.project_id == null ? null : String(row.project_id) }
  }
  async setSession(id: string, value: { enabled: boolean; projectId: string | null }) {
    this.store.db
      .prepare(
        'INSERT INTO knowledge_sessions VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,project_id=excluded.project_id',
      )
      .run(id, value.enabled ? 1 : 0, value.projectId)
    return value
  }
  async search(query: KnowledgeQuery): Promise<readonly KnowledgeHit[]> {
    const terms = [...new Set(tokens(query.query))].slice(0, 80)
    if (!terms.length) return []
    const where = query.projectId === undefined ? '' : ' AND n.project_id IS ?'
    const args: SQLInputValue[] = [terms.map(term => `"${term.replaceAll('"', '""')}"`).join(' OR ')]
    if (query.projectId !== undefined) args.push(query.projectId)
    args.push(Math.min(20, Math.max(1, query.limit ?? 8)))
    const rows = this.store.db
      .prepare(
        `SELECT n.*, c.start, c.end, c.text, bm25(knowledge_fts) AS rank FROM knowledge_fts JOIN chunks c ON c.id=knowledge_fts.rowid JOIN notes n ON n.id=c.note_id WHERE knowledge_fts MATCH ? AND n.deleted_at IS NULL${where} ORDER BY rank, n.id, c.start LIMIT ?`,
      )
      .all(...args)
    return rows.map(row => {
      const note = fromRow(row)
      return {
        documentId: note.id,
        title: noteTitle(note),
        text: String(row.text),
        projectId: note.projectId,
        revision: note.revision,
        sourceKind: note.source.kind,
        sourceUrl: note.source.url,
        start: Number(row.start),
        end: Number(row.end),
        score: -Number(row.rank),
      }
    })
  }
}

/** One transaction owner publishes two interchangeable Nook capability faces. */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => {
    const store = new Notebook(config.file, config.projectsFile)
    const projects = store.replica ? ctx.plugin(SqliteProjects, store) : undefined
    const sync = store.replica ? ctx.plugin(ReplicaService, store.replica) : undefined
    const notes = ctx.plugin(LocalNotes, store)
    const knowledge = ctx.plugin(LocalKnowledge, store)
    return async () => {
      await knowledge.dispose()
      await notes.dispose()
      await sync?.dispose()
      await projects?.dispose()
      store.replica?.dispose()
      await store.merger.dispose()
      store.db.close()
    }
  })
}

function json(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json
}
function dateValid(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}
function uuid(value: unknown) {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
}
function validateProjectVersion(v: RecordVersion) {
  const p = v.data as unknown as ProjectDto
  if (
    !p ||
    p.id !== v.id ||
    !uuid(p.id) ||
    typeof p.name !== 'string' ||
    !p.name.trim() ||
    p.name.length > 120 ||
    typeof p.description !== 'string' ||
    p.description.length > 2000 ||
    (p.sortOrder !== undefined && (!Number.isSafeInteger(p.sortOrder) || p.sortOrder < 0)) ||
    !dateValid(p.createdAt) ||
    !dateValid(p.updatedAt)
  )
    throw new SyncError('项目数据格式无效。')
}
function validateNoteVersion(v: RecordVersion) {
  const n = v.data as unknown as NoteDto
  if (
    !n ||
    n.id !== v.id ||
    !uuid(n.id) ||
    !dateValid(n.createdAt) ||
    !dateValid(n.updatedAt) ||
    (n.deletedAt !== null && !dateValid(n.deletedAt)) ||
    (n.deletedAt !== null) !== v.deleted ||
    !(n.projectId === null || uuid(n.projectId))
  )
    throw new SyncError('笔记数据格式无效。')
  validate(n)
  const s = n.source
  if (
    !s ||
    !['personal', 'transcript', 'comment-note', 'ai-article', 'ai-summary'].includes(s.kind) ||
    !(s.url === null || typeof s.url === 'string') ||
    !(s.author === null || (typeof s.author === 'string' && s.author.length <= 300)) ||
    !Array.isArray(s.basedOn) ||
    s.basedOn.length > 500 ||
    s.basedOn.some(
      r =>
        !uuid(r.noteId) ||
        !Number.isSafeInteger(r.revision) ||
        r.revision < 1 ||
        (r.versionId !== undefined && !/^[a-f0-9]{64}$/.test(r.versionId)),
    )
  )
    throw new SyncError('笔记来源格式无效。')
}
class SqliteProjects extends Service implements ProjectService {
  private readonly listeners = new Set<ProjectEventListener>()
  constructor(
    ctx: Context,
    private readonly store: Notebook,
  ) {
    super(ctx, 'nookProjects')
    let before = this.all()
    ctx.effect(() => {
      const off = store.replica!.subscribe(() => {
        const after = this.all()
        for (const p of after) {
          const old = before.find(x => x.id === p.id)
          if (!old) this.publish({ type: 'project.created', project: p })
          else if (JSON.stringify(old) !== JSON.stringify(p)) this.publish({ type: 'project.updated', project: p })
        }
        for (const p of before)
          if (!after.some(x => x.id === p.id)) this.publish({ type: 'project.deleted', projectId: p.id })
        before = after
      })
      return () => {
        off()
        this.listeners.clear()
      }
    })
  }
  private all(): ProjectDto[] {
    return this.store.db
      .prepare('SELECT data FROM projects WHERE deleted=0 ORDER BY id')
      .all()
      .map(row => JSON.parse(String(row.data)) as ProjectDto)
      .sort(compareProjects)
  }
  async reorder(ids: readonly string[]) {
    return this.store.transaction(() => reorderProjects(this.all(), ids).map(project => this.save(project)))
  }
  async list() {
    return this.all()
  }
  async get(id: string) {
    return this.all().find(p => p.id === id)
  }
  async create(request: CreateProjectRequest) {
    const now = new Date().toISOString()
    return this.save({
      id: randomUUID(),
      name: request.name.trim(),
      description: request.description?.trim() ?? '',
      createdAt: now,
      updatedAt: now,
    })
  }
  async update(id: string, request: UpdateProjectRequest) {
    const old = await this.get(id)
    if (!old) throw new ProjectError('PROJECT_NOT_FOUND', '项目不存在。')
    return this.save({
      ...old,
      ...request,
      name: request.name?.trim() ?? old.name,
      updatedAt: new Date().toISOString(),
    })
  }
  private save(project: ProjectDto) {
    return this.store.transaction(() => {
      validateProjectVersion({
        format: 1,
        type: 'project',
        id: project.id,
        schema: 1,
        parents: [],
        deleted: false,
        data: json(project),
        blobs: [],
      })
      this.store.db
        .prepare('INSERT INTO projects VALUES(?,?,0) ON CONFLICT(id) DO UPDATE SET data=excluded.data,deleted=0')
        .run(project.id, JSON.stringify(project))
      this.store.replica!.capture('project', project.id, json(project))
      return project
    })
  }
  async delete(id: string) {
    this.store.deleteProject(id)
  }
  subscribe(listener: ProjectEventListener) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private publish(event: ProjectEvent) {
    for (const fn of this.listeners) {
      try {
        fn(event)
      } catch {
        /* subscriptions cannot undo storage */
      }
    }
  }
}
class ReplicaService extends Service implements SyncReplica {
  constructor(
    ctx: Context,
    private readonly replica: Replica,
  ) {
    super(ctx, 'nookSyncReplica')
  }
  registerType(...args: Parameters<SyncReplica['registerType']>) {
    return this.replica.registerType(...args)
  }
  records(...args: Parameters<SyncReplica['records']>) {
    return this.replica.records(...args)
  }
  writeRecords(...args: Parameters<SyncReplica['writeRecords']>) {
    return this.replica.writeRecords(...args)
  }
  snapshot() {
    return this.replica.snapshot()
  }
  version(...args: Parameters<SyncReplica['version']>) {
    return this.replica.version(...args)
  }
  receive(...args: Parameters<SyncReplica['receive']>) {
    return this.replica.receive(...args)
  }
  reconcile(signal?: AbortSignal) {
    return this.replica.reconcile(signal)
  }
  acknowledge(...args: Parameters<SyncReplica['acknowledge']>) {
    return this.replica.acknowledge(...args)
  }
  binding() {
    return this.replica.binding()
  }
  bind(...args: Parameters<SyncReplica['bind']>) {
    return this.replica.bind(...args)
  }
  prepare() {
    return this.replica.prepare()
  }
  conflicts() {
    return this.replica.conflicts()
  }
  resolve(...args: Parameters<SyncReplica['resolve']>) {
    return this.replica.resolve(...args)
  }
  stats() {
    return this.replica.stats()
  }
  subscribe(...args: Parameters<SyncReplica['subscribe']>) {
    return this.replica.subscribe(...args)
  }
  blob(...args: Parameters<SyncReplica['blob']>) {
    return this.replica.blob(...args)
  }
  receiveBlob(...args: Parameters<SyncReplica['receiveBlob']>) {
    return this.replica.receiveBlob(...args)
  }
}
