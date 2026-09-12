import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context, Service } from '@deepseek-ai/cordis'
import type { NookToolSpec } from '@nook-dsh/dsh-adapter'
import * as AgentFeature from '../../../packages/feature-agent/src/index.ts'

class FakeDshAdapter extends Service {
  readonly tools = new Map<string, NookToolSpec>()

  constructor(ctx: Context) {
    super(ctx, 'nookDsh')
  }

  registerTool(spec: NookToolSpec): () => void {
    this.tools.set(spec.name, spec)
    return () => {
      this.tools.delete(spec.name)
    }
  }
}

class FakeProjectFeature extends Service {
  constructor(ctx: Context) {
    super(ctx, 'nookProjectFeature')
  }
  async listProjects() {
    return []
  }
  async findProject() {
    return undefined
  }
  async createProject() {
    throw new Error('not invoked')
  }
  async updateProject() {
    throw new Error('not invoked')
  }
  async deleteProject() {}
  onProjectEvent() {
    return () => undefined
  }
}

class FakePreviewFeature extends Service {
  constructor(ctx: Context) {
    super(ctx, 'nookPreview')
  }
  async capture() {
    throw new Error('not invoked')
  }
}

test('Agent Tools clean up on unmount and register again on remount', async () => {
  const ctx = new Context()
  await ctx.plugin(FakeDshAdapter)
  await ctx.plugin(FakeProjectFeature)
  await ctx.plugin(FakePreviewFeature)

  const first = await ctx.plugin(AgentFeature)
  const adapter = ctx.nookDsh as FakeDshAdapter
  assert.deepEqual([...adapter.tools.keys()].sort(), [
    'nook_preview_capture',
    'nook_project_create',
    'nook_project_list',
  ])
  await first.dispose()
  assert.equal(adapter.tools.size, 0)

  const second = await ctx.plugin(AgentFeature)
  assert.equal(adapter.tools.size, 3)
  await second.dispose()
  assert.equal(adapter.tools.size, 0)
  await ctx.fiber.dispose()
})
