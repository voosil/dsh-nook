import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
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
} from '@nook-dsh/capability-note'
import type { KnowledgeService, KnowledgeQuery, KnowledgeHit } from '@nook-dsh/capability-knowledge'

declare module '@deepseek-ai/cordis' {
  interface Context {
    nookNotes: NoteService
    nookKnowledge: KnowledgeService
  }
}

export interface Config {
  readonly file: string
}
export const Config: z<Config> = z.object({ file: z.string().required() })

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
  constructor(file: string) {
    mkdirSync(dirname(resolve(file)), { recursive: true })
    this.db = new DatabaseSync(resolve(file))
    try {
      this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, markdown TEXT NOT NULL, project_id TEXT, pinned INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, revision INTEGER NOT NULL, source TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS notes_project ON notes(project_id, deleted_at);
        CREATE TABLE IF NOT EXISTS chunks (id INTEGER PRIMARY KEY, note_id TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, text TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS chunks_note ON chunks(note_id);
        CREATE TABLE IF NOT EXISTS knowledge_sessions (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL, project_id TEXT);
        CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(terms);
      `)
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  transaction<T>(fn: () => T): T {
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
    return row ? fromRow(row) : null
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
    return { notes: rows.map(fromRow), total }
  }
}

class LocalNotes extends Service implements NoteService {
  constructor(
    ctx: Context,
    private readonly store: Notebook,
  ) {
    super(ctx, 'nookNotes')
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
      return note
    })
  }
  async save(request: SaveNoteRequest): Promise<NoteDto> {
    validate(request)
    return this.store.transaction(() => {
      const previous = this.requireRevision(request.id, request.revision)
      if (previous.deletedAt !== null) throw new NoteError('CONFLICT', '这条笔记已进入回收站，请先恢复。')
      const note = {
        ...previous,
        title: request.title,
        markdown: request.markdown,
        projectId: request.projectId,
        pinned: request.pinned,
        revision: previous.revision + 1,
        updatedAt: new Date().toISOString(),
      }
      this.store.db
        .prepare('UPDATE notes SET title=?,markdown=?,project_id=?,pinned=?,revision=?,updated_at=? WHERE id=?')
        .run(note.title, note.markdown, note.projectId, note.pinned ? 1 : 0, note.revision, note.updatedAt, note.id)
      this.store.index(note)
      return note
    })
  }
  async setDeleted(id: string, revision: number, deleted: boolean): Promise<NoteDto> {
    return this.store.transaction(() => {
      const previous = this.requireRevision(id, revision)
      const now = new Date().toISOString()
      const note = { ...previous, deletedAt: deleted ? now : null, updatedAt: now, revision: previous.revision + 1 }
      this.store.db
        .prepare('UPDATE notes SET deleted_at=?,updated_at=?,revision=? WHERE id=?')
        .run(note.deletedAt, now, note.revision, id)
      this.store.index(note)
      return note
    })
  }
  async detachProject(projectId: string): Promise<void> {
    this.store.transaction(() => {
      this.store.db
        .prepare('UPDATE notes SET project_id=NULL, revision=revision+1, updated_at=? WHERE project_id=?')
        .run(new Date().toISOString(), projectId)
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
    const store = new Notebook(config.file)
    const notes = ctx.plugin(LocalNotes, store)
    const knowledge = ctx.plugin(LocalKnowledge, store)
    return async () => {
      await knowledge.dispose()
      await notes.dispose()
      store.db.close()
    }
  })
}
