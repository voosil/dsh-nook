import { randomUUID, createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import {
  TaskError,
  defaultSettings,
  requestSchema,
  taskInputSchema,
  reportSchema,
  reviewSchema,
  type TaskStore,
  type Task,
  type TaskInput,
  type TaskRequest,
  type TaskReceipt,
  type TaskRun,
  type TaskSettings,
  type TaskService,
  type RecordType,
  type RecordValue,
  type TaskCommand,
  type TaskReport,
} from '@nook-dsh/capability-task'
import type { ExecutionService, ExecutionResult } from '@nook-dsh/capability-execution'
import { latestOccurrence, occurrenceTiming } from './calendar.js'

type Write = { type: RecordType; value: RecordValue<RecordType> }
const iso = (time = Date.now()) => new Date(time).toISOString()
const directoryKey = (path: string) => {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}
const terminal = (task: Task) => ['done', 'cancelled'].includes(task.status)
export function readyStatus(task: TaskInput): Task['status'] {
  if (task.assignee === 'human') return 'todo'
  if (
    task.assignee === 'unassigned' ||
    task.kind === 'plan' ||
    task.timing.vague ||
    !task.description.trim() ||
    !task.acceptance.trim()
  )
    return 'unscheduled'
  return 'queued'
}
export function newTask(id: string, input: TaskInput, now: number, order: number): Task {
  const value = taskInputSchema.parse(
    Object.fromEntries(Object.keys(taskInputSchema.shape).map(key => [key, input[key as keyof TaskInput]])),
  )
  return {
    ...value,
    id,
    revision: 1,
    status: readyStatus(value),
    order,
    createdAt: iso(now),
    updatedAt: iso(now),
    reason: '',
    activeRunId: null,
    report: null,
    artifactRevision: 0,
    reworks: 0,
    seriesId: null,
    seriesChangedAt: null,
    occurrenceAt: null,
    notifiedAt: null,
    history: [{ at: iso(now), action: 'create', detail: '建立任务' }],
  }
}
export class TaskEngine implements TaskService {
  private work: Promise<void> = Promise.resolve()
  private jobs = new Map<string, { controller: AbortController; promise: Promise<void> }>()
  private closed = false
  private executionIssue = ''
  constructor(
    readonly store: TaskStore,
    private readonly execution: ExecutionService,
    private readonly clock = Date.now,
    private readonly sourcesCurrent: (sources: Task['sources']) => Promise<boolean> = async () => true,
    private readonly ownerAuthority: () => Promise<boolean> = async () => true,
  ) {}
  snapshot() {
    return {
      deviceId: this.store.deviceId,
      executionIssue: this.executionIssue,
      isOwner: this.isOwner(),
      conflict: this.store.conflicts(),
      settings: this.settings(),
      tasks: this.store.list('task').sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
      runs: this.store.list('task-run'),
      reviews: this.store.list('task-review'),
      proposals: this.store.list('task-proposal'),
      notifications: this.store.list('task-notification'),
      receipts: this.store.list('task-receipt'),
      requests: this.store.list('task-request'),
      understandings: this.store.list('task-understanding'),
      retrospectives: this.store.list('task-retrospective'),
    }
  }
  settings() {
    return this.store.get('task-settings', 'settings') ?? defaultSettings()
  }
  isOwner() {
    return !this.store.conflicts() && this.settings().ownerId === this.store.deviceId
  }
  async configure(settings: TaskSettings) {
    if (this.settings().ownerId === null) {
      if (settings.ownerId !== this.store.deviceId) throw new TaskError('请在要执行任务的主机上启用。')
      if (this.store.list('task-settings').length && this.settings().revision !== settings.revision)
        throw new TaskError('配置已变化')
      this.validateSettings(settings)
      if (!(await this.ownerAuthority())) throw new TaskError('此同步库已由另一台主机执行，第一版不支持迁移归属。')
      this.store.write([{ type: 'task-settings', value: { ...settings, revision: 1 } }])
      return {
        id: randomUUID(),
        status: 'applied' as const,
        message: '执行主机已启用',
        taskId: null,
        runId: null,
        token: null,
        at: iso(this.clock()),
      }
    }
    return this.submit({
      id: randomUUID(),
      deviceId: this.store.deviceId,
      createdAt: iso(this.clock()),
      command: { op: 'configure', settings },
    })
  }
  private validateSettings(settings: TaskSettings) {
    for (const path of Object.values(settings.workspaces))
      if (!isAbsolute(path)) throw new TaskError('工作目录必须是执行主机上的绝对路径。')
    if (this.settings().ownerId && settings.ownerId !== this.settings().ownerId)
      throw new TaskError('第一版不支持迁移执行主机。')
  }
  async submit(input: TaskRequest) {
    const request = requestSchema.parse(input)
    const old = this.store.get('task-request', request.id)
    if (old && JSON.stringify(old) !== JSON.stringify(request)) throw new TaskError('请求标识已被其他操作使用。')
    if (!old) this.store.write([{ type: 'task-request', value: request }])
    await this.tick()
    return (
      this.store.get('task-receipt', request.id) ?? {
        id: request.id,
        status: 'pending' as const,
        message: '本机已保存，等待执行主机确认',
        taskId: null,
        runId: null,
        token: null,
        at: iso(this.clock()),
      }
    )
  }
  tick(now = this.clock()): Promise<void> {
    const next = this.work.then(() => this.advance(now))
    this.work = next.catch(() => {})
    return next
  }
  private task(id: string, revision?: number): Task {
    const task = this.store.get('task', id)
    if (!task) throw new TaskError('任务不存在')
    if (revision !== undefined && task.revision !== revision) throw new TaskError('任务已变化，请查看最新内容后重试。')
    return task
  }
  private change(task: Task, patch: Partial<Task>, action: string, detail: string, now: number): Task {
    return {
      ...task,
      ...patch,
      revision: task.revision + 1,
      updatedAt: iso(now),
      history: [...task.history, { at: iso(now), action, detail }],
    }
  }
  private notification(task: { id: string; title: string }, title: string, now: number): Write {
    return {
      type: 'task-notification',
      value: { id: randomUUID(), targetId: task.id, title, body: task.title, createdAt: iso(now), read: false },
    }
  }
  private dependencies(task: Task) {
    return task.dependencies.every(id => {
      const t = this.store.get('task', id)
      return (
        t &&
        t.status !== 'attention' &&
        t.status !== 'cancelled' &&
        (t.status === 'done' || !!t.report?.checks.every(c => c.passed))
      )
    })
  }
  private validateTask(task: TaskInput, id: string) {
    if (task.parentId === id || task.dependencies.includes(id)) throw new TaskError('任务不能依赖自身')
    if (task.parentId && this.task(task.parentId).kind !== 'plan') throw new TaskError('父任务必须是计划')
    if (task.parentId && task.kind === 'plan') throw new TaskError('计划只支持一层子任务')
    const visit = (dep: string, seen = new Set<string>()): void => {
      if (dep === id) throw new TaskError('任务依赖形成循环')
      if (seen.has(dep)) return
      seen.add(dep)
      for (const child of this.task(dep).dependencies) visit(child, seen)
    }
    task.dependencies.forEach(dep => visit(dep))
  }
  private async stop(task: Task, reason: string) {
    if (!task.activeRunId) return
    const job = this.jobs.get(task.activeRunId)
    job?.controller.abort()
    await this.execution.cancel(task.activeRunId)
    await job?.promise
    const run = this.store.get('task-run', task.activeRunId)
    if (run)
      this.store.write([
        { type: 'task-run', value: { ...run, status: 'interrupted', error: reason, updatedAt: iso(this.clock()) } },
      ])
  }
  private async command(
    command: TaskCommand,
    now: number,
  ): Promise<{ writes: Write[]; taskId?: string; runId?: string; token?: string; message?: string }> {
    const writes: Write[] = []
    if (command.op === 'create') {
      if (this.store.get('task', command.taskId)) throw new TaskError('任务标识已存在')
      this.validateTask(command.input, command.taskId)
      writes.push({
        type: 'task',
        value: newTask(
          command.taskId,
          command.input,
          now,
          this.store.list('task').reduce((n, t) => Math.max(n, t.order + 1), 0),
        ),
      })
      return { writes, taskId: command.taskId }
    }
    if (command.op === 'configure') {
      this.validateSettings(command.settings)
      if (command.settings.revision !== this.settings().revision) throw new TaskError('配置已变化，请刷新后重试')
      writes.push({ type: 'task-settings', value: { ...command.settings, revision: command.settings.revision + 1 } })
      return { writes }
    }
    if (command.op === 'read') {
      const n = this.store.get('task-notification', command.notificationId)
      if (n) writes.push({ type: 'task-notification', value: { ...n, read: true } })
      return { writes }
    }
    if (command.op === 'reorder') {
      if (new Set(command.ids).size !== command.ids.length) throw new TaskError('顺序包含重复任务')
      const tasks = command.ids.map(id => this.task(id))
      tasks.forEach((task, order) =>
        writes.push({ type: 'task', value: this.change(task, { order }, 'reorder', '调整顺序', now) }),
      )
      return { writes }
    }
    if (command.op === 'proposal') {
      const proposal = this.store.get('task-proposal', command.proposalId)
      if (!proposal || proposal.revision !== command.revision || proposal.status === 'approved')
        throw new TaskError('提案已变化，请阅读最新版本。')
      if (command.action === 'approve') {
        if (proposal.status !== 'ready') throw new TaskError('提案尚未准备好')
        if (!(await this.sourcesCurrent(proposal.sources))) throw new TaskError('提案依据已经变化，请重新整理后确认。')
        if (this.store.get('task-proposal', proposal.id)?.revision !== proposal.revision)
          throw new TaskError('提案已经更新，请重新评审。')
        const planId = randomUUID(),
          ids = new Map(proposal.steps.map(step => [step.key, randomUUID()]))
        if (ids.size !== proposal.steps.length) throw new TaskError('提案包含重复步骤')
        const visiting = new Set<string>(),
          visited = new Set<string>()
        const visit = (key: string) => {
          if (visiting.has(key)) throw new TaskError('提案依赖形成循环')
          if (visited.has(key)) return
          const step = proposal.steps.find(s => s.key === key)
          if (!step) throw new TaskError('提案引用不存在的步骤')
          visiting.add(key)
          step.after.forEach(visit)
          visiting.delete(key)
          visited.add(key)
        }
        proposal.steps.forEach(s => visit(s.key))
        const plan = newTask(
          planId,
          taskInputSchema.parse({
            title: proposal.topic,
            kind: 'plan',
            assignee: 'agent',
            description: proposal.summary,
            scope: proposal.scope,
            acceptance: proposal.steps.map(step => step.task.acceptance).join('\n'),
            sources: proposal.sources,
          }),
          now,
          this.store.list('task').length,
        )
        plan.status = 'running'
        writes.push({ type: 'task', value: plan })
        for (const [index, step] of proposal.steps.entries())
          writes.push({
            type: 'task',
            value: newTask(
              ids.get(step.key)!,
              {
                ...step.task,
                parentId: planId,
                dependencies: step.after.map(key => ids.get(key)!),
                sources: proposal.sources,
              },
              now,
              plan.order + index + 1,
            ),
          })
        writes.push({
          type: 'task-proposal',
          value: { ...proposal, status: 'approved', revision: proposal.revision + 1, planId, updatedAt: iso(now) },
        })
        return { writes, taskId: planId }
      }
      writes.push({
        type: 'task-proposal',
        value: {
          ...proposal,
          status: command.action === 'defer' ? 'deferred' : 'draft',
          feedback: command.text,
          revision: proposal.revision + 1,
          updatedAt: iso(now),
        },
      })
      return { writes }
    }
    if (command.op === 'heartbeat' || command.op === 'report' || command.op === 'review') {
      const run = this.store.get('task-run', command.runId)
      if (!run || run.token !== command.token || !['claimed', 'running'].includes(run.status))
        throw new TaskError('领取凭据已失效，不能覆盖当前结果。')
      const task = this.task(run.taskId)
      if (task.activeRunId !== run.id) throw new TaskError('这次执行已被替代')
      if (command.op === 'heartbeat')
        return { writes: [{ type: 'task-run', value: { ...run, updatedAt: iso(now) } }], runId: run.id }
      if (command.op === 'report') {
        if (run.phase !== 'execution') throw new TaskError('验收执行不能提交实现结果')
        const report = reportSchema.parse(command.report),
          passed = report.checks.every(c => c.passed)
        const updated = this.change(
          task,
          {
            report,
            artifactRevision: task.artifactRevision + 1,
            status: passed ? 'review' : 'attention',
            activeRunId: null,
            reason: passed ? '' : '工程检查未通过',
          },
          'report',
          report.summary,
          now,
        )
        writes.push(
          { type: 'task', value: updated },
          { type: 'task-run', value: { ...run, status: 'submitted', report, updatedAt: iso(now) } },
        )
        if ((!task.parentId && !task.aiReview) || !passed)
          writes.push(this.notification(task, passed ? '任务待验收' : '任务需要介入', now))
      } else {
        if (run.phase !== 'review' || run.artifactRevision !== task.artifactRevision)
          throw new TaskError('产物已变化，请重新验收')
        const result = reviewSchema.parse(command.result)
        const passed =
          result.verdict === 'pass' &&
          !result.scopeChange &&
          result.checks.every(c => c.verdict === 'pass' && c.evidence.trim())
        const repair =
          !passed &&
          result.verdict === 'fail' &&
          !result.scopeChange &&
          result.checks.every(c => c.verdict !== 'unverified') &&
          task.reworks < 2
        const updated = this.change(
          task,
          {
            status: passed ? 'done' : repair ? 'queued' : 'attention',
            activeRunId: null,
            reworks: task.reworks + (repair ? 1 : 0),
            reason: passed ? '' : result.summary,
          },
          'review',
          result.summary,
          now,
        )
        writes.push(
          { type: 'task', value: updated },
          { type: 'task-run', value: { ...run, status: 'finished', updatedAt: iso(now) } },
          {
            type: 'task-review',
            value: {
              ...result,
              id: randomUUID(),
              taskId: task.id,
              runId: run.id,
              artifactRevision: task.artifactRevision,
              createdAt: iso(now),
            },
          },
        )
        if (passed && task.kind === 'plan')
          for (const child of this.store.list('task').filter(t => t.parentId === task.id && !terminal(t))) {
            writes.push({
              type: 'task',
              value: this.change(child, { status: 'done' }, 'accepted', '所属计划整体验收通过', now),
            })
          }
        if (!passed && !repair) writes.push(this.notification(task, '验收需要介入', now))
      }
      return { writes, taskId: task.id, runId: run.id }
    }
    const task = this.task(command.taskId, command.revision)
    if (command.op === 'claim') {
      if (
        task.assignee !== 'agent' ||
        task.activeRunId ||
        task.timing.repeat !== 'none' ||
        (!!task.parentId && this.task(task.parentId).status !== 'running')
      )
        throw new TaskError('任务当前不可领取')
      if (
        command.phase === 'execution' &&
        (task.status !== 'queued' ||
          !this.dependencies(task) ||
          task.timing.vague ||
          (!!task.timing.startAt && Date.parse(task.timing.startAt) > now) ||
          (!!task.timing.dueAt && Date.parse(task.timing.dueAt) < now))
      )
        throw new TaskError('任务尚未满足执行条件')
      if (command.phase === 'review' && (task.status !== 'review' || !task.aiReview || !task.report))
        throw new TaskError('任务当前不能进行 AI 验收')
      if (command.executor !== 'dsh' && task.executor !== 'external') throw new TaskError('此任务由 Nook 执行器负责')
      const running = this.store.list('task-run').filter(r => ['claimed', 'running'].includes(r.status))
      if (running.length >= this.settings().concurrency) throw new TaskError('当前执行位已满')
      if (
        task.writes &&
        running.some(
          r =>
            r.snapshot.writes &&
            directoryKey(this.settings().workspaces[r.snapshot.workspace] ?? process.cwd()) ===
              directoryKey(this.settings().workspaces[task.workspace] ?? process.cwd()),
        )
      )
        throw new TaskError('同一工作目录已有写入任务')
      const run: TaskRun = {
        id: randomUUID(),
        taskId: task.id,
        taskRevision: task.revision,
        phase: command.phase,
        status: 'claimed',
        executor: command.executor,
        token: randomUUID(),
        startedAt: iso(now),
        updatedAt: iso(now),
        sessionId: null,
        snapshot: task,
        report: null,
        error: '',
        artifactRevision: task.artifactRevision,
      }
      run.sessionId = 'nook-task-' + run.id
      writes.push(
        { type: 'task-run', value: run },
        {
          type: 'task',
          value: this.change(
            task,
            { activeRunId: run.id, status: command.phase === 'execution' ? 'running' : 'review', reason: '' },
            'claim',
            '开始' + (command.phase === 'execution' ? '执行' : '验收'),
            now,
          ),
        },
      )
      return { writes, taskId: task.id, runId: run.id, token: run.token }
    }
    if (command.op === 'update') {
      this.validateTask(command.input, task.id)
      const basisKeys = [
        'title',
        'description',
        'scope',
        'constraints',
        'sources',
        'workspace',
        'assignee',
        'executor',
        'dependencies',
        'route',
      ] as const
      const basisChanged = basisKeys.some(key => JSON.stringify(task[key]) !== JSON.stringify(command.input[key]))
      const reviewChanged =
        task.acceptance !== command.input.acceptance ||
        task.reviewRoute !== command.input.reviewRoute ||
        task.aiReview !== command.input.aiReview
      const currentRun = task.activeRunId ? this.store.get('task-run', task.activeRunId) : undefined
      const needsStop = basisChanged || (reviewChanged && currentRun?.phase === 'review')
      if (needsStop) await this.stop(task, '执行依据被修改')
      const fresh = this.task(task.id)
      const report = basisChanged ? null : fresh.report
      let status: Task['status'] = fresh.status
      if (needsStop && task.activeRunId) status = 'paused'
      else if (report && reviewChanged) status = 'review'
      else if (!fresh.activeRunId && !report && fresh.kind !== 'plan' && !terminal(fresh))
        status = readyStatus(command.input)
      if (basisChanged && task.kind === 'plan') {
        for (const child of this.store.list('task').filter(t => t.parentId === task.id && !terminal(t))) {
          await this.stop(child, '计划方案已修改')
          writes.push({
            type: 'task',
            value: this.change(
              this.task(child.id),
              { status: 'paused', activeRunId: null },
              'pause',
              '计划方案已修改',
              now,
            ),
          })
        }
        status = 'attention'
      }
      writes.push({
        type: 'task',
        value: this.change(
          fresh,
          {
            ...command.input,
            seriesChangedAt:
              JSON.stringify(task.timing) !== JSON.stringify(command.input.timing) ? iso(now) : task.seriesChangedAt,
            status,
            activeRunId: needsStop ? null : fresh.activeRunId,
            reason:
              status === 'attention'
                ? '计划方案已改变，请调整子任务后继续。'
                : status === 'paused'
                  ? '旧执行已停止，请确认后继续。'
                  : '',
            report,
          },
          'update',
          '更新任务，既有执行保留原始版本',
          now,
        ),
      })
      return { writes, taskId: task.id }
    }
    if (command.op === 'action') {
      if (terminal(task)) throw new TaskError('已结束任务不能执行此操作。')
      const externalStop =
        !!task.activeRunId &&
        this.store.get('task-run', task.activeRunId)?.executor !== 'dsh' &&
        ['pause', 'cancel'].includes(command.action)
      if (command.action === 'pause' || command.action === 'cancel') await this.stop(task, '用户' + command.action)
      const fresh = this.task(task.id)
      let status: Task['status'] = fresh.status
      if (command.action === 'pause') status = 'paused'
      if (command.action === 'cancel') status = 'cancelled'
      if (command.action === 'start' || command.action === 'resume') {
        if (terminal(fresh)) throw new TaskError('已结束任务不能启动')
        status =
          fresh.assignee === 'human'
            ? 'running'
            : fresh.report
              ? 'review'
              : fresh.kind === 'plan'
                ? 'running'
                : readyStatus(fresh)
      }
      if (command.action === 'complete') {
        if (fresh.assignee === 'agent' && (!fresh.report || fresh.activeRunId))
          throw new TaskError('需要先提交产物并停止执行')
        status = 'done'
      }
      if (command.action === 'rework') {
        if (!fresh.report || fresh.activeRunId) throw new TaskError('当前不能返工')
        status = 'queued'
      }
      if (fresh.kind === 'plan' && ['pause', 'cancel', 'resume', 'complete'].includes(command.action)) {
        for (const child of this.store.list('task').filter(t => t.parentId === fresh.id && !terminal(t))) {
          if (command.action === 'pause' || command.action === 'cancel')
            await this.stop(child, '所属计划' + command.action)
          const current = this.task(child.id)
          const childStatus: Task['status'] =
            command.action === 'pause'
              ? 'paused'
              : command.action === 'cancel'
                ? 'cancelled'
                : command.action === 'complete'
                  ? 'done'
                  : current.report
                    ? 'review'
                    : readyStatus(current)
          writes.push({
            type: 'task',
            value: this.change(
              current,
              { status: childStatus, activeRunId: null },
              command.action,
              '随所属计划更新',
              now,
            ),
          })
        }
      }
      if (externalStop) status = 'attention'
      writes.push({
        type: 'task',
        value: this.change(
          fresh,
          {
            status,
            activeRunId: null,
            reason: externalStop ? '领取已撤销，外部执行是否停止仍需核实。' : command.detail,
          },
          command.action,
          command.detail,
          now,
        ),
      })
      return { writes, taskId: task.id, ...(externalStop ? { message: '领取已撤销，外部执行是否停止仍需核实。' } : {}) }
    }
    throw new TaskError('不支持的操作')
  }
  private async advance(now: number) {
    if (this.closed || !this.isOwner()) {
      for (const job of this.jobs.values()) job.controller.abort()
      return
    }
    try {
      if (!(await this.ownerAuthority())) throw new TaskError('同步库的执行主机归属不匹配。')
      this.executionIssue = ''
    } catch {
      this.executionIssue = '尚未确认唯一执行主机归属，已暂停后台作业，请检查同步连接。'
      for (const job of this.jobs.values()) job.controller.abort()
      return
    }
    {
      for (const run of this.store
        .list('task-run')
        .filter(r => r.executor === 'dsh' && ['claimed', 'running'].includes(r.status) && !this.jobs.has(r.id))) {
        const result = await this.execution.recover(run)
        if (result && (result.report || result.review)) await this.finish(run, result)
        else this.interrupted(run, '后台中断，无法确认执行结果，请核实后继续。', now)
      }
    }
    for (const request of this.store
      .list('task-request')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) {
      if (this.store.get('task-receipt', request.id)) continue
      let receipt: TaskReceipt = {
        id: request.id,
        status: 'applied',
        message: '已生效',
        taskId: null,
        runId: null,
        token: null,
        at: iso(now),
      }
      let writes: Write[] = []
      try {
        const result = await this.command(request.command, now)
        writes = result.writes
        receipt = {
          ...receipt,
          taskId: result.taskId ?? null,
          runId: result.runId ?? null,
          token: result.token ?? null,
          message: result.message ?? receipt.message,
        }
      } catch (error) {
        receipt = {
          ...receipt,
          status: 'conflict',
          message: error instanceof TaskError ? error.message : '操作未完成，请检查任务状态后重试。',
        }
      }
      this.store.write([...writes, { type: 'task-receipt', value: receipt }])
    }
    for (const task of this.store.list('task')) {
      if (terminal(task) || task.status === 'paused') continue
      if (task.timing.repeat !== 'none') {
        const at = latestOccurrence(task, now)
        if (at && (!task.seriesChangedAt || at >= task.seriesChangedAt)) {
          const id = createHash('sha256')
            .update(task.id + at)
            .digest('hex')
          if (!this.store.get('task', id)) {
            const instance = newTask(
              id,
              { ...task, timing: occurrenceTiming(task.timing, at), kind: 'task' },
              now,
              task.order,
            )
            instance.seriesId = task.id
            instance.occurrenceAt = at
            this.store.write([{ type: 'task', value: instance }])
          }
        }
        continue
      }
      if (task.timing.remindAt && Date.parse(task.timing.remindAt) <= now && task.notifiedAt !== task.timing.remindAt)
        this.store.write([
          {
            type: 'task',
            value: this.change(task, { notifiedAt: task.timing.remindAt }, 'reminder', '提醒时间已到', now),
          },
          this.notification(task, '任务提醒', now),
        ])
      const current = this.task(task.id)
      if (
        current.assignee === 'agent' &&
        current.status === 'queued' &&
        current.timing.dueAt &&
        Date.parse(current.timing.dueAt) < now
      )
        this.store.write([
          {
            type: 'task',
            value: this.change(
              current,
              { status: 'attention', reason: '截止时间已过，请决定是否继续执行。' },
              'overdue',
              '截止时间已过',
              now,
            ),
          },
          this.notification(current, '任务已过截止时间', now),
        ])
    }
    for (const run of this.store.list('task-run'))
      if (
        run.executor !== 'dsh' &&
        ['claimed', 'running'].includes(run.status) &&
        now - Date.parse(run.updatedAt) > 600_000
      )
        this.interrupted(run, '外部执行者失联，请核实结果后继续。', now)
    this.aggregate(now)
    const tasks = this.store
      .list('task')
      .filter(
        t =>
          (t.status === 'queued' || (t.status === 'review' && t.aiReview && !t.parentId)) &&
          !t.activeRunId &&
          t.executor === 'dsh' &&
          t.timing.repeat === 'none',
      )
      .sort((a, b) => Number(!!b.timing.startAt) - Number(!!a.timing.startAt) || a.order - b.order)
    for (const task of tasks) {
      if (this.jobs.size >= this.settings().concurrency) break
      const phase = task.status === 'review' ? 'review' : 'execution',
        route = this.settings().routes[phase === 'review' ? task.reviewRoute : task.route]
      const cwd = task.workspace ? this.settings().workspaces[task.workspace] : process.cwd()
      if (!route || !cwd) {
        if (task.reason !== '请配置模型角色和工作目录')
          this.store.write([
            {
              type: 'task',
              value: this.change(task, { reason: '请配置模型角色和工作目录' }, 'configuration', '等待执行配置', now),
            },
          ])
        continue
      }
      try {
        const claimed = await this.command(
          { op: 'claim', taskId: task.id, revision: task.revision, executor: 'dsh', phase },
          now,
        )
        this.store.write(claimed.writes)
        const run = this.store.get('task-run', claimed.runId!)!
        const controller = new AbortController()
        const context = JSON.stringify({
          task: run.snapshot,
          dependencies: task.dependencies.map(id => this.task(id).report),
          children: this.store
            .list('task')
            .filter(t => t.parentId === task.id)
            .map(t => ({ title: t.title, report: t.report })),
          previousReviews: this.store.list('task-review').filter(r => r.taskId === task.id),
        })
        const promise = this.execution
          .run({ run, route, cwd: resolve(cwd), context }, controller.signal)
          .then(result => (controller.signal.aborted ? undefined : this.finish(run, result)))
          .catch(() => {
            if (!controller.signal.aborted) this.interrupted(run, '执行未完成，请查看记录后重试。', this.clock())
          })
          .finally(() => {
            this.jobs.delete(run.id)
          })
        this.jobs.set(run.id, { controller, promise })
      } catch (error) {
        if (!(error instanceof TaskError)) throw error
        const current = this.task(task.id)
        if (current.reason !== error.message)
          this.store.write([
            { type: 'task', value: this.change(current, { reason: error.message }, 'blocked', error.message, now) },
          ])
      }
    }
  }
  private interrupted(run: TaskRun, message: string, now: number) {
    const task = this.task(run.taskId)
    if (task.activeRunId !== run.id) return
    this.store.write([
      { type: 'task-run', value: { ...run, status: 'interrupted', error: message, updatedAt: iso(now) } },
      {
        type: 'task',
        value: this.change(
          task,
          { status: 'attention', reason: message, activeRunId: null },
          'interrupted',
          message,
          now,
        ),
      },
      this.notification(task, '任务需要介入', now),
    ])
  }
  private async finish(run: TaskRun, result: ExecutionResult) {
    if (this.closed || !this.isOwner()) return
    if (result.error || (!result.report && !result.review))
      return this.interrupted(run, result.error ?? '没有提交可验证的结果', this.clock())
    const cmd: TaskCommand = result.report
      ? { op: 'report', runId: run.id, token: run.token, report: result.report }
      : { op: 'review', runId: run.id, token: run.token, result: result.review! }
    try {
      const changes = await this.command(cmd, this.clock())
      this.store.write(changes.writes)
    } catch {
      this.interrupted(run, '回报未被接受，请核实任务与产物版本。', this.clock())
    }
  }
  private aggregate(now: number) {
    for (const plan of this.store
      .list('task')
      .filter(t => t.kind === 'plan' && t.status === 'running' && !t.activeRunId)) {
      const children = this.store.list('task').filter(t => t.parentId === plan.id)
      if (
        !children.length ||
        !children.every(t => t.status === 'done' || (t.status === 'review' && !!t.report?.checks.every(c => c.passed)))
      )
        continue
      const report: TaskReport = {
        summary: children.map(t => `${t.title}：${t.report?.summary ?? '已完成'}`).join('\n'),
        artifacts: children.flatMap(t => t.report?.artifacts ?? []),
        checks: children.flatMap(t => t.report?.checks ?? []),
      }
      if (!report.artifacts.length) continue
      this.store.write([
        {
          type: 'task',
          value: this.change(
            plan,
            { report, artifactRevision: plan.artifactRevision + 1, status: 'review' },
            'aggregate',
            '计划产物已汇总',
            now,
          ),
        },
        ...(!plan.aiReview ? [this.notification(plan, '计划待验收', now)] : []),
      ])
    }
  }
  async dispose() {
    this.closed = true
    for (const job of this.jobs.values()) job.controller.abort()
    await Promise.allSettled([...this.jobs.values()].map(j => j.promise))
    await this.work
  }
}
