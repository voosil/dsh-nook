export type NoteSourceKind = 'personal' | 'transcript' | 'comment-note' | 'ai-article' | 'ai-summary'

export interface NoteSource {
  readonly kind: NoteSourceKind
  readonly url: string | null
  readonly author: string | null
  readonly basedOn: readonly {
    readonly noteId: string
    readonly revision: number
    readonly versionId?: string | undefined
  }[]
}

export interface NoteDto {
  readonly versionId?: string | undefined
  readonly id: string
  readonly title: string
  readonly markdown: string
  readonly projectId: string | null
  readonly pinned: boolean
  readonly createdAt: string
  readonly updatedAt: string
  readonly deletedAt: string | null
  readonly revision: number
  readonly source: NoteSource
}

export interface NoteInput {
  readonly title: string
  readonly markdown: string
  readonly projectId: string | null
  readonly pinned: boolean
}

export interface CreateNoteRequest extends NoteInput {
  /** Client-owned UUID makes creation retries idempotent. */
  readonly id: string
  readonly source: NoteSource
}

export interface SaveNoteRequest extends NoteInput {
  readonly id: string
  readonly revision: number
  readonly versionId?: string | undefined
  readonly requestId?: string | undefined
}
export interface SaveNoteResult {
  readonly note: NoteDto
  readonly submittedVersionId: string | null
}
export interface NoteHistoryEntry {
  readonly versionId: string
  readonly title: string
  readonly updatedAt: string
  readonly deleted: boolean
  readonly merged: boolean
}
export interface NoteHistoryPage {
  readonly entries: readonly NoteHistoryEntry[]
  readonly cursor: string | null
}
export interface NoteHistoryQuery {
  readonly id: string
  readonly cursor?: string | undefined
  readonly limit?: number | undefined
}
export interface RestoreNoteRequest {
  readonly id: string
  readonly versionId: string
  readonly requestId: string
  readonly copy: boolean
}

export interface NoteQuery {
  readonly search?: string
  /** Undefined = all projects, null = unfiled. */
  readonly projectId?: string | null
  readonly sort?: 'updated' | 'created' | 'title'
  readonly trash?: boolean
  readonly offset?: number
  readonly limit?: number
  readonly from?: string
  readonly to?: string
}

export interface NotePage {
  readonly notes: readonly NoteDto[]
  readonly total: number
}

export interface NoteService {
  /** Atomic project deletion when one provider owns both stores. */
  deleteProject?(id: string): Promise<void>
  list(query: NoteQuery): Promise<NotePage>
  get(id: string): Promise<NoteDto | null>
  create(request: CreateNoteRequest): Promise<NoteDto>
  save(request: SaveNoteRequest): Promise<SaveNoteResult>
  history(request: NoteHistoryQuery): Promise<NoteHistoryPage>
  getHistoryVersion(id: string, versionId: string): Promise<NoteDto>
  restoreHistoryVersion(request: RestoreNoteRequest): Promise<NoteDto>
  setDeleted(id: string, revision: number, deleted: boolean): Promise<NoteDto>
  detachProject(projectId: string): Promise<void>
}

export class NoteError extends Error {
  override readonly name = 'NoteError'
  constructor(
    readonly code: 'INVALID_NOTE' | 'NOT_FOUND' | 'CONFLICT' | 'STORAGE_FAILED',
    message: string,
  ) {
    super(message)
  }
}

export function noteTitle(note: Pick<NoteDto, 'title' | 'markdown'>): string {
  return (
    note.title.trim() ||
    note.markdown
      .split('\n')
      .find(line => line.trim())
      ?.replace(/^\s*[#>*-]+\s*/, '')
      .slice(0, 80) ||
    '无标题笔记'
  )
}
