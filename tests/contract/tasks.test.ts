import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { TaskEngine, newTask } from '../../packages/feature-tasks/src/engine.ts'
import { wallTime, latestOccurrence } from '../../packages/feature-tasks/src/calendar.ts'
import {
  recordSchemas,
  defaultSettings,
  taskInputSchema,
  emptyTiming,
  type TaskStore,
  type RecordType,
  type RecordValue,
  type TaskCommand,
  type TaskRun,
  type TaskReport,
  type TaskInput,
} from '../../packages/capability-task/src/index.ts'
import type { ExecutionService } from '../../packages/capability-execution/src/index.ts'
import { MemoryTaskStore } from '../helpers/task-store.ts'
const execution: ExecutionService = {
  run: async () => ({ error: 'No executor configured' }),
  cancel: async () => {},
  recover: async () => null,
}
const report: TaskReport = {
  summary: '交付页面',
  artifacts: [{ name: '页面', uri: '/tmp/page.html', version: 'v1' }],
  checks: [{ name: '交互', passed: true, evidence: '打开页面并完成提交' }],
}
function fixture() {
  let now = Date.parse('2026-09-10T01:00:00Z')
  const store = new MemoryTaskStore()
  store.write([{ type: 'task-settings', value: { ...defaultSettings(), ownerId: store.deviceId, revision: 1 } }])
  const engine = new TaskEngine(store, execution, () => now)
  return {
    store,
    engine,
    get now() {
      return now
    },
    advance(value: number) {
      now = value
    },
    async cmd(command: TaskCommand) {
      return engine.submit({
        id: randomUUID(),
        createdAt: new Date(now).toISOString(),
        deviceId: store.deviceId,
        command,
      })
    },
    async create(input: Partial<TaskInput> = {}) {
      const taskId = randomUUID()
      const receipt = await this.cmd({
        op: 'create',
        taskId,
        input: taskInputSchema.parse({ title: '准备 PPT', ...input }),
      })
      assert.equal(receipt.status, 'applied', receipt.message)
      return store.get('task', taskId)!
    },
  }
}

test('manual tasks keep distinct reminder/start/deadline, reorder and complete', async () => {
  const f = fixture(),
    a = await f.create(),
    b = await f.create()
  assert.equal(a.status, 'todo')
  await f.cmd({ op: 'reorder', ids: [b.id, a.id] })
  assert.equal(f.engine.snapshot().tasks[0]!.id, b.id)
  const timing = {
    ...emptyTiming('Asia/Shanghai'),
    remindAt: '2026-09-10T02:00:00Z',
    startAt: '2026-09-10T03:00:00Z',
    dueAt: '2026-09-11T01:00:00Z',
  }
  let task = f.store.get('task', a.id)!
  await f.cmd({
    op: 'update',
    taskId: a.id,
    revision: task.revision,
    input: taskInputSchema.parse({ ...pick(task), timing }),
  })
  await f.engine.tick(Date.parse('2026-09-10T02:05:00Z'))
  assert.equal(f.store.list('task-notification').length, 1)
  await f.engine.tick(Date.parse('2026-09-10T02:10:00Z'))
  assert.equal(f.store.list('task-notification').length, 1)
  task = f.store.get('task', a.id)!
  assert.equal(task.status, 'todo')
  await f.cmd({ op: 'action', taskId: a.id, revision: task.revision, action: 'complete', detail: '' })
  assert.equal(f.store.get('task', a.id)!.status, 'done')
  await f.engine.dispose()
})
function pick(task: Record<string, unknown>) {
  return Object.fromEntries(Object.keys(taskInputSchema.shape).map(key => [key, task[key]]))
}

test('duplicate requests are idempotent and non-owner waits for receipt', async () => {
  const f = fixture(),
    id = randomUUID(),
    taskId = randomUUID(),
    request = {
      id,
      deviceId: f.store.deviceId,
      createdAt: new Date(f.now).toISOString(),
      command: { op: 'create' as const, taskId, input: taskInputSchema.parse({ title: '一次' }) },
    }
  const a = await f.engine.submit(request),
    b = await f.engine.submit(request)
  assert.deepEqual(a, b)
  assert.equal(f.store.list('task').length, 1)
  await assert.rejects(
    f.engine.submit({
      ...request,
      command: { ...request.command, input: { ...request.command.input, title: '其他' } },
    }),
    /标识/,
  )
  f.store.write([{ type: 'task-settings', value: { ...f.engine.settings(), ownerId: 'another-device' } }])
  const pending = await f.cmd({
    op: 'create',
    taskId: randomUUID(),
    input: taskInputSchema.parse({ title: '等待主机' }),
  })
  assert.equal(pending.status, 'pending')
  assert.equal(f.store.list('task').length, 1)
  await f.engine.dispose()
})

