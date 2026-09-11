import { Context, Service } from '@deepseek-ai/cordis'
import type { TaskStore } from '@nook-dsh/capability-task'
import type { RefinementService } from '@nook-dsh/capability-refinement'
import type { NoteService } from '@nook-dsh/capability-note'
import type { KnowledgeService } from '@nook-dsh/capability-knowledge'
import type { GenerationService } from '@nook-dsh/capability-generation'
import type { SyncService } from '@nook-dsh/capability-sync'
import { Refiner } from './refiner.js'
declare module '@deepseek-ai/cordis' {
  interface Context {
    nookSync: SyncService
    nookTaskStore: TaskStore
    nookRefinement: RefinementService
    nookNotes: NoteService
    nookKnowledge: KnowledgeService
    nookGeneration: GenerationService
  }
}
export default class Refinement extends Service {
  static inject = ['nookTaskStore', 'nookNotes', 'nookKnowledge', 'nookGeneration', 'nookSync']
  tick: RefinementService['tick']
  constructor(ctx: Context) {
    super(ctx, 'nookRefinement')
    const refiner = new Refiner(ctx.nookTaskStore, ctx.nookNotes, ctx.nookKnowledge, ctx.nookGeneration, () =>
      ctx.nookSync.claimTaskOwner(ctx.nookTaskStore.deviceId, AbortSignal.timeout(10000)),
    )
    this.tick = (now, force) => refiner.tick(now, force)
    ctx.effect(() => {
      const timer = setInterval(() => {
        void refiner.tick().catch(() => {})
      }, 15000)
      return async () => {
        clearInterval(timer)
        await refiner.dispose()
      }
    })
  }
}
