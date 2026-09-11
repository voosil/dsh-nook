import { HASH, type RecordVersion, type Json } from '@nook-dsh/capability-sync'
import type { RecordValue, TaskInput } from '@nook-dsh/capability-task'

/** Paths owned by capability-task schema 1, not a recursive rewrite of arbitrary text. */
export function remapTaskReferences(value: RecordVersion, resolve: (hash: string) => string): RecordVersion {
  const data = structuredClone(value.data)
  const map = (value: string) => (HASH.test(value) ? resolve(value) : value)
  const sources = (record: { sources: TaskInput['sources'] }) => {
    for (const source of record.sources) if (source.kind !== 'retrospective') source.version = map(source.version)
  }
  if (value.type === 'task') sources(data as unknown as RecordValue<'task'>)
  else if (value.type === 'task-retrospective') sources(data as unknown as RecordValue<'task-retrospective'>)
  else if (value.type === 'task-run') sources((data as unknown as RecordValue<'task-run'>).snapshot)
  else if (value.type === 'task-proposal') {
    const proposal = data as unknown as RecordValue<'task-proposal'>
    sources(proposal)
    for (const step of proposal.steps) sources(step.task)
  } else if (value.type === 'task-understanding') {
    const understanding = data as unknown as RecordValue<'task-understanding'>
    understanding.version = map(understanding.version)
    const split = understanding.pendingVersion.indexOf(':')
    understanding.pendingVersion =
      split < 0
        ? map(understanding.pendingVersion)
        : map(understanding.pendingVersion.slice(0, split)) + understanding.pendingVersion.slice(split)
  } else if (value.type === 'task-request') {
    const { command } = data as unknown as RecordValue<'task-request'>
    if (command.op === 'create' || command.op === 'update') sources(command.input)
  }
  return { ...value, data: data as Json }
}
export function taskReferences(value: RecordVersion): readonly string[] {
  const refs: string[] = []
  remapTaskReferences(value, hash => {
    refs.push(hash)
    return hash
  })
  return refs
}
