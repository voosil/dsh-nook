/** JSON-safe identifier owned by Nook. */
export type ProjectId = string

/** Durable project projection shared between Nook plugins. */
export interface ProjectDto {
  readonly id: ProjectId
  readonly name: string
  readonly description: string
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
