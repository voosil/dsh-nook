import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { SyncReplica, Json } from '@nook-dsh/capability-sync'
import { recordSchemas, type RecordType, type RecordValue, type TaskStore, TaskError } from '@nook-dsh/capability-task'

declare module '@deepseek-ai/cordis' {
  interface Context {
    nookSyncReplica: SyncReplica
    nookTaskStore: TaskStore
  }
}
export default class TaskProvider extends Service implements TaskStore {
  static inject = ['nookSyncReplica']
  readonly deviceId: string
  constructor(ctx: Context, config: { identity: string }) {
    super(ctx, 'nookTaskStore')
    mkdirSync(dirname(config.identity), { recursive: true })
    try {
      this.deviceId = readFileSync(config.identity, 'utf8').trim()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.deviceId = randomUUID()
      writeFileSync(config.identity, this.deviceId, { flag: 'wx', mode: 0o600 })
    }
    if (!/^[a-f0-9-]{36}$/.test(this.deviceId)) throw new TaskError('执行设备标识损坏，已停止任务处理。')
    for (const type of Object.keys(recordSchemas) as RecordType[])
      ctx.effect(() =>
        ctx.nookSyncReplica.registerType({
          type,
          schema: 1,
          validate: value => {
            const parsed = recordSchemas[type].parse(value.data)
            if (parsed.id !== value.id) throw new TaskError('任务记录标识不一致')
          },
        }),
      )
  }
  list<K extends RecordType>(type: K): RecordValue<K>[] {
    return this.ctx.nookSyncReplica
      .records(type)
      .filter(v => !v.value.deleted)
      .map(v => recordSchemas[type].parse(v.value.data) as RecordValue<K>)
  }
  get<K extends RecordType>(type: K, id: string): RecordValue<K> | undefined {
    return this.list(type).find(v => v.id === id)
  }
  write(items: readonly { type: RecordType; value: RecordValue<RecordType> }[]) {
    if (this.conflicts()) throw new TaskError('任务同步存在冲突，已停止执行，请先解决同步冲突。')
    this.ctx.nookSyncReplica.writeRecords(
      items.map(item => {
        const value = recordSchemas[item.type].parse(item.value)
        const old = this.ctx.nookSyncReplica.records(item.type).find(v => v.value.id === value.id)
        return {
          type: item.type,
          id: value.id,
          schema: 1,
          expected: old?.hash ?? null,
          data: value as unknown as Json,
          deleted: false,
          blobs: [],
        }
      }),
    )
  }
  conflicts() {
    return this.ctx.nookSyncReplica.conflicts().some(c => c.type in recordSchemas)
  }
  subscribe(listener: () => void) {
    return this.ctx.nookSyncReplica.subscribe(listener)
  }
}
