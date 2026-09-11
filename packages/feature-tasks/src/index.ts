import type { SyncService } from '@nook-dsh/capability-sync'
import type { NoteService } from '@nook-dsh/capability-note'
import { Context, Service } from '@deepseek-ai/cordis'
import type { TaskStore, TaskService } from '@nook-dsh/capability-task'
import type { ExecutionService } from '@nook-dsh/capability-execution'
import { TaskEngine } from './engine.js'
declare module '@deepseek-ai/cordis' {
  interface Context {
    nookSync: SyncService
    nookNotes: NoteService
    nookTaskStore: TaskStore
    nookTasks: TaskService
    nookExecution: ExecutionService
  }
}
export default class Tasks extends Service {
  static inject = ['nookTaskStore', 'nookExecution', 'nookNotes', 'nookSync']
  constructor(ctx: Context) {
    super(ctx, 'nookTasks')
    const engine = new TaskEngine(
      ctx.nookTaskStore,
      ctx.nookExecution,
      Date.now,
      async sources => {
        for (const source of sources) {
          if (source.kind === 'retrospective') {
            if (ctx.nookTaskStore.get('task-retrospective', source.noteId)?.version !== source.version) return false
            continue
          }
          const note = await ctx.nookNotes.get(source.noteId)
          if (!note || note.deletedAt || (note.versionId ?? String(note.revision)) !== source.version) return false
        }
        return true
      },
      () => ctx.nookSync.claimTaskOwner(ctx.nookTaskStore.deviceId, AbortSignal.timeout(10000)),
    )
    this.snapshot = () => engine.snapshot()
    this.submit = request => engine.submit(request)
    this.configure = settings => engine.configure(settings)
    this.tick = now => engine.tick(now)
    ctx.effect(() => {
      const timer = setInterval(() => {
        void engine.tick().catch(() => {})
      }, 1000)
      return async () => {
        clearInterval(timer)
        await engine.dispose()
      }
    })
  }
  snapshot: TaskService['snapshot']
  submit: TaskService['submit']
  configure: TaskService['configure']
  tick: TaskService['tick']
}
