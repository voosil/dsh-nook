import { ExternalLink, Star } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { type NoteDto, type NoteInput } from '@nook-dsh/capability-note'
import type { ProjectDto } from '@nook-dsh/capability-project'
import type { Api } from '../lib/api.js'
import { NoteHistory } from './note-history.js'
import { Autosave, type SavedDraft } from '../lib/autosave.js'
import { fullDate, sourceLabels } from '../lib/note-format.js'
import { Button } from './button.js'
import { RichEditor } from './rich-editor.js'

const draftKey = (id: string) => `nook.note-draft.v1.${id}`

export type EditorHandle = {
  flush: () => Promise<boolean>
  dirty: () => boolean
  revision: () => number
  input: () => NoteInput
}
export function NoteEditor({
  initial,
  projects,
  api,
  onSaved,
  onDeleted,
  onCopy,
  handle,
  onExport,
  disabled = false,
}: {
  initial: NoteDto
  onExport: (input: NoteInput) => Promise<void>
  disabled?: boolean
  projects: readonly ProjectDto[]
  api: Api
  onSaved: (note: NoteDto) => void
  onDeleted: () => void
  onCopy: (input: NoteInput) => Promise<void>
  handle: { current: EditorHandle | null }
}) {
  const [recovery] = useState(() => {
    try {
      const draft = JSON.parse(localStorage.getItem(draftKey(initial.id)) ?? 'null') as SavedDraft | null
      return draft &&
        typeof draft.input?.markdown === 'string' &&
        typeof draft.input.title === 'string' &&
        typeof draft.input.pinned === 'boolean' &&
        (draft.input.projectId === null || typeof draft.input.projectId === 'string')
        ? draft
        : null
    } catch {
      return null
    }
  })
  const [input, setInput] = useState<NoteInput>(recovery?.input ?? initial)
  const [note, setNote] = useState(initial)
  const [state, setState] = useState('saved')
  const [error, setError] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const composing = useRef(false)
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const saved = useRef(onSaved)
  saved.current = onSaved
  const [controller] = useState(
    () =>
      new Autosave(
        initial,
        request => api('save', request),
        (status, message) => {
          if (!alive.current) return
          setState(status)
          setError(message ?? '')
          if (status !== 'saved') preserve()
          if (status === 'saved') {
            setNote(controller.note)
            if (!composing.current) setInput(controller.current)
            saved.current(controller.note)
            try {
              localStorage.removeItem(draftKey(initial.id))
            } catch {
              /* server copy is saved */
            }
          }
        },
      ),
  )

  function preserve() {
    try {
      localStorage.setItem(draftKey(initial.id), JSON.stringify(controller.draft))
    } catch {
      setError('浏览器无法保留临时草稿，请保持页面打开直至保存完成。')
    }
  }
  function change(next: NoteInput) {
    setInput(next)
    controller.edit(next)
    preserve()
    clearTimeout(timer.current)
    if (!composing.current)
      timer.current = setTimeout(() => {
        void controller.flush()
      }, 650)
  }
  useEffect(() => {
    alive.current = true
    if (recovery) {
      controller.recover(recovery)
      void controller.flush()
    }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (controller.dirty) {
        event.preventDefault()
        preserve()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      alive.current = false
      clearTimeout(timer.current)
      window.removeEventListener('beforeunload', beforeUnload)
      if (controller.dirty) preserve()
    }
  }, [])
  useEffect(() => {
    handle.current = {
      flush: () => controller.flush(),
      dirty: () => controller.dirty || historyOpen,
      revision: () => controller.note.revision,
      input: () => controller.current,
    }
    return () => {
      handle.current = null
    }
  }, [controller, handle, historyOpen])

  async function trash() {
    setBusy(true)
    try {
      if (!note.deletedAt && !(await controller.flush())) return
      await api('trash', { id: note.id, revision: controller.note.revision, deleted: !note.deletedAt })
      onDeleted()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section
      className="nook-editor"
      aria-label="笔记编辑区"
      onCompositionStart={() => {
        composing.current = true
        controller.pause()
        clearTimeout(timer.current)
      }}
      onCompositionEnd={() => {
        composing.current = false
        void controller.resume()
      }}
    >
      {historyOpen && (
        <NoteHistory
          note={note}
          api={api}
          close={() => setHistoryOpen(false)}
          restored={(next, copy) => {
            setHistoryOpen(false)
            if (!copy) {
              controller.adopt(next)
              if (next.deletedAt !== note.deletedAt) onDeleted()
            } else saved.current(next)
          }}
        />
      )}
      <div className="nook-editor-top">
        <span className="nook-muted">{sourceLabels[note.source.kind]}</span>
        <div className="nook-actions">
          <span role="status" className={state === 'error' ? 'nook-error-text' : 'nook-muted'}>
            {state === 'saving'
              ? '正在保存…'
              : state === 'dirty'
                ? '未保存'
                : state === 'error'
                  ? '保存失败'
                  : '已保存到本地 · 已入库'}
          </span>
          <Button
            disabled={disabled || busy || historyOpen}
            onClick={() =>
              void (async () => {
                setBusy(true)
                try {
                  if (await controller.flush()) setHistoryOpen(true)
                } finally {
                  setBusy(false)
                }
              })()
            }
          >
            历史版本
          </Button>
          <Button disabled={disabled || busy || historyOpen} onClick={() => void onExport(input)}>
            导出
          </Button>
          <Button disabled={disabled || busy || historyOpen} onClick={() => void trash()}>
            {note.deletedAt ? '恢复笔记' : '移到回收站'}
          </Button>
        </div>
      </div>
      {error && (
        <div className="nook-error" role="alert">
          {error}
          <div className="nook-actions">
            <Button
              onClick={() => {
                void controller.flush()
              }}
            >
              重试保存
            </Button>
            <Button onClick={() => void onCopy(input)}>另存为新笔记</Button>
          </div>
        </div>
      )}
      <div className="nook-paper">
        <input
          className="nook-title"
          aria-label="笔记标题"
          placeholder="无标题笔记"
          maxLength={300}
          value={input.title}
          disabled={disabled || busy || historyOpen || !!note.deletedAt}
          onChange={event => change({ ...input, title: event.target.value })}
        />
        <div className="nook-meta">
          <select
            aria-label="笔记所属项目"
            value={input.projectId ?? ''}
            disabled={disabled || busy || historyOpen || !!note.deletedAt}
            onChange={event => change({ ...input, projectId: event.target.value || null })}
          >
            <option value="">未分类</option>
            {projects.map(project => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <span title={fullDate(note.createdAt)}>创建于 {fullDate(note.createdAt)}</span>
          <span title={fullDate(note.updatedAt)}>更新于 {fullDate(note.updatedAt)}</span>
          <Button
            disabled={disabled || busy || historyOpen || !!note.deletedAt}
            active={input.pinned}
            onClick={() => change({ ...input, pinned: !input.pinned })}
          >
            <Star size={14} fill={input.pinned ? 'currentColor' : 'none'} aria-hidden="true" />
            {input.pinned ? '已置顶' : '置顶'}
          </Button>
        </div>
        {note.source.url && /^https?:\/\//i.test(note.source.url) && (
          <p className="nook-source">
            <a href={note.source.url} target="_blank" rel="noreferrer">
              查看原视频 / 来源 <ExternalLink size={14} aria-hidden="true" />
            </a>
            {note.source.author && <span> · {note.source.author}</span>}
          </p>
        )}
        {note.source.basedOn.length > 0 && (
          <p className="nook-source">
            整理依据：
            {note.source.basedOn.map((source, index) => (
              <a key={source.noteId} href={`/#nook-note=${source.noteId}`}>
                笔记 {index + 1}（版本 {source.revision}）{' '}
              </a>
            ))}
          </p>
        )}
        <RichEditor
          markdown={input.markdown}
          disabled={disabled || busy || historyOpen || !!note.deletedAt}
          onChange={markdown => change({ ...controller.current, markdown })}
        />
      </div>
    </section>
  )
}