test('external claims require readiness, exclusive ownership and fresh tokens', async () => {
  const f = fixture(),
    task = await f.create({
      assignee: 'agent',
      executor: 'external',
      description: '准备十页产品介绍',
      acceptance: '能打开并包含十页',
    })
  const claim = await f.cmd({
    op: 'claim',
    taskId: task.id,
    revision: task.revision,
    executor: 'external-worker',
    phase: 'execution',
  })
  assert.equal(claim.status, 'applied', claim.message)
  const duplicate = await f.cmd({
    op: 'claim',
    taskId: task.id,
    revision: f.store.get('task', task.id)!.revision,
    executor: 'other-worker',
    phase: 'execution',
  })
  assert.equal(duplicate.status, 'conflict')
  assert.equal((await f.cmd({ op: 'report', runId: claim.runId!, token: 'wrong', report })).status, 'conflict')
  assert.equal((await f.cmd({ op: 'report', runId: claim.runId!, token: claim.token!, report })).status, 'applied')
  assert.equal(f.store.get('task', task.id)!.status, 'review')
  assert.equal((await f.cmd({ op: 'report', runId: claim.runId!, token: claim.token!, report })).status, 'conflict')
  await f.engine.dispose()
})

test('AI acceptance allows two repairs and then asks for intervention', async () => {
  const f = fixture(),
    task = await f.create({
      assignee: 'agent',
      executor: 'external',
      description: '实现页面',
      acceptance: '表单可提交',
      aiReview: true,
    })
  for (let round = 0; round < 3; round++) {
    let t = f.store.get('task', task.id)!,
      claim = await f.cmd({ op: 'claim', taskId: t.id, revision: t.revision, executor: 'worker', phase: 'execution' })
    assert.equal(claim.status, 'applied', claim.message)
    await f.cmd({
      op: 'report',
      runId: claim.runId!,
      token: claim.token!,
      report: { ...report, artifacts: [{ ...report.artifacts[0]!, version: 'v' + round }] },
    })
    t = f.store.get('task', task.id)!
    claim = await f.cmd({ op: 'claim', taskId: t.id, revision: t.revision, executor: 'reviewer', phase: 'review' })
    assert.equal(claim.status, 'applied', claim.message)
    await f.cmd({
      op: 'review',
      runId: claim.runId!,
      token: claim.token!,
      result: {
        verdict: 'fail',
        summary: '提交按钮不可用',
        scopeChange: false,
        checks: [{ criterion: '表单提交', verdict: 'fail', evidence: '点击按钮无响应' }],
      },
    })
    assert.equal(f.store.get('task', task.id)!.status, round < 2 ? 'queued' : 'attention')
  }
  assert.equal(f.store.get('task', task.id)!.reworks, 2)
  await f.engine.dispose()
})

test('unverified evidence never becomes automatically accepted', async () => {
  const f = fixture(),
    task = await f.create({
      assignee: 'agent',
      executor: 'external',
      description: '实现页面',
      acceptance: '可打开',
      aiReview: true,
    })
  let claim = await f.cmd({
    op: 'claim',
    taskId: task.id,
    revision: task.revision,
    executor: 'worker',
    phase: 'execution',
  })
  await f.cmd({ op: 'report', runId: claim.runId!, token: claim.token!, report })
  claim = await f.cmd({
    op: 'claim',
    taskId: task.id,
    revision: f.store.get('task', task.id)!.revision,
    executor: 'reviewer',
    phase: 'review',
  })
  await f.cmd({
    op: 'review',
    runId: claim.runId!,
    token: claim.token!,
    result: {
      verdict: 'pass',
      summary: '看起来完成',
      scopeChange: false,
      checks: [{ criterion: '打开页面', verdict: 'unverified', evidence: '无法访问' }],
    },
  })
  assert.equal(f.store.get('task', task.id)!.status, 'attention')
  await f.engine.dispose()
})

test('dependency cycles, expired deadlines and occupied default directories block execution', async () => {
  const f = fixture(),
    a = await f.create({ assignee: 'agent', executor: 'external', description: '执行', acceptance: '检查完成' }),
    b = await f.create({
      assignee: 'agent',
      executor: 'external',
      description: '执行',
      acceptance: '检查完成',
      dependencies: [a.id],
    })
  assert.equal(
    (await f.cmd({ op: 'claim', taskId: b.id, revision: b.revision, executor: 'worker', phase: 'execution' })).status,
    'conflict',
  )
  assert.equal(
    (
      await f.cmd({
        op: 'update',
        taskId: a.id,
        revision: a.revision,
        input: taskInputSchema.parse({ ...pick(a), dependencies: [b.id] }),
      })
    ).status,
    'conflict',
  )
  const claimed = await f.cmd({
    op: 'claim',
    taskId: a.id,
    revision: a.revision,
    executor: 'worker',
    phase: 'execution',
  })
  assert.equal(claimed.status, 'applied')
  const c = await f.create({ assignee: 'agent', executor: 'external', description: '执行', acceptance: '检查完成' })
  assert.equal(
    (await f.cmd({ op: 'claim', taskId: c.id, revision: c.revision, executor: 'worker2', phase: 'execution' })).status,
    'conflict',
  )
  const expired = await f.create({
    assignee: 'agent',
    executor: 'external',
    description: '执行',
    acceptance: '检查完成',
    timing: { ...emptyTiming(), dueAt: '2026-09-09T01:00:00Z' },
  })
  assert.equal(f.store.get('task', expired.id)!.status, 'attention')
  await f.engine.dispose()
})

