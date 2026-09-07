import type { NoteDto, NoteInput, SaveNoteRequest } from '@nook-dsh/capability-note'

/** Serial saves share the latest acknowledged revision; newer typing is never overwritten. */
export class Autosave {
  private generation = 0
  private savedGeneration = 0
  private running: Promise<boolean> | undefined
  private input: NoteInput
  constructor(
    public note: NoteDto,
    private readonly save: (request: SaveNoteRequest) => Promise<NoteDto>,
    private readonly changed: (state: 'dirty' | 'saving' | 'saved' | 'error', error?: string) => void,
  ) {
    this.input = { title: note.title, markdown: note.markdown, projectId: note.projectId, pinned: note.pinned }
  }
  get dirty() {
    return this.generation !== this.savedGeneration
  }
  get current() {
    return this.input
  }
  edit(input: NoteInput) {
    this.input = { title: input.title, markdown: input.markdown, projectId: input.projectId, pinned: input.pinned }
    this.generation++
    this.changed('dirty')
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
        const generation = this.generation
        const snapshot = { ...this.input }
        this.changed('saving')
        this.note = await this.save({ ...snapshot, id: this.note.id, revision: this.note.revision })
        this.savedGeneration = generation
      }
      this.changed('saved')
      return true
    } catch (error) {
      this.changed('error', error instanceof Error ? error.message : '保存失败，请重试。')
      return false
    }
  }
}
