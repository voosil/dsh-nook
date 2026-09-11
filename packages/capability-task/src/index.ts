import { z } from 'zod'

export const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
const text = z.string().max(500_000)
const date = z.iso.datetime()
export const routeSchema = z.strictObject({ provider: z.string().min(1), model: z.string().min(1) })
export type ModelRoute = z.infer<typeof routeSchema>
export const sourceSchema = z.strictObject({
  kind: z.enum(['note', 'retrospective']).optional(),
  noteId: id,
  version: z.string(),
  excerpt: text,
})
export const timingSchema = z
  .strictObject({
    timeZone: z.string().refine(value => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value })
        return true
      } catch {
        return false
      }
    }, '时区无效'),
    remindAt: date.nullable(),
    startAt: date.nullable(),
    dueAt: date.nullable(),
    endAt: date.nullable(),
    vague: z.string().max(300),
    repeat: z.enum(['none', 'daily', 'weekly']),
    weekdays: z.array(z.int().min(0).max(6)).max(7),
  })
  .refine(t => t.repeat === 'none' || Boolean(t.startAt || t.remindAt), '重复安排需要开始或提醒时间')
  .refine(t => t.repeat !== 'weekly' || t.weekdays.length > 0, '每周安排需要选择星期')
  .refine(t => !t.endAt || (!!t.startAt && t.endAt > t.startAt), '结束时间应晚于开始时间')
