import { Context, Service } from '@deepseek-ai/cordis'
import {
  NoteError,
  type NoteService,
  type CreateNoteRequest,
  type SaveNoteRequest,
  type NoteQuery,
} from '@nook-dsh/capability-note'
import type { KnowledgeService, KnowledgeQuery } from '@nook-dsh/capability-knowledge'
import type { ProjectService, CreateProjectRequest, UpdateProjectRequest } from '@nook-dsh/capability-project'

declare module '@deepseek-ai/cordis' {
  interface Context {
    nookNotes: NoteService
    nookKnowledge: KnowledgeService
    nookProjects: ProjectService
    nookNotebook: NotesFeature
  }
}

export default class NotesFeature extends Service {
  static inject = ['nookNotes', 'nookKnowledge', 'nookProjects']
  constructor(ctx: Context) {
    super(ctx, 'nookNotebook')
  }
  list(query: NoteQuery) {
    return this.ctx.nookNotes.list(query)
  }
  get(id: string) {
    return this.ctx.nookNotes.get(id)
  }
  async create(request: CreateNoteRequest) {
    await this.checkProject(request.projectId)
    return this.ctx.nookNotes.create(request)
  }
  async save(request: SaveNoteRequest) {
    await this.checkProject(request.projectId)
    return this.ctx.nookNotes.save(request)
  }
  setDeleted(id: string, revision: number, deleted: boolean) {
    return this.ctx.nookNotes.setDeleted(id, revision, deleted)
  }
  search(query: KnowledgeQuery) {
    return this.ctx.nookKnowledge.search(query)
  }
  projects() {
    return this.ctx.nookProjects.list()
  }
  createProject(request: CreateProjectRequest) {
    return this.ctx.nookProjects.create(request)
  }
  updateProject(id: string, request: UpdateProjectRequest) {
    return this.ctx.nookProjects.update(id, request)
  }
  async deleteProject(id: string) {
    await this.ctx.nookNotes.detachProject(id)
    await this.ctx.nookProjects.delete(id)
    return true
  }
  private async checkProject(id: string | null) {
    if (id !== null && !(await this.ctx.nookProjects.get(id)))
      throw new NoteError('INVALID_NOTE', '项目不存在，请重新选择。')
  }
}
