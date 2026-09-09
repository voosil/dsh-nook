import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context, Service } from '@deepseek-ai/cordis'
import type {
  ArtifactContentDto,
  ArtifactDto,
  ArtifactService,
  WriteArtifactRequest,
} from '@nook-dsh/capability-artifact'
import type { BrowserService, BrowserSnapshotDto } from '@nook-dsh/capability-browser'
import type { ProjectDto, ProjectService } from '@nook-dsh/capability-project'
import PreviewFeature from '../../packages/feature-preview/src/index.ts'

const PROJECT: ProjectDto = {
  id: 'c24d8d6b-4094-4f74-a699-1bc9329fd6ca',
  name: 'Preview lab',
  description: '',
  createdAt: '2026-08-28T00:00:00.000Z',
  updatedAt: '2026-08-28T00:00:00.000Z',
}

class FakeProjects extends Service implements ProjectService {
  constructor(ctx: Context) {
    super(ctx, 'nookProjects')
  }
  async list() {
    return [PROJECT]
  }
  async reorder() {
    return this.list()
  }

  async get(id: string) {
    return id === PROJECT.id ? PROJECT : undefined
  }
  async create() {
    return PROJECT
  }
  async update() {
    return PROJECT
  }
  async delete() {}
  subscribe() {
    return () => undefined
  }
}

class FakeBrowser extends Service implements BrowserService {
  released: string[] = []
  constructor(ctx: Context) {
    super(ctx, 'nookBrowser')
  }
  async navigate(_owner: string, url: string): Promise<BrowserSnapshotDto> {
    return { url, title: 'Nook shelf', nodes: [], totalRefs: 0, truncated: false }
  }
  async snapshot() {
    throw new Error('not used')
  }
  async click() {
    throw new Error('not used')
  }
  async screenshot() {
    return { mimeType: 'image/png' as const, dataBase64: Buffer.from('png').toString('base64') }
  }
  async release(owner: string) {
    this.released.push(owner)
  }
}

class FakeArtifacts extends Service implements ArtifactService {
  writes: WriteArtifactRequest[] = []
  constructor(ctx: Context) {
    super(ctx, 'nookArtifacts')
  }
  async write(request: WriteArtifactRequest): Promise<ArtifactDto> {
    this.writes.push(request)
    return {
      id: 'artifact-1',
      projectId: request.projectId,
      name: request.name,
      mediaType: request.mediaType,
      byteLength: 3,
      createdAt: '2026-08-28T00:00:00.000Z',
    }
  }
  async read(): Promise<ArtifactContentDto | undefined> {
    return undefined
  }
  async list(): Promise<readonly ArtifactDto[]> {
    return []
  }
  async delete(): Promise<void> {}
}

test('preview feature consumes only owned capability contracts', async () => {
  const ctx = new Context()
  await ctx.plugin(FakeProjects)
  await ctx.plugin(FakeBrowser)
  await ctx.plugin(FakeArtifacts)
  await ctx.plugin(PreviewFeature)

  const [result, second] = await Promise.all([
    ctx.nookPreview.capture(PROJECT.id, 'https://example.test/'),
    ctx.nookPreview.capture(PROJECT.id, 'https://example.test/second'),
  ])
  assert.equal(result.title, 'Nook shelf')
  assert.equal(result.screenshot.name, 'Nook-shelf.png')
  assert.equal(second.title, 'Nook shelf')
  const released = (ctx.nookBrowser as FakeBrowser).released
  assert.equal(released.length, 2)
  assert.equal(new Set(released).size, 2)
  assert.ok(released.every(owner => owner.startsWith(`nook-preview:${PROJECT.id}:`)))
  assert.equal((ctx.nookArtifacts as FakeArtifacts).writes[0]?.mediaType, 'image/png')

  await ctx.fiber.dispose()
})
