import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Context, Service, type Logger } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { writeRecoveryRecord } from '@nook-dsh/storage-backup'
import {
  ProjectError,
  compareProjects,
  reorderProjects,
  type CreateProjectRequest,
  type ProjectDto,
  type ProjectEvent,
  type ProjectEventListener,
  type ProjectId,
  type ProjectService,
  type UpdateProjectRequest,
} from '@nook-dsh/capability-project'

declare module '@deepseek-ai/cordis' {
  interface Context {
    nookProjects: ProjectService
  }
}

export interface Config {
  readonly file: string
}

export const Config: z<Config> = z.object({ file: z.string().required() })

interface ProjectStore {
  readonly version: 1
  readonly projects: readonly ProjectDto[]
}

const EMPTY_STORE: ProjectStore = { version: 1, projects: [] }
const SAFE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isProject(value: unknown): value is ProjectDto {
  if (typeof value !== 'object' || value === null) return false
  const project = value as Partial<ProjectDto>
  return (
    typeof project.id === 'string' &&
    SAFE_ID.test(project.id) &&
    typeof project.name === 'string' &&
    project.name.length > 0 &&
    project.name.length <= 120 &&
    typeof project.description === 'string' &&
    project.description.length <= 2_000 &&
    (project.sortOrder === undefined || (Number.isSafeInteger(project.sortOrder) && project.sortOrder >= 0)) &&
    typeof project.createdAt === 'string' &&
    Number.isFinite(Date.parse(project.createdAt)) &&
    typeof project.updatedAt === 'string' &&
    Number.isFinite(Date.parse(project.updatedAt))
  )
}

function cleanText(value: string, field: string, maxLength: number): string {
  const cleaned = value.trim()
  if (cleaned.length === 0 || cleaned.length > maxLength) {
    throw new ProjectError('INVALID_PROJECT', `${field} must be between 1 and ${maxLength} characters`)
  }
  return cleaned
}

function cloneProject(project: ProjectDto): ProjectDto {
  return { ...project }
}

export default class LocalProjectProvider extends Service implements ProjectService {
  static Config: z<Config> = Config

  private readonly listeners = new Set<ProjectEventListener>()
  private writeQueue: Promise<void> = Promise.resolve()
  private readonly file: string
  private readonly logger: Logger

  constructor(ctx: Context, config: Config) {
    super(ctx, 'nookProjects')
    this.file = resolve(config.file)
    this.logger = ctx.logger('nook-projects')
    ctx.effect(
      () => () => {
        this.listeners.clear()
        return this.writeQueue
      },
      'nook-projects: clear subscribers',
    )
  }

  async list(): Promise<readonly ProjectDto[]> {
    return (await this.readStore()).projects.map(cloneProject).sort(compareProjects)
  }

  async reorder(ids: readonly string[]): Promise<readonly ProjectDto[]> {
    let ordered: ProjectDto[] = []
    await this.mutate(projects => (ordered = reorderProjects(projects, ids)))
    for (const project of ordered) this.publish({ type: 'project.updated', project: cloneProject(project) })
    return ordered.map(cloneProject)
  }

  async get(projectId: ProjectId): Promise<ProjectDto | undefined> {
    const found = (await this.readStore()).projects.find(project => project.id === projectId)
    return found === undefined ? undefined : cloneProject(found)
  }

  async create(request: CreateProjectRequest): Promise<ProjectDto> {
    const now = new Date().toISOString()
    const project: ProjectDto = {
      id: randomUUID(),
      name: cleanText(request.name, 'name', 120),
      description: request.description?.trim().slice(0, 2_000) ?? '',
      createdAt: now,
      updatedAt: now,
    }
    await this.mutate(projects => [...projects, project])
    this.publish({ type: 'project.created', project: cloneProject(project) })
    return cloneProject(project)
  }

  async update(projectId: ProjectId, request: UpdateProjectRequest): Promise<ProjectDto> {
    let updated: ProjectDto | undefined
    await this.mutate(projects =>
      projects.map(project => {
        if (project.id !== projectId) return project
        updated = {
          ...project,
          ...(request.name === undefined ? {} : { name: cleanText(request.name, 'name', 120) }),
          ...(request.description === undefined ? {} : { description: request.description.trim().slice(0, 2_000) }),
          updatedAt: new Date().toISOString(),
        }
        return updated
      }),
    )
    if (updated === undefined) throw new ProjectError('PROJECT_NOT_FOUND', `project ${projectId} does not exist`)
    this.publish({ type: 'project.updated', project: cloneProject(updated) })
    return cloneProject(updated)
  }

  async delete(projectId: ProjectId): Promise<void> {
    await this.mutate(projects => {
      if (!projects.some(project => project.id === projectId))
        throw new ProjectError('PROJECT_NOT_FOUND', `project ${projectId} does not exist`)
      return projects.filter(project => project.id !== projectId)
    }, 'delete-project')
    this.publish({ type: 'project.deleted', projectId })
  }

  subscribe(listener: ProjectEventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private publish(event: ProjectEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (error: unknown) {
        this.logger.warn('project event listener failed: %o', error)
      }
    }
  }

  private async readStore(): Promise<ProjectStore> {
    try {
      const raw = await readFile(this.file, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('version' in parsed) ||
        parsed.version !== 1 ||
        !('projects' in parsed) ||
        !Array.isArray(parsed.projects) ||
        !parsed.projects.every(isProject)
      ) {
        throw new Error('invalid project store shape')
      }
      return { version: 1, projects: parsed.projects as ProjectDto[] }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY_STORE
      if (error instanceof ProjectError) throw error
      throw new ProjectError('PROJECT_STORAGE_FAILED', `failed to read project store ${this.file}`, { cause: error })
    }
  }

  private async mutate(
    change: (projects: readonly ProjectDto[]) => readonly ProjectDto[],
    backupReason?: string,
  ): Promise<void> {
    const operation = this.writeQueue.then(async () => {
      const previous = await this.readStore()
      const next: ProjectStore = { version: 1, projects: change(previous.projects) }
      await mkdir(dirname(this.file), { recursive: true })
      const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`
      try {
        if (backupReason) writeRecoveryRecord(`${this.file}.backups`, backupReason, previous)
        await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
        await rename(temporary, this.file)
      } catch (error: unknown) {
        await rm(temporary, { force: true }).catch(() => undefined)
        throw new ProjectError('PROJECT_STORAGE_FAILED', `failed to write project store ${this.file}`, { cause: error })
      }
    })
    this.writeQueue = operation.catch(() => undefined)
    return operation
  }
}
