/** JSON-safe identifier owned by Nook. */
export type ProjectId = string

/** Durable project projection shared between Nook plugins. */
export interface ProjectDto {
  readonly id: ProjectId
  readonly name: string
  readonly description: string
  readonly sortOrder?: number | undefined
  readonly createdAt: string
  readonly updatedAt: string
}

export interface CreateProjectRequest {
  readonly name: string
  readonly description?: string
}

export interface UpdateProjectRequest {
  readonly name?: string
  readonly description?: string
}

export type ProjectEvent =
  | { readonly type: 'project.created'; readonly project: ProjectDto }
  | { readonly type: 'project.updated'; readonly project: ProjectDto }
  | { readonly type: 'project.deleted'; readonly projectId: ProjectId }

export type ProjectEventListener = (event: ProjectEvent) => void

export interface ProjectService {
  list(): Promise<readonly ProjectDto[]>
  reorder(ids: readonly ProjectId[]): Promise<readonly ProjectDto[]>
  get(projectId: ProjectId): Promise<ProjectDto | undefined>
  create(request: CreateProjectRequest): Promise<ProjectDto>
  update(projectId: ProjectId, request: UpdateProjectRequest): Promise<ProjectDto>
  delete(projectId: ProjectId): Promise<void>
  subscribe(listener: ProjectEventListener): () => void
}

export type ProjectErrorCode = 'INVALID_PROJECT' | 'PROJECT_NOT_FOUND' | 'PROJECT_STORAGE_FAILED'

export class ProjectError extends Error {
  readonly name = 'ProjectError'

  constructor(
    readonly code: ProjectErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

/** Stable fallback for legacy records and concurrent order ties. */
export function compareProjects(a: ProjectDto, b: ProjectDto): number {
  return (
    (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.id.localeCompare(b.id)
  )
}

export function reorderProjects(projects: readonly ProjectDto[], ids: readonly string[]): ProjectDto[] {
  const byId = new Map(projects.map(project => [project.id, project]))
  if (ids.length !== projects.length || new Set(ids).size !== ids.length || ids.some(id => !byId.has(id)))
    throw new ProjectError('INVALID_PROJECT', '项目列表已变化，请刷新后重新排序。')
  return ids.map((id, sortOrder) => ({ ...byId.get(id)!, sortOrder }))
}
