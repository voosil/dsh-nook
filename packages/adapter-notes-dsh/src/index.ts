import { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-typert-registry'
import type {} from '@nook-dsh/feature-notes'
import type {} from '@nook-dsh/feature-reflection'
import type {} from '@nook-dsh/feature-video'
import { descriptors, RPC_PACKAGE, type Request, type Result } from './rpc.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    nookNotebookRpc: NotebookRpc
  }
}

function defined<T extends object>(value: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>
  }
}

async function result<T>(signal: AbortSignal, action: () => Promise<T>): Promise<Result<T>> {
  try {
    signal.throwIfAborted()
    return { ok: true, value: await action() }
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'OPERATION_FAILED'
    const known = [
      'VIDEO_ERROR',
      'REFLECTION_ERROR',
      'INVALID_NOTE',
      'NOT_FOUND',
      'CONFLICT',
      'INVALID_PROJECT',
      'PROJECT_NOT_FOUND',
    ].includes(code)
    return {
      ok: false,
      error: {
        code,
        message: known && error instanceof Error ? error.message : '操作未完成，请重试。当前输入会保留。',
      },
    }
  }
}

export default class NotebookRpc extends TypertRemoteService {
  static inject = [
    'typert',
    'nookNotebook',
    'nookReflection',
    'nookGeneration',
    'nookKnowledge',
    'nookProjects',
    'nookVideo',
  ]
  constructor(ctx: Context) {
    super(ctx, 'nookNotebookRpc')
    ctx.effect(() =>
      ctx.typert.register({
        package: RPC_PACKAGE,
        face: 'host',
        schemas: [],
        model: { services: [], events: [], objects: [] },
        invocations: descriptors,
      }),
    )
  }
  list(request: Request<'list'>, signal: AbortSignal) {
    return result(signal, () => this.ctx.nookNotebook.list(defined(request)))
  }
  get(request: Request<'get'>, signal: AbortSignal) {
    return result(signal, () => this.ctx.nookNotebook.get(request.id))
  }
  create(request: Request<'create'>, signal: AbortSignal) {
    return result(signal, () => this.ctx.nookNotebook.create(request))
  }
  save(request: Request<'save'>, signal: AbortSignal) {
    return result(signal, () => this.ctx.nookNotebook.save(request))
  }
  trash(request: Request<'trash'>, signal: AbortSignal) {
    return result(signal, () => this.ctx.nookNotebook.setDeleted(request.id, request.revision, request.deleted))
  }
  projects(_request: Request<'projects'>, signal: AbortSignal) {
    return result(signal, () => this.ctx.nookNotebook.projects())
  }
  createProject(request: Request<'createProject'>, signal: AbortSignal) {
    return result(signal, () => this.ctx.nookNotebook.createProject(defined(request)))
  }
  updateProject(request: Request<'updateProject'>, signal: AbortSignal) {
    return result(signal, () =>
      this.ctx.nookNotebook.updateProject(request.id, { name: request.name, description: request.description }),
    )
  }
  deleteProject(request: Request<'deleteProject'>, signal: AbortSignal) {
    return result(signal, () => this.ctx.nookNotebook.deleteProject(request.id))
  }
  search(request: Request<'search'>, signal: AbortSignal) {
    return result(signal, () => this.ctx.nookNotebook.search(defined(request)))
  }
  models(_request: Request<'models'>, signal: AbortSignal) {
    return result(signal, () => this.ctx.nookGeneration.models())
  }
  videoSkills(_request: Request<'videoSkills'>, signal: AbortSignal) {
    return result(signal, () => this.ctx.nookVideo.skills())
  }
  startVideo(request: Request<'startVideo'>, signal: AbortSignal) {
    return result(signal, () => this.ctx.nookVideo.start(request))
  }
  videoJob(request: Request<'videoJob'>, signal: AbortSignal) {
    return result(signal, () => this.ctx.nookVideo.get(request.id))
  }
  cancelVideo(request: Request<'cancelVideo'>, signal: AbortSignal) {
    return result(signal, () => this.ctx.nookVideo.cancel(request.id))
  }
  summarize(request: Request<'summarize'>, signal: AbortSignal) {
    return result(signal, () => this.ctx.nookReflection.summarize(request, signal))
  }
}
