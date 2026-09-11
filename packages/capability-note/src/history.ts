import type { NoteHistoryEntry } from './index.js'

export const HISTORY_IDLE_MS = 5 * 60_000

export interface HistoryStage {
  /** Newest version is stable as older pages are appended. */
  readonly id: string
  readonly entries: NoteHistoryEntry[]
}

/** Group only adjacent, linear saves; clocks never determine graph order. */
export function historyStages(entries: readonly NoteHistoryEntry[]): HistoryStage[] {
  const stages: HistoryStage[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry.versionId)) continue
    seen.add(entry.versionId)
    const stage = stages.at(-1)
    const newer = stage?.entries.at(-1)
    const gap = newer ? Date.parse(newer.updatedAt) - Date.parse(entry.updatedAt) : NaN
    if (
      newer &&
      newer.kind === 'save' &&
      entry.kind === 'save' &&
      !newer.branchPoint &&
      !entry.branchPoint &&
      newer.parents.length === 1 &&
      newer.parents[0] === entry.versionId &&
      Number.isFinite(gap) &&
      gap >= 0 &&
      gap < HISTORY_IDLE_MS
    )
      stage!.entries.push(entry)
    else stages.push({ id: entry.versionId, entries: [entry] })
  }
  return stages
}

export const historyLabel = (entry: NoteHistoryEntry): string =>
  ({
    save: '保存版本',
    create: '创建笔记',
    merge: '自动合并',
    delete: '移入回收站',
    restore: '恢复版本',
  })[entry.kind]
