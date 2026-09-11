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
  private timer: ReturnType<typeof setTimeout> | undefined
  private dirtySince: number | undefined
  private lastEdit = 0
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
    // Reconcile the saved draft's baseline and retry a lost request even if its text
    // already matches the current note. The Host deduplicates unchanged submissions.
    if (!this.dirty) {
      this.generation++
      this.lastEdit = Date.now()
      this.dirtySince = this.lastEdit
      this.changed('dirty')
    }
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
    if (JSON.stringify(inputOf(input)) === JSON.stringify(this.input)) return
    this.input = inputOf(input)
    this.generation++
    this.lastEdit = Date.now()
    this.dirtySince ??= this.lastEdit
    this.changed('dirty')
  }
  pause() {
    this.paused = true
    clearTimeout(this.timer)
    // Do not adopt a response over an IME buffer that has not emitted its final input yet.
    if (this.running) {
      this.generation++
      this.dirtySince ??= Date.now()
      this.changed('dirty')
    }
  }
  resume() {
    this.paused = false
    this.schedule()
  }
  /** IME confirmations share the same quiet period as ordinary input. */
  schedule() {
    clearTimeout(this.timer)
    if (this.paused || !this.dirty) return
    const due = Math.min(this.lastEdit + 3000, (this.dirtySince ?? Date.now()) + 30000)
    this.timer = setTimeout(
      () => {
        void this.commit(false).then(ok => {
          if (ok && this.dirty) this.schedule()
        })
      },
      Math.max(0, due - Date.now()),
    )
  }
  dispose() {
    clearTimeout(this.timer)
    this.paused = true
  }
  flush(): Promise<boolean> {
    clearTimeout(this.timer)
    if (this.running) return this.running.then(ok => (ok && this.dirty ? this.flush() : ok))
    return this.commit(true)
  }
  private commit(all: boolean): Promise<boolean> {
    if (this.running) return this.running
    this.running = this.drain(all).finally(() => {
      this.running = undefined
    })
    return this.running
  }
  private async drain(all: boolean): Promise<boolean> {
    try {
      // A flush over unchanged input must stay silent: the 'saved' notification
      // re-sorts the note list, so emitting it on every no-op flush would flash
      // the list loading state each time the user merely opens another note.
      const wasDirty = this.dirty
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
        this.dirtySince = this.dirty ? Date.now() : undefined
        if (this.dirty) {
          this.baseline = result.submittedVersionId ?? this.note.versionId
          this.changed('dirty')
        } else {
          this.baseline = this.note.versionId
          this.input = inputOf(this.note)
        }
        if (!all) break
      }
      if (wasDirty && !this.dirty) this.changed('saved')
      return true
    } catch (error) {
      this.changed('error', error instanceof Error ? error.message : '保存失败，请重试。')
      return false
    }
  }
}