test('recurrence resolves local calendar time, skips DST gaps, and only materializes latest missed occurrence', async () => {
  assert.equal(wallTime('2026-03-08', '02:30:00', 'America/New_York'), null)
  assert.equal(wallTime('2026-11-01', '01:30:00', 'America/New_York'), Date.parse('2026-11-01T05:30:00Z'))
  const f = fixture(),
    template = await f.create({
      timing: { ...emptyTiming('Asia/Shanghai'), startAt: '2026-09-01T01:00:00Z', repeat: 'weekly', weekdays: [1, 4] },
    })
  const instances = f.store.list('task').filter(t => t.seriesId === template.id)
  assert.equal(instances.length, 1)
  assert.equal(instances[0]!.occurrenceAt, '2026-09-10T01:00:00.000Z')
  await f.engine.tick()
  assert.equal(f.store.list('task').filter(t => t.seriesId === template.id).length, 1)
  assert.equal(latestOccurrence(template, Date.parse('2026-09-14T02:00:00Z')), '2026-09-14T01:00:00.000Z')
  await f.engine.dispose()
})

test('proposal approval is version-bound, creates a dependency graph and pauses its children', async () => {
  const f = fixture(),
    id = randomUUID(),
    step = taskInputSchema.parse({
      title: '实现',
      assignee: 'agent',
      executor: 'external',
      description: '实现页面',
      acceptance: '页面可用',
    })
  f.store.write([
    {
      type: 'task-proposal',
      value: {
        id,
        revision: 1,
        topic: 'UI',
        summary: '统一 UI',
        scope: '两个组件',
        consequences: '先迁移组件',
        decision: '可用',
        status: 'ready',
        sources: [],
        steps: [
          { key: 'a', task: step, after: [] },
          { key: 'b', task: { ...step, title: '迁移' }, after: ['a'] },
        ],
        feedback: '',
        planId: null,
        updatedAt: new Date(f.now).toISOString(),
      },
    },
  ])
  assert.equal(
    (await f.cmd({ op: 'proposal', proposalId: id, revision: 2, action: 'approve', text: '' })).status,
    'conflict',
  )
  const receipt = await f.cmd({ op: 'proposal', proposalId: id, revision: 1, action: 'approve', text: '' })
  assert.equal(receipt.status, 'applied', receipt.message)
  const plan = f.store.get('task', receipt.taskId!)!,
    children = f.store.list('task').filter(t => t.parentId === plan.id)
  assert.equal(children.length, 2)
  assert.equal(children[1]!.dependencies[0], children[0]!.id)
  await f.cmd({ op: 'action', taskId: plan.id, revision: plan.revision, action: 'pause', detail: '' })
  assert.ok(f.store.list('task').every(t => t.status === 'paused'))
  await f.engine.dispose()
})

test('successful AI acceptance completes the submitted artifact revision and rejects stale review credentials', async () => {
  const f = fixture(),
    task = await f.create({
      assignee: 'agent',
      executor: 'external',
      description: '实现页面',
      acceptance: '可打开',
      aiReview: true,
    })
  let claim = await f.cmd({
    op: 'claim',
    taskId: task.id,
    revision: task.revision,
    executor: 'worker',
    phase: 'execution',
  })
  await f.cmd({ op: 'report', runId: claim.runId!, token: claim.token!, report })
  claim = await f.cmd({
    op: 'claim',
    taskId: task.id,
    revision: f.store.get('task', task.id)!.revision,
    executor: 'reviewer',
    phase: 'review',
  })
  const command: TaskCommand = {
    op: 'review',
    runId: claim.runId!,
    token: claim.token!,
    result: {
      verdict: 'pass',
      summary: '已打开并核对',
      scopeChange: false,
      checks: [{ criterion: '可打开', verdict: 'pass', evidence: '浏览器打开实际产物并完成交互' }],
    },
  }
  assert.equal((await f.cmd(command)).status, 'applied')
  assert.equal(f.store.get('task', task.id)!.status, 'done')
  assert.equal(f.store.list('task-review')[0]!.artifactRevision, 1)
  assert.equal((await f.cmd(command)).status, 'conflict')
  await f.engine.dispose()
})
