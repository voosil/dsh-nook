import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import Adapter from '../../packages/adapter-execution-dsh/src/index.ts'
import { newTask } from '../../packages/feature-tasks/src/engine.ts'
import { taskInputSchema, type TaskRun } from '../../packages/capability-task/src/index.ts'

test('DSH adapter requires explicit evidence, persists reports, and rejects changed artifacts during acceptance', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nook-task-execution-')),
    ctx = new Context(),
    file = join(root, 'page.html')
  t.after(async () => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  await writeFile(file, '<h1>actual artifact</h1>')
  let submit: { execute: (args: { json: string }) => Promise<unknown> } | undefined,
    disposed = 0,
    flushed = 0,
    mode = 'report'
  const sessions: string[] = []
  await ctx.plugin(
    class Tools extends Service {
      constructor(ctx: Context) {
        super(ctx, 'tools')
      }
      register(tool: typeof submit) {
        submit = tool
        return () => {
          submit = undefined
        }
      }
    },
  )
  await ctx.plugin(
    class Persistence extends Service {
      constructor(ctx: Context) {
        super(ctx, 'sessionPersistence')
      }
      async flush() {
        flushed++
      }
    },
  )
  await ctx.plugin(
    class Agents extends Service {
      constructor(ctx: Context) {
        super(ctx, 'agents')
      }
      withInitiator(_agent: unknown, callback: () => void) {
        callback()
      }
      async create(options: { sessionId: string; setup: (ctx: unknown) => void }) {
        sessions.push(options.sessionId)
        const cleanup: (() => void)[] = []
        options.setup({ tools: ctx.tools, effect: (fn: () => () => void) => cleanup.push(fn()) })
        return {
          agent: {
            followup() {},
            cancel() {},
            async whenIdle() {
              if (mode === 'idle') return
              await submit!.execute({
                json: JSON.stringify(
                  mode === 'report'
                    ? {
                        summary: '完成',
                        artifacts: [{ name: '页面', uri: file, version: 'claimed' }],
                        checks: [{ name: '打开', passed: true, evidence: '实际读取' }],
                      }
                    : {
                        verdict: 'pass',
                        summary: '核验通过',
                        scopeChange: false,
                        checks: [{ criterion: '可打开', verdict: 'pass', evidence: '实际读取页面' }],
                      },
                ),
              })
            },
          },
          async dispose() {
            disposed++
            cleanup.forEach(fn => fn())
          },
        }
      }
    },
  )
  await ctx.plugin(Adapter, { root: join(root, 'results') })
  const now = Date.now(),
    task = newTask(
      randomUUID(),
      taskInputSchema.parse({ title: '页面', assignee: 'agent', description: '创建页面', acceptance: '可打开' }),
      now,
      0,
    )
  const makeRun = (phase: 'execution' | 'review'): TaskRun => ({
    id: randomUUID(),
    taskId: task.id,
    taskRevision: task.revision,
    phase,
    status: 'running',
    executor: 'dsh',
    token: randomUUID(),
    startedAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    sessionId: 'nook-test-' + randomUUID(),
    snapshot: structuredClone(task),
    report: null,
    error: '',
    artifactRevision: task.artifactRevision,
  })
  const route = { provider: 'fixture', model: 'fixture' },
    run = makeRun('execution')
  const result = await ctx.nookExecution.run(
    { run, route, cwd: root, context: 'fixed requirements' },
    AbortSignal.timeout(5000),
  )
  assert.match(result.report!.artifacts[0]!.version, /^[a-f0-9]{64}$/)
  assert.deepEqual(await ctx.nookExecution.recover(run), result)
  assert.equal(flushed, 1)
  assert.equal(submit, undefined)
  mode = 'idle'
  const idle = makeRun('execution')
  assert.ok(
    (await ctx.nookExecution.run({ run: idle, route, cwd: root, context: '' }, AbortSignal.timeout(5000))).error,
  )
  assert.equal(await ctx.nookExecution.recover(idle), null)
  task.report = result.report!
  task.artifactRevision = 1
  mode = 'review'
  const review = makeRun('review')
  await writeFile(file, 'changed after submission')
  await assert.rejects(
    ctx.nookExecution.run({ run: review, route, cwd: root, context: '' }, AbortSignal.timeout(5000)),
    /产物内容已变化/,
  )
  assert.equal(sessions.length, 2)
  assert.notEqual(sessions[0], sessions[1])
  assert.equal(disposed, 2)
})