export const emptyTiming = (timeZone = 'UTC'): Timing => ({
  timeZone,
  remindAt: null,
  startAt: null,
  dueAt: null,
  endAt: null,
  vague: '',
  repeat: 'none',
  weekdays: [],
})
export type Timing = z.infer<typeof timingSchema>
export const taskInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(300),
  description: text.default(''),
  kind: z.enum(['task', 'plan']).default('task'),
  assignee: z.enum(['human', 'agent', 'unassigned']).default('human'),
  executor: z.enum(['dsh', 'external']).default('dsh'),
  projectId: id.nullable().default(null),
  parentId: id.nullable().default(null),
  dependencies: z.array(id).max(100).default([]),
  scope: text.default(''),
  constraints: text.default(''),
  acceptance: text.default(''),
  sources: z.array(sourceSchema).max(500).default([]),
  timing: timingSchema.default(() => emptyTiming()),
  workspace: z.string().max(200).default(''),
  writes: z.boolean().default(true),
  aiReview: z.boolean().default(false),
  route: z.string().max(100).default('execution'),
  reviewRoute: z.string().max(100).default('review'),
})
export type TaskInput = z.infer<typeof taskInputSchema>
export const statusSchema = z.enum([
  'todo',
  'unscheduled',
  'queued',
  'running',
  'review',
  'done',
  'paused',
  'attention',
  'cancelled',
])
export const artifactSchema = z.strictObject({
  name: z.string().min(1).max(300),
  uri: z.string().min(1).max(4000),
  version: z.string().min(1).max(300),
})
export const reportSchema = z.strictObject({
  summary: text,
  artifacts: z.array(artifactSchema).min(1).max(100),
  checks: z
    .array(z.strictObject({ name: z.string(), passed: z.boolean(), evidence: text }))
    .min(1)
    .max(100),
})
export type TaskReport = z.infer<typeof reportSchema>
export const taskSchema = taskInputSchema.extend({
  id,
  revision: z.int().positive(),
  status: statusSchema,
  order: z.number(),
  createdAt: date,
  updatedAt: date,
  reason: text,
  activeRunId: id.nullable(),
  report: reportSchema.nullable(),
  artifactRevision: z.int().nonnegative(),
  reworks: z.int().nonnegative(),
  seriesId: id.nullable(),
  seriesChangedAt: date.nullable().default(null),
  occurrenceAt: date.nullable(),
  notifiedAt: date.nullable(),
  history: z.array(z.strictObject({ at: date, action: z.string(), detail: text })),
})
export type Task = z.infer<typeof taskSchema>
export const runSchema = z.strictObject({
  id,
  taskId: id,
  taskRevision: z.int().positive(),
  phase: z.enum(['execution', 'review']),
  status: z.enum(['claimed', 'running', 'submitted', 'finished', 'interrupted']),
  executor: z.string(),
  token: z.string(),
  startedAt: date,
  updatedAt: date,
  sessionId: z.string().nullable(),
  snapshot: taskSchema,
  report: reportSchema.nullable(),
  error: text,
  artifactRevision: z.int().nonnegative(),
})
export type TaskRun = z.infer<typeof runSchema>
export const reviewSchema = z.strictObject({
  verdict: z.enum(['pass', 'fail', 'unverified']),
  summary: text,
  checks: z
    .array(z.strictObject({ criterion: z.string(), verdict: z.enum(['pass', 'fail', 'unverified']), evidence: text }))
    .min(1)
    .max(100),
  scopeChange: z.boolean(),
})
export type ReviewResult = z.infer<typeof reviewSchema>
export const reviewRecordSchema = reviewSchema.extend({
  id,
  taskId: id,
  runId: id,
  artifactRevision: z.int().nonnegative(),
  createdAt: date,
})
export const settingsSchema = z.strictObject({
  id: z.literal('settings'),
  revision: z.int().nonnegative(),
  ownerId: id.nullable(),
  concurrency: z.int().min(1).max(16),
  routes: z.record(z.string(), routeSchema),
  workspaces: z.record(z.string(), z.string()),
  watchNotes: z.array(id),
  watchProjects: z.array(id),
  keepAlive: z.boolean(),
})
export type TaskSettings = z.infer<typeof settingsSchema>
export const defaultSettings = (): TaskSettings => ({
  id: 'settings',
  revision: 0,
  ownerId: null,
  concurrency: 3,
  routes: {},
  workspaces: {},
  watchNotes: [],
  watchProjects: [],
  keepAlive: false,
})
export const proposalStepSchema = z.strictObject({ key: id, task: taskInputSchema, after: z.array(id).max(100) })
export const proposalSchema = z.strictObject({
  id,
  revision: z.int().positive(),
  topic: z.string().min(1).max(300),
  summary: text,
  scope: text,
  consequences: text,
  decision: text,
  status: z.enum(['draft', 'ready', 'deferred', 'approved']),
  sources: z.array(sourceSchema),
  steps: z.array(proposalStepSchema).min(1).max(30),
  feedback: text,
  planId: id.nullable(),
  updatedAt: date,
})
export type Proposal = z.infer<typeof proposalSchema>
export const understandingSchema = z.strictObject({
  id,
  noteId: id,
  version: z.string(),
  semantic: text,
  title: z.string(),
  content: text,
  summary: text,
  claims: z.array(
    z.strictObject({
      text,
      origin: z.enum(['user', 'inference']),
      relation: z.enum(['observation', 'idea', 'supplement', 'conflict', 'replacement']),
      related: z.array(id),
    }),
  ),
  feedbackVersion: z.string().default(''),
  pendingVersion: z.string(),
  pendingSince: date.nullable(),
  changedAt: date.nullable(),
  error: text,
})
export type Understanding = z.infer<typeof understandingSchema>
export const notificationSchema = z.strictObject({
  id,
  targetId: id,
  title: z.string(),
  body: text,
  createdAt: date,
  read: z.boolean(),
})
export type TaskNotification = z.infer<typeof notificationSchema>
export const commandSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('create'), taskId: id, input: taskInputSchema }),
  z.strictObject({ op: z.literal('update'), taskId: id, revision: z.int().positive(), input: taskInputSchema }),
  z.strictObject({
    op: z.literal('action'),
    taskId: id,
    revision: z.int().positive(),
    action: z.enum(['start', 'pause', 'resume', 'cancel', 'complete', 'rework']),
    detail: text.default(''),
  }),
  z.strictObject({ op: z.literal('reorder'), ids: z.array(id).max(1000) }),
  z.strictObject({
    op: z.literal('claim'),
    taskId: id,
    revision: z.int().positive(),
    executor: z.string().min(1),
    phase: z.enum(['execution', 'review']).default('execution'),
  }),
  z.strictObject({ op: z.literal('heartbeat'), runId: id, token: z.string() }),
  z.strictObject({ op: z.literal('report'), runId: id, token: z.string(), report: reportSchema }),
  z.strictObject({ op: z.literal('review'), runId: id, token: z.string(), result: reviewSchema }),
  z.strictObject({
    op: z.literal('proposal'),
    proposalId: id,
    revision: z.int().positive(),
    action: z.enum(['approve', 'defer', 'feedback']),
    text: text.default(''),
  }),
  z.strictObject({ op: z.literal('configure'), settings: settingsSchema }),
  z.strictObject({ op: z.literal('read'), notificationId: id }),
])
export type TaskCommand = z.infer<typeof commandSchema>
export const requestSchema = z.strictObject({ id, deviceId: id, createdAt: date, command: commandSchema })
export type TaskRequest = z.infer<typeof requestSchema>
export const receiptSchema = z.strictObject({
  id,
  status: z.enum(['pending', 'applied', 'conflict']),
  message: z.string(),
  taskId: id.nullable(),
  runId: id.nullable(),
  token: z.string().nullable(),
  at: date,
})
export type TaskReceipt = z.infer<typeof receiptSchema>
export const retrospectiveSchema = z.strictObject({
  id,
  taskId: id,
  version: z.string(),
  title: z.string(),
  markdown: text,
  projectId: id.nullable(),
  createdAt: date,
  sources: z.array(sourceSchema),
})
export const recordSchemas = {
  'task-retrospective': retrospectiveSchema,
  task: taskSchema,
  'task-run': runSchema,
  'task-review': reviewRecordSchema,
  'task-settings': settingsSchema,
  'task-proposal': proposalSchema,
  'task-understanding': understandingSchema,
  'task-notification': notificationSchema,
  'task-request': requestSchema,
  'task-receipt': receiptSchema,
} as const
export type RecordType = keyof typeof recordSchemas
export type RecordValue<K extends RecordType> = z.infer<(typeof recordSchemas)[K]>
export interface TaskStore {
  readonly deviceId: string
  list<K extends RecordType>(type: K): RecordValue<K>[]
  get<K extends RecordType>(type: K, id: string): RecordValue<K> | undefined
  write(items: readonly { type: RecordType; value: RecordValue<RecordType> }[]): void
  conflicts(): boolean
  subscribe(listener: () => void): () => void
}
export const snapshotSchema = z.strictObject({
  executionIssue: z.string().default(''),
  deviceId: id,
  isOwner: z.boolean(),
  conflict: z.boolean(),
  settings: settingsSchema,
  tasks: z.array(taskSchema),
  runs: z.array(runSchema),
  reviews: z.array(reviewRecordSchema),
  proposals: z.array(proposalSchema),
  notifications: z.array(notificationSchema),
  receipts: z.array(receiptSchema),
  requests: z.array(requestSchema),
  understandings: z.array(understandingSchema),
  retrospectives: z.array(retrospectiveSchema).default([]),
})
export type TaskSnapshot = z.infer<typeof snapshotSchema>
export interface TaskService {
  snapshot(): TaskSnapshot
  submit(request: TaskRequest): Promise<TaskReceipt>
  configure(settings: TaskSettings): Promise<TaskReceipt>
  tick(now?: number): Promise<void>
}
export class TaskError extends Error {
  readonly code = 'TASK_ERROR'
}
