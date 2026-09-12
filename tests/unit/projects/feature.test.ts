import assert from 'node:assert/strict'

import { test } from 'node:test'

import { randomUUID } from 'node:crypto'

import { Context, Service } from '@deepseek-ai/cordis'

import type {
  CreateProjectRequest,
  ProjectDto,
  ProjectEventListener,
  ProjectService,
  UpdateProjectRequest,
} from '@nook-dsh/capability-project'

import ProjectFeature from '../../../packages/feature-project/src/index.ts'

class FakeProjectProvider extends Service implements ProjectService {
  private readonly projects = new Map<string, ProjectDto>()
  private readonly listeners = new Set<ProjectEventListener>()

  constructor(ctx: Context) {
    super(ctx, 'nookProjects')
  }

  async list(): Promise<readonly ProjectDto[]> {
    return [...this.projects.values()]
  }

  async reorder() {
    return this.list()
  }

  async get(projectId: string): Promise<ProjectDto | undefined> {
    return this.projects.get(projectId)
  }

  async create(request: CreateProjectRequest): Promise<ProjectDto> {
    const now = new Date().toISOString()
    const project = {
      id: randomUUID(),
      name: request.name,
      description: request.description ?? '',
      createdAt: now,
      updatedAt: now,
    }
    this.projects.set(project.id, project)
    for (const listener of this.listeners) listener({ type: 'project.created', project })
    return project
  }

  async update(projectId: string, request: UpdateProjectRequest): Promise<ProjectDto> {
    const current = this.projects.get(projectId)
    if (current === undefined) throw new Error('missing project')
    const project = { ...current, ...request, updatedAt: new Date().toISOString() }
    this.projects.set(projectId, project)
    return project
  }

  async delete(projectId: string): Promise<void> {
    this.projects.delete(projectId)
  }

  subscribe(listener: ProjectEventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

test('feature consumes the project capability and survives remount', async () => {
  const ctx = new Context()
  await ctx.plugin(FakeProjectProvider)
  const first = await ctx.plugin(ProjectFeature)
  const events: string[] = []
  const unsubscribe = ctx.nookProjectFeature.onProjectEvent(event => events.push(event.type))

  const created = await ctx.nookProjectFeature.createProject({
    name: 'Reading room',
    description: 'Long-form research',
  })
  assert.equal((await ctx.nookProjectFeature.listProjects())[0]?.id, created.id)
  assert.deepEqual(events, ['project.created'])

  unsubscribe()
  await first.dispose()
  const second = await ctx.plugin(ProjectFeature)
  assert.equal((await ctx.nookProjectFeature.findProject(created.id))?.name, 'Reading room')

  await second.dispose()
  await ctx.fiber.dispose()
})
