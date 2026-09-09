import { createHash, randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import {
  VideoError,
  type VideoSourceService,
  type VideoReviewService,
  type VideoWriterService,
  type VideoRequest,
  type VideoJob,
} from '@nook-dsh/capability-video'
import type { NoteService, NoteSource } from '@nook-dsh/capability-note'
import type { ProjectService } from '@nook-dsh/capability-project'

declare module '@deepseek-ai/cordis' {
  interface Context {
    nookVideoSource: VideoSourceService
    nookVideoReview: VideoReviewService
    nookVideoWriter: VideoWriterService
    nookNotes: NoteService
    nookProjects: ProjectService
    nookVideo: VideoFeature
  }
}

/** Stable source id avoids duplicate originals when a failed writing job is retried. */
function sourceId(url: string, kind: string, projectId: string | null) {
  const hex = createHash('sha256')
    .update(JSON.stringify([url, kind, projectId]))
    .digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

export default class VideoFeature extends Service {
  static inject = ['nookVideoSource', 'nookVideoReview', 'nookVideoWriter', 'nookNotes', 'nookProjects']
  private readonly jobs = new Map<string, VideoJob>()
  private readonly running = new Map<string, AbortController>()
  private readonly tasks = new Set<Promise<void>>()
  constructor(ctx: Context) {
    super(ctx, 'nookVideo')
    ctx.effect(() => async () => {
      for (const controller of this.running.values()) controller.abort()
      await Promise.allSettled(this.tasks)
      this.running.clear()
      this.jobs.clear()
    })
  }
  skills() {
    return this.ctx.nookVideoWriter.skills()
  }
  async start(request: VideoRequest): Promise<VideoJob> {
    const existing = this.jobs.get(request.id)
    if (existing) return existing
    if (this.running.size) throw new VideoError('已有一个视频正在处理，请等待完成或先取消。')
    if (request.projectId && !(await this.ctx.nookProjects.get(request.projectId))) throw new VideoError('项目不存在。')
    if ((request.write || request.strategy === 'llm') && (!request.provider || !request.model))
      throw new VideoError('请先选择用于评估或写作的模型。')
    if (this.running.size) throw new VideoError('已有一个视频正在处理。')
    const controller = new AbortController()
    this.running.set(request.id, controller)
    this.jobs.set(request.id, {
      id: request.id,
      status: 'running',
      stage: '正在获取视频资料',
      noteIds: [],
      warnings: [],
      error: null,
      updatedAt: new Date().toISOString(),
    })
    const task = this.run(request, controller.signal).finally(() => {
      this.running.delete(request.id)
      this.tasks.delete(task)
    })
    this.tasks.add(task)
    return this.jobs.get(request.id)!
  }
  async get(id: string) {
    return this.jobs.get(id) ?? null
  }
  async cancel(id: string) {
    this.running.get(id)?.abort()
    return true
  }
  private update(id: string, patch: Partial<VideoJob>) {
    const current = this.jobs.get(id)
    if (current) this.jobs.set(id, { ...current, ...patch, updatedAt: new Date().toISOString() })
  }
  private async run(request: VideoRequest, signal: AbortSignal) {
    const noteIds: string[] = []
    try {
      const material = await this.ctx.nookVideoSource.collect(request.url, request.strategy !== 'none', signal)
      signal.throwIfAborted()
      this.update(request.id, { warnings: material.warnings, stage: '保存来源资料' })
      const basedOn: { noteId: string; revision: number; versionId?: string }[] = []
      const save = async (kind: NoteSource['kind'], markdown: string, author: string, stable: string | null) => {
        signal.throwIfAborted()
        if (request.projectId && !(await this.ctx.nookProjects.get(request.projectId)))
          throw new VideoError('处理期间项目已被删除，请选择其他项目重试。')
        const note = await this.ctx.nookNotes.create({
          id: stable ? sourceId(material.url, stable, request.projectId) : randomUUID(),
          title: `${material.title}${kind === 'transcript' ? ' · 字幕' : kind === 'comment-note' ? ' · 评论笔记' : ''}`,
          markdown,
          projectId: request.projectId,
          pinned: false,
          source: { kind, url: material.url, author, basedOn: kind === 'ai-article' ? [...basedOn] : [] },
        })
        if (note.deletedAt) throw new VideoError('这份来源资料已在回收站，请先恢复后重试。')
        noteIds.push(note.id)
        basedOn.push({
          noteId: note.id,
          revision: note.revision,
          ...(note.versionId ? { versionId: note.versionId } : {}),
        })
        this.update(request.id, { noteIds: [...noteIds] })
        return note
      }
      const transcriptNote = material.transcript
        ? await save('transcript', material.transcript, material.author, 'transcript')
        : null
      this.update(request.id, { stage: request.strategy === 'llm' ? '正在逐段评估评论笔记' : '选择评论笔记' })
      const selected = await this.ctx.nookVideoReview.select(
        { material, strategy: request.strategy, provider: request.provider, model: request.model },
        signal,
      )
      const commentNote = selected
        ? await save('comment-note', selected.markdown, selected.author, `comment-${selected.id}`)
        : null
      if (!material.transcript && !selected) throw new VideoError('没有可用字幕或通过筛选的笔记。')
      if (request.write) {
        this.update(request.id, { stage: '逐段写作与审校，可取消；成功片段会缓存' })
        const basis = transcriptNote ?? commentNote!
        basedOn.splice(0, basedOn.length, {
          noteId: basis.id,
          revision: basis.revision,
          ...(basis.versionId ? { versionId: basis.versionId } : {}),
        })
        const markdown = await this.ctx.nookVideoWriter.write(
          {
            title: material.title,
            text: basis.markdown,
            skill: request.skill,
            provider: request.provider,
            model: request.model,
          },
          signal,
        )
        const current = await this.ctx.nookNotes.get(basis.id)
        if (!current || current.deletedAt || current.revision !== basis.revision)
          throw new VideoError('写作期间来源笔记被修改，请重试。')
        await save('ai-article', markdown, material.author, null)
      }
      this.update(request.id, { status: 'done', stage: '已保存笔记并加入知识库' })
    } catch (error) {
      this.update(request.id, {
        status: signal.aborted ? 'cancelled' : 'failed',
        stage: signal.aborted ? '已取消，已保存资料保留' : '处理未完成，已保存资料保留',
        error: signal.aborted
          ? null
          : error instanceof VideoError
            ? error.message
            : '处理失败，请检查模型或采集配置后重试。',
      })
    }
  }
}
