/** Browser-safe wire schemas. DSH contracts are isolated in this Adapter. */
import { z } from 'zod'
import type { InvocationDescriptor, RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

const id = z.uuid()
const versionId = z.string().regex(/^[a-f0-9]{64}$/)
const projectId = id.nullable()
const date = z.iso.datetime()
const source = z.strictObject({
  kind: z.enum(['personal', 'transcript', 'comment-note', 'ai-article', 'ai-summary']),
  url: z.url().nullable(),
  author: z.string().max(300).nullable(),
  basedOn: z
    .array(
      z.strictObject({
        noteId: id,
        revision: z.int().positive(),
        versionId: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      }),
    )
    .max(500),
})
const input = z.strictObject({
  title: z.string().max(300),
  markdown: z.string().max(500_000),
  projectId,
  pinned: z.boolean(),
})
const note = input.extend({
  versionId: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  id,
  createdAt: date,
  updatedAt: date,
  deletedAt: date.nullable(),
  revision: z.int().positive(),
  source,
})
const project = z.strictObject({
  sortOrder: z.int().nonnegative().optional(),
  id,
  name: z.string(),
  description: z.string(),
  createdAt: date,
  updatedAt: date,
})
const hit = z.strictObject({
  documentId: id,
  title: z.string(),
  text: z.string(),
  projectId,
  revision: z.int().positive(),
  sourceKind: z.string(),
  sourceUrl: z.string().nullable(),
  start: z.int().nonnegative(),
  end: z.int().nonnegative(),
  score: z.number(),
})

export const requests = {
  videoSkills: z.strictObject({}),
  startVideo: z.strictObject({
    id,
    url: z.string().min(1).max(2000),
    projectId,
    strategy: z.enum(['none', 'local', 'llm']),
    write: z.boolean(),
    skill: z.string().max(200),
    provider: z.string().max(200),
    model: z.string().max(200),
  }),
  videoJob: z.strictObject({ id }),
  cancelVideo: z.strictObject({ id }),
  models: z.strictObject({}),
  summarize: z.strictObject({
    from: date,
    to: date,
    projectId,
    provider: z.string().min(1).max(200),
    model: z.string().min(1).max(200),
    title: z.string().max(300),
  }),
  list: z.strictObject({
    search: z.string().max(500).optional(),
    projectId: projectId.optional(),
    sort: z.enum(['updated', 'created', 'title']).optional(),
    trash: z.boolean().optional(),
    offset: z.int().nonnegative().optional(),
    limit: z.int().min(1).max(500).optional(),
    from: date.optional(),
    to: date.optional(),
  }),
  get: z.strictObject({ id }),
  create: input.extend({ id, source }),
  save: input.extend({
    id,
    requestId: id.optional(),
    revision: z.int().positive(),
    versionId: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  }),
  history: z.strictObject({ id, cursor: versionId.optional(), limit: z.int().min(1).max(100).optional() }),
  getHistoryVersion: z.strictObject({ id, versionId }),
  restoreHistoryVersion: z.strictObject({ id, versionId, requestId: id, copy: z.boolean() }),
  trash: z.strictObject({ id, revision: z.int().positive(), deleted: z.boolean() }),
  projects: z.strictObject({}),
  createProject: z.strictObject({
    name: z.string().trim().min(1).max(120),
    description: z.string().max(2000).optional(),
  }),
  updateProject: z.strictObject({ id, name: z.string().trim().min(1).max(120), description: z.string().max(2000) }),
  deleteProject: z.strictObject({ id }),
  reorderProjects: z.strictObject({ ids: z.array(id) }),
  search: z.strictObject({
    query: z.string().max(500),
    projectId: projectId.optional(),
    limit: z.int().min(1).max(20).optional(),
  }),
}
const videoJob = z.strictObject({
  id,
  status: z.enum(['running', 'done', 'failed', 'cancelled']),
  stage: z.string(),
  noteIds: z.array(id),
  warnings: z.array(z.string()),
  error: z.string().nullable(),
  updatedAt: date,
})
const outputs = {
  videoSkills: z.array(z.strictObject({ id: z.string(), name: z.string() })),
  startVideo: videoJob,
  videoJob: videoJob.nullable(),
  cancelVideo: z.boolean(),
  models: z.array(z.strictObject({ provider: z.string(), id: z.string(), name: z.string() })),
  summarize: z.strictObject({
    title: z.string(),
    markdown: z.string(),
    basedOn: z.array(
      z.strictObject({
        noteId: id,
        revision: z.int().positive(),
        versionId: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      }),
    ),
  }),
  list: z.strictObject({ notes: z.array(note), total: z.int().nonnegative() }),
  get: note.nullable(),
  create: note,
  save: z.strictObject({ note, submittedVersionId: versionId.nullable() }),
  history: z.strictObject({
    entries: z.array(
      z.strictObject({ versionId, title: z.string(), updatedAt: date, deleted: z.boolean(), merged: z.boolean() }),
    ),
    cursor: versionId.nullable(),
  }),
  getHistoryVersion: note,
  restoreHistoryVersion: note,
  trash: note,
  projects: z.array(project),
  createProject: project,
  updateProject: project,
  deleteProject: z.boolean(),
  reorderProjects: z.array(project),
  search: z.array(hit),
}
export type Method = keyof typeof requests
export type Request<K extends Method> = z.input<(typeof requests)[K]>
export type Value<K extends Method> = z.output<(typeof outputs)[K]>
export type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
export type NotebookRemote = {
  [K in Method]: (request: Request<K>, signal?: AbortSignal) => Promise<RemoteResult<Result<Value<K>>>>
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    nookNotebookRpc: NotebookRemote
  }
}

export const RPC_PACKAGE = '@nook-dsh/adapter-notes-dsh'
export const descriptors: readonly InvocationDescriptor[] = (Object.keys(requests) as Method[]).map(method => ({
  id: `${RPC_PACKAGE}#${method}`,
  service: 'nookNotebookRpc',
  namespace: 'nookNotebookRpc',
  method,
  invocation: { kind: 'direct' },
  parameters: [
    {
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: { mode: 'strict', typeSymbol: `${RPC_PACKAGE}#${method}Request`, schema: requests[method] },
    },
  ],
  cancellation: { parameter: 'signal' },
  result: {
    mode: 'strict',
    typeSymbol: `${RPC_PACKAGE}#${method}Result`,
    schema: z.discriminatedUnion('ok', [
      z.strictObject({ ok: z.literal(true), value: outputs[method] }),
      z.strictObject({ ok: z.literal(false), error: z.strictObject({ code: z.string(), message: z.string() }) }),
    ]),
  },
}))
