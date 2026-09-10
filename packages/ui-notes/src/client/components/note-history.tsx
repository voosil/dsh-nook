import { useEffect, useRef, useState } from 'react'
import type { NoteDto, NoteHistoryEntry, RestoreNoteRequest } from '@nook-dsh/capability-note'
import type { Api } from '../lib/api.js'
import { Button, Dialog } from '@nook-dsh/ui-kit'
import { historyLabel, historyStages } from '../lib/note-history.js'

const historyDate = (value: string) =>
  new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

/** Highlight the changed span, retaining exact Markdown rather than re-rendering it. */
function Difference({ value, other }: { value: string; other: string }) {
  let start = 0
  while (start < Math.min(value.length, other.length) && value[start] === other[start]) start++
  let end = value.length,
    otherEnd = other.length
  while (end > start && otherEnd > start && value[end - 1] === other[otherEnd - 1]) {
    end--
    otherEnd--
  }
  return (
    <pre className="nook-history-content">
      {value.slice(0, start)}
      <mark>{value.slice(start, end)}</mark>
      {value.slice(end)}
    </pre>
  )
}
export function NoteHistory({
  note,
  api,
  close,
  restored,
}: {
  note: NoteDto
  api: Api
  close: () => void
  restored: (note: NoteDto, copy: boolean) => void
}) {
  const [entries, setEntries] = useState<readonly NoteHistoryEntry[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [historical, setHistorical] = useState<NoteDto | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const lifecycle = useRef<AbortController | null>(null)
  const request = useRef<RestoreNoteRequest | null>(null)
  const stages = historyStages(entries)
  useEffect(() => {
    const controller = new AbortController()
    lifecycle.current = controller
    void api('history', { id: note.id }, controller.signal)
      .then(page => {
        if (controller.signal.aborted) return
        setEntries(page.entries)
        setCursor(page.cursor)
        setSelected(page.entries[0]?.versionId ?? null)
      })
      .catch(e => {
        if (!controller.signal.aborted) setError(String(e))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => {
      controller.abort()
      lifecycle.current = null
    }
  }, [api, note.id])
  useEffect(() => {
    if (!selected) return
    const controller = new AbortController()
    setHistorical(null)
    void api('getHistoryVersion', { id: note.id, versionId: selected }, controller.signal)
      .then(value => {
        if (!controller.signal.aborted) setHistorical(value)
      })
      .catch(e => {
        if (!controller.signal.aborted) setError(String(e))
      })
    return () => controller.abort()
  }, [api, note.id, selected])
  async function more() {
    if (!cursor) return
    setLoading(true)
    setError('')
    try {
      const page = await api('history', { id: note.id, cursor }, lifecycle.current?.signal)
      if (!lifecycle.current) return
      setEntries(old => [...old, ...page.entries.filter(e => !old.some(v => v.versionId === e.versionId))])
      setCursor(page.cursor)
    } catch (e) {
      if (lifecycle.current) setError(String(e))
    } finally {
      if (lifecycle.current) setLoading(false)
    }
  }
  async function restore(copy: boolean) {
    if (!selected || historical?.versionId !== selected) return
    setBusy(true)
    setError('')
    if (!request.current || request.current.versionId !== selected || request.current.copy !== copy)
      request.current = { id: note.id, versionId: selected, requestId: crypto.randomUUID(), copy }
    try {
      const value = await api('restoreHistoryVersion', request.current, lifecycle.current?.signal)
      if (lifecycle.current) restored(value, copy)
    } catch (e) {
      if (lifecycle.current) setError(String(e))
    } finally {
      if (lifecycle.current) setBusy(false)
    }
  }
  function versionButton(entry: NoteHistoryEntry, stageSize = 1) {
    return (
      <Button
        variant="ghost"
        type="button"
        key={entry.versionId}
        className="nook-history-version"
        disabled={busy}
        aria-current={selected === entry.versionId ? 'true' : undefined}
        onClick={() => setSelected(entry.versionId)}
      >
        <strong>{entry.title}</strong>
        <span>{historyDate(entry.updatedAt)}</span>
        <small>
          {stageSize > 1 ? '连续编辑' : historyLabel(entry)}
          {entry.deleted && entry.kind !== 'delete' ? ' · 已删除' : ''}
          {entry.versionId === note.versionId ? ' · 当前版本' : ''}
          {stageSize > 1 ? ` · ${stageSize} 次保存` : ''}
        </small>
      </Button>
    )
  }
  return (
    <Dialog
      open
      onOpenChange={nextOpen => {
        if (!nextOpen) close()
      }}
      title="笔记历史"
      description="恢复会生成新版本，现有历史始终保留。"
      className="nook-modal nook-history"
    >
      {error && (
        <p className="nook-error" role="alert">
          {error}
        </p>
      )}
      <div className="nook-history-layout">
        <nav aria-label="历史版本列表">
          {stages.map(stage => (
            <div className="nook-history-stage" key={stage.id}>
              {versionButton(stage.entries[0]!, stage.entries.length)}
              {stage.entries.length > 1 && (
                <details className="nook-history-details">
                  <summary>展开其余 {stage.entries.length - 1} 次保存</summary>
                  {stage.entries.slice(1).map(entry => versionButton(entry))}
                </details>
              )}
            </div>
          ))}
          {loading && <p role="status">正在读取历史…</p>}
          {!loading && !entries.length && <p>暂无历史版本。</p>}
          {cursor && (
            <>
              <p className="nook-muted">还有更早的版本，加载后会补全编辑阶段和保存次数。</p>
              <Button disabled={loading || busy} onClick={() => void more()}>
                加载更多
              </Button>
            </>
          )}
        </nav>
        <div className="nook-history-preview">
          {historical && historical.versionId === selected ? (
            <>
              <div className="nook-history-comparison">
                <section>
                  <h3>历史版本</h3>
                  <h4>{historical.title || '无标题笔记'}</h4>
                  <p className="nook-muted">
                    {historical.pinned ? '已置顶' : '未置顶'} ·{' '}
                    {historical.projectId === note.projectId ? '归属与当前一致' : '项目归属有变化'}
                  </p>
                  <Difference value={historical.markdown} other={note.markdown} />
                </section>
                <section>
                  <h3>当前内容</h3>
                  <h4>{note.title || '无标题笔记'}</h4>
                  <p className="nook-muted">高亮显示正文的差异范围</p>
                  <Difference value={note.markdown} other={historical.markdown} />
                </section>
              </div>
              <div className="nook-actions">
                <Button disabled={busy} onClick={() => void restore(false)}>
                  恢复此版本
                </Button>
                <Button disabled={busy} onClick={() => void restore(true)}>
                  另存为新笔记
                </Button>
              </div>
            </>
          ) : selected ? (
            <p role="status">正在读取版本…</p>
          ) : null}
        </div>
      </div>
    </Dialog>
  )
}
