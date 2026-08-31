import { Context, Service } from '@deepseek-ai/cordis'
import type {
  CreateProjectRequest,
  ProjectDto,
  ProjectEventListener,
  ProjectId,
  ProjectService,
  UpdateProjectRequest,
} from '@nook-dsh/capability-project'

export interface ProjectFeatureService {
  listProjects(): Promise<readonly ProjectDto[]>
  findProject(projectId: ProjectId): Promise<ProjectDto | undefined>
  createProject(request: CreateProjectRequest): Promise<ProjectDto>
  updateProject(projectId: ProjectId, request: UpdateProjectRequest): Promise<ProjectDto>
  deleteProject(projectId: ProjectId): Promise<void>
  onProjectEvent(listener: ProjectEventListener): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    nookProjects: ProjectService
    nookProjectFeature: ProjectFeatureService
  }
}

export const inject = ['nookProjects']

export default class ProjectFeature extends Service implements ProjectFeatureService {
  static inject = inject
  private readonly projects: ProjectService

  constructor(ctx: Context) {
    super(ctx, 'nookProjectFeature')
    this.projects = ctx.nookProjects
  }

  listProjects(): Promise<readonly ProjectDto[]> {
    return this.projects.list()
  }

  findProject(projectId: ProjectId): Promise<ProjectDto | undefined> {
    return this.projects.get(projectId)
  }

  createProject(request: CreateProjectRequest): Promise<ProjectDto> {
    return this.projects.create(request)
  }

  updateProject(projectId: ProjectId, request: UpdateProjectRequest): Promise<ProjectDto> {
    return this.projects.update(projectId, request)
  }

  deleteProject(projectId: ProjectId): Promise<void> {
    return this.projects.delete(projectId)
  }

  onProjectEvent(listener: ProjectEventListener): () => void {
    return this.projects.subscribe(listener)
  }
}
