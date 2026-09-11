import { randomUUID } from 'node:crypto'
import {
  recordSchemas,
  type TaskStore,
  type RecordType,
  type RecordValue,
} from '../../packages/capability-task/src/index.ts'
export class MemoryTaskStore implements TaskStore {
  readonly deviceId = randomUUID()
  values = new Map<string, unknown>()
  hasConflict = false
  list<K extends RecordType>(type: K): RecordValue<K>[] {
    return [...this.values.entries()]
      .filter(([key]) => key.startsWith(type + '/'))
      .map(([, value]) => structuredClone(value) as RecordValue<K>)
  }
  get<K extends RecordType>(type: K, id: string): RecordValue<K> | undefined {
    return this.list(type).find(v => v.id === id)
  }
  write(items: readonly { type: RecordType; value: RecordValue<RecordType> }[]) {
    const next = new Map(this.values)
    for (const item of items) {
      const value = recordSchemas[item.type].parse(item.value)
      next.set(item.type + '/' + value.id, structuredClone(value))
    }
    this.values = next
  }
  conflicts() {
    return this.hasConflict
  }
  subscribe() {
    return () => {}
  }
}
