import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { Context, Service } from '@deepseek-ai/cordis'
import Registry from '@deepseek-ai/dsh-typert-registry'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import * as Notebook from '../../../packages/provider-notebook-local/src/index.ts'
import TaskProvider from '../../../packages/provider-task-sync/src/index.ts'
import Tasks from '../../../packages/feature-tasks/src/index.ts'
import Rpc from '../../../packages/adapter-tasks-dsh/src/index.ts'
import { callBridge } from '../../../packages/adapter-task-mcp/src/index.ts'
import { defaultSettings, taskInputSchema, snapshotSchema } from '../../../packages/capability-task/src/index.ts'
import type { NookToolSpec } from '../../../packages/dsh-adapter/src/index.ts'

test('Gateway, conversation tools and local MCP bridge share persisted task operations and clean up', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nook-task-rpc-')),
    ctx = new Context(),
    tools = new Map<string, NookToolSpec>()
  t.after(async () => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  await ctx.plugin(Registry)
  await ctx.plugin(Gateway)
  await ctx.plugin(Notebook, { file: join(root, 'notes.sqlite'), projectsFile: join(root, 'projects.json') })
  await ctx.plugin(TaskProvider, { identity: join(root, 'device') })
  await ctx.plugin(
    class Execution extends Service {
      constructor(ctx: Context) {
        super(ctx, 'nookExecution')
      }
      async run() {
        return { error: 'unconfigured' }
      }
      async cancel() {}
      async recover() {
        return null
      }
    },
  )
  await ctx.plugin(
    class Generation extends Service {
      constructor(ctx: Context) {
        super(ctx, 'nookGeneration')
      }
      async models() {
        return []
      }
      async generate() {
        return ''
      }
    },
  )
  await ctx.plugin(
    class Refinement extends Service {
      constructor(ctx: Context) {
        super(ctx, 'nookRefinement')
      }
      async tick() {}
    },
  )
  await ctx.plugin(
    class Dsh extends Service {
      constructor(ctx: Context) {
        super(ctx, 'nookDsh')
      }
      registerTool(spec: NookToolSpec) {
        tools.set(spec.name, spec)
        return () => {
          tools.delete(spec.name)
        }
      }
    },
  )
  await ctx.plugin(
    class Sync extends Service {
      constructor(ctx: Context) {
        super(ctx, 'nookSync')
      }
      async claimTaskOwner() {
        return true
      }
    },
  )
  await ctx.plugin(Tasks)
  const connection = join(root, 'connection.json'),
    plugin = await ctx.plugin(Rpc, { connection })
  assert.equal(tools.size, 2)
  await ctx.nookTasks.configure({ ...defaultSettings(), ownerId: ctx.nookTaskStore.deviceId })
  const taskId = randomUUID(),
    request = {
      id: randomUUID(),
      deviceId: ctx.nookTaskStore.deviceId,
      createdAt: new Date().toISOString(),
      command: { op: 'create' as const, taskId, input: taskInputSchema.parse({ title: '通过对话安排 PPT' }) },
    }
  const result = (await ctx.typertGateway.invoke({
    namespace: 'nookTasksRpc',
    method: 'submit',
    args: { request },
  })) as { ok: boolean; value: { status: string } }
  assert.equal(result.ok, true)
  assert.equal(result.value.status, 'applied')
  await assert.rejects(
    ctx.typertGateway.invoke({
      namespace: 'nookTasksRpc',
      method: 'submit',
      args: { request: { ...request, command: { op: 'erase-everything' } } },
    }),
    /boundary validation/,
  )
  for (let retry = 0; retry < 20; retry++) {
    try {
      await readFile(connection)
      break
    } catch {
      await delay(10)
    }
  }
  const snapshot = snapshotSchema.parse(await callBridge(connection, 'snapshot'))
  assert.equal(snapshot.tasks[0]!.id, taskId)
  const viaTool = (await tools.get('nook_task_list')!.execute({}, new AbortController().signal)) as { json: string }
  assert.equal(JSON.parse(viaTool.json).tasks[0].id, taskId)
  const require = createRequire(new URL('../../../packages/adapter-task-mcp/package.json', import.meta.url))
  const { Client } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')).href)
  const { StdioClientTransport } = await import(
    pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href
  )
  const client = new Client({ name: 'nook-acceptance', version: '1.0.0' })
  t.after(() => client.close())
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('../../../packages/adapter-task-mcp/lib/index.js', import.meta.url)), connection],
      stderr: 'pipe',
    }),
  )
  const catalog = await client.listTools()
  assert.deepEqual(catalog.tools.map((tool: { name: string }) => tool.name).sort(), [
    'nook_task_command',
    'nook_task_list',
  ])
  const listed = await client.callTool({ name: 'nook_task_list', arguments: {} })
  assert.equal(JSON.parse(listed.content[0].text).tasks[0].id, taskId)
  const another = randomUUID()
  const created = await client.callTool({
    name: 'nook_task_command',
    arguments: {
      requestId: randomUUID(),
      command: { op: 'create', taskId: another, input: taskInputSchema.parse({ title: 'MCP stdio 创建' }) },
    },
  })
  assert.equal(JSON.parse(created.content[0].text).status, 'applied')
  assert.ok(ctx.nookTasks.snapshot().tasks.some(task => task.id === another))
  await client.close()
  await plugin.dispose()
  assert.equal(tools.size, 0)
  await assert.rejects(callBridge(connection, 'snapshot'))
})
