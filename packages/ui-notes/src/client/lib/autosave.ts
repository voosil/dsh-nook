import type { NoteDto, NoteInput, SaveNoteRequest, SaveNoteResult } from '@nook-dsh/capability-note'

export interface SavedDraft {
  revision: number
  versionId?: string | undefined
  input: NoteInput
  pending?: SaveNoteRequest | undefined
}
const inputOf = (note: NoteInput): NoteInput => ({
  title: note.title,
  markdown: note.markdown,
  projectId: note.projectId,
  pinned: note.pinned,
})

/** Acknowledged input and merged display versions are separate while typing continues. */
export class Autosave {
  private generation = 0
  private savedGeneration = 0
  private running: Promise<boolean> | undefined
  private input: NoteInput
  private baseline: string | undefined
  private paused = false
  private pending: { generation: number; request: SaveNoteRequest } | undefined
  constructor(
    public note: NoteDto,
    private readonly save: (request: SaveNoteRequest) => Promise<SaveNoteResult>,
    private readonly changed: (state: 'dirty' | 'saving' | 'saved' | 'error', error?: string) => void,
  ) {
    this.input = inputOf(note)
    this.baseline = note.versionId
  }
  get dirty() {
    return this.generation !== this.savedGeneration
  }
  get current() {
    return this.input
  }
  get draft(): SavedDraft {
    return { revision: this.note.revision, versionId: this.baseline, input: this.input, pending: this.pending?.request }
  }
  recover(draft: SavedDraft) {
    this.baseline = draft.versionId ?? this.note.versionId
    this.edit(draft.input)
    if (draft.pending && draft.pending.id === this.note.id && draft.pending.requestId) {
      this.pending = {
        request: draft.pending,
        generation: JSON.stringify(inputOf(draft.pending)) === JSON.stringify(this.input) ? this.generation : 0,
      }
    }
  }
  adopt(note: NoteDto) {
    if (this.dirty || this.running) return
    this.note = note
    this.baseline = note.versionId
    this.input = inputOf(note)
    this.changed('saved')
  }
  edit(input: NoteInput) {
    this.input = inputOf(input)
    this.generation++
    this.changed('dirty')
  }
  pause() {
    this.paused = true
    this.edit(this.input)
  }
  resume() {
    this.paused = false
    return this.flush()
  }
  flush(): Promise<boolean> {
    if (this.running) return this.running
    this.running = this.drain().finally(() => {
      this.running = undefined
    })
    return this.running
  }
  private async drain(): Promise<boolean> {
    try {
      while (this.dirty) {
        if (this.paused) return false
        this.pending ??= {
          generation: this.generation,
          request: {
            ...this.input,
            id: this.note.id,
            revision: this.note.revision,
            versionId: this.baseline,
            requestId: crypto.randomUUID(),
          },
        }
        this.changed('saving')
        const pending = this.pending
        const result = await this.save(pending.request)
        this.note = result.note
        this.savedGeneration = pending.generation
        this.pending = undefined
        if (this.dirty) {
          this.baseline = result.submittedVersionId ?? this.note.versionId
          this.changed('dirty')
        } else {
          this.baseline = this.note.versionId
          this.input = inputOf(this.note)
        }
      }
      this.changed('saved')
      return true
    } catch (error) {
      this.changed('error', error instanceof Error ? error.message : '保存失败，请重试。')
      return false
    }
  }
}
