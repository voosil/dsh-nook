import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import * as Notebook from '../../packages/provider-notebook-local/src/index.ts'
import TaskProvider from '../../packages/provider-task-sync/src/index.ts'
import { TaskEngine } from '../../packages/feature-tasks/src/engine.ts'
import { defaultSettings, taskInputSchema, type TaskStore } from '../../packages/capability-task/src/index.ts'
import { synchronize } from '../../packages/feature-sync/src/engine.ts'
import type { SyncStorage } from '../../packages/capability-sync/src/index.ts'
class Remote implements SyncStorage {
  values = new Map<string, { bytes: Uint8Array; etag: string }>()
  async probe() {}
  async get(path: string) {
    return this.values.get(path) ?? null
  }
  async put(path: string, bytes: Uint8Array, expected: string | null) {
    const old = this.values.get(path)
    if ((old?.etag ?? null) !== expected) return false
    this.values.set(path, { bytes: bytes.slice(), etag: createHash('sha256').update(bytes).digest('hex') })
    return true
  }
}
const execution = { run: async () => ({ error: 'not configured' }), cancel: async () => {}, recover: async () => null }
test('two real SQLite replicas exchange commands and receipts without double execution; state survives restart', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nook-task-system-')),
    contexts: Context[] = [],
    engines: TaskEngine[] = []
  t.after(async () => {
    for (const engine of engines) await engine.dispose()
    for (const ctx of contexts) await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  const boot = async (name: string) => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(Notebook, {
      file: join(root, name + '.sqlite'),
      projectsFile: join(root, name + '-projects.json'),
    })
    await ctx.plugin(TaskProvider, { identity: join(root, name + '-device') })
    const engine = new TaskEngine(ctx.nookTaskStore, execution)
    engines.push(engine)
    return { ctx, engine, store: ctx.nookTaskStore as TaskStore }
  }
  const owner = await boot('owner'),
    client = await boot('client'),
    remote = new Remote(),
    sync = (ctx: Context) =>
      synchronize(ctx.nookSyncReplica, remote, 'https://test/tasks/', new AbortController().signal)
  await owner.engine.configure({ ...defaultSettings(), ownerId: owner.store.deviceId })
  await sync(owner.ctx)
  await sync(client.ctx)
  const request = {
    id: randomUUID(),
    deviceId: client.store.deviceId,
    createdAt: new Date().toISOString(),
    command: { op: 'create' as const, taskId: randomUUID(), input: taskInputSchema.parse({ title: '远端手动任务' }) },
  }
  assert.equal((await client.engine.submit(request)).status, 'pending')
  assert.equal(client.engine.snapshot().tasks.length, 0)
  await sync(client.ctx)
  await sync(owner.ctx)
  await owner.engine.tick()
  await sync(owner.ctx)
  await sync(client.ctx)
  assert.equal((await client.engine.submit(request)).status, 'applied')
  assert.equal(owner.engine.snapshot().tasks.length, 1)
  assert.equal(client.engine.snapshot().tasks.length, 1)
  await owner.engine.tick()
  assert.equal(owner.engine.snapshot().tasks.length, 1)
  await owner.engine.dispose()
  await owner.ctx.fiber.dispose()
  const restarted = await boot('owner')
  assert.equal(restarted.store.deviceId, owner.store.deviceId)
  assert.equal(restarted.engine.snapshot().tasks.length, 1)
  assert.equal(restarted.engine.snapshot().receipts[0]!.id, request.id)
  const task = client.engine.snapshot().tasks[0]!
  const pause = {
    id: randomUUID(),
    deviceId: client.store.deviceId,
    createdAt: new Date().toISOString(),
    command: { op: 'action' as const, taskId: task.id, revision: task.revision, action: 'pause' as const, detail: '' },
  }
  assert.equal((await client.engine.submit(pause)).status, 'pending')
  assert.equal(client.engine.snapshot().tasks[0]!.status, 'todo')
  await sync(client.ctx)
  await sync(restarted.ctx)
  await restarted.engine.tick()
  await sync(restarted.ctx)
  await sync(client.ctx)
  assert.equal(client.engine.snapshot().tasks[0]!.status, 'paused')
})

test('shared storage atomically assigns one execution host even before replicas exchange settings', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nook-task-authority-'))
  const { default: Storage } = await import('../../packages/adapter-sync-webdav/src/index.ts')
  const { default: Sync } = await import('../../packages/feature-sync/src/index.ts')
  const { startWebDav } = await import('../helpers/webdav.mjs')
  const server = await startWebDav(),
    contexts: Context[] = []
  t.after(async () => {
    for (const ctx of contexts) await ctx.fiber.dispose()
    await server.close()
    await rm(root, { recursive: true, force: true })
  })
  for (const name of ['a', 'b']) {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(Notebook, { file: join(root, name + '.sqlite'), projectsFile: join(root, name + '.json') })
    await ctx.plugin(Storage)
    await ctx.plugin(Sync, { file: join(root, name + '-sync.json') })
    await ctx.nookSync.configure(
      { enabled: true, url: server.url, username: 'tester', password: 'secret' },
      AbortSignal.timeout(30000),
    )
  }
  const ids = [randomUUID(), randomUUID()]
  const results = await Promise.all(
    contexts.map((ctx, i) => ctx.nookSync.claimTaskOwner(ids[i]!, AbortSignal.timeout(30000))),
  )
  assert.equal(results.filter(Boolean).length, 1)
  const winner = results.indexOf(true)
  for (const ctx of contexts) {
    assert.equal(await ctx.nookSync.claimTaskOwner(ids[winner]!, AbortSignal.timeout(30000)), true)
    assert.equal(await ctx.nookSync.claimTaskOwner(ids[1 - winner]!, AbortSignal.timeout(30000)), false)
  }
  assert.equal(JSON.parse(server.data.get('/nook/authority-task-owner.json').bytes).ownerId, ids[winner])
})
