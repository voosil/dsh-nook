import { ExternalLink, MoreHorizontal, Star } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { type NoteDto, type NoteInput } from '@nook-dsh/capability-note'
import type { ProjectDto } from '@nook-dsh/capability-project'
import type { Api } from '../lib/api.js'
import { NoteHistory } from './note-history.js'
import { Autosave, type SavedDraft } from '../lib/autosave.js'
import { fullDate, sourceLabels } from '../lib/note-format.js'
import { Button, Input, Menu, Select, type MenuAnchor } from '@nook-dsh/ui-kit'
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
  const [error, setError] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [menu, setMenu] = useState<MenuAnchor | null>(null)
  const composing = useRef(false)
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  const saved = useRef(onSaved)
  saved.current = onSaved
  const [controller] = useState(
    () =>
      new Autosave(
        initial,
        request => api('save', request),
        (status, message) => {
          if (!alive.current) return
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
    controller.schedule()
  }
  useEffect(() => {
    alive.current = true
    controller.resume()
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
      controller.dispose()
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

  return (
    <section
      className="nook-editor"
      aria-label="笔记编辑区"
      onCompositionStart={() => {
        composing.current = true
        controller.pause()
      }}
      onCompositionEnd={() => {
        composing.current = false
        controller.resume()
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
        <Button
          variant="ghost"
          iconOnly
          title="笔记操作"
          aria-haspopup="menu"
          aria-expanded={!!menu && !disabled && !busy && !historyOpen}
          disabled={disabled || busy || historyOpen}
          onClick={event => {
            const rect = event.currentTarget.getBoundingClientRect()
            setMenu(menu ? null : { x: rect.left, y: rect.bottom })
          }}
        >
          <MoreHorizontal size={18} aria-hidden="true" />
        </Button>
        {menu && !disabled && !busy && !historyOpen && (
          <Menu
            anchor={menu}
            open
            onOpenChange={open => {
              if (!open) setMenu(null)
            }}
            items={[
              {
                label: '历史版本',
                run: () => {
                  setMenu(null)
                  void (async () => {
                    setBusy(true)
                    try {
                      if (await controller.flush()) setHistoryOpen(true)
                    } finally {
                      setBusy(false)
                    }
                  })()
                },
              },
              {
                label: '导出',
                run: () => {
                  setMenu(null)
                  void onExport(input)
                },
              },
            ]}
          />
        )}
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
        <Input
          className="nook-title"
          aria-label="笔记标题"
          placeholder="无标题笔记"
          maxLength={300}
          value={input.title}
          disabled={disabled || busy || historyOpen || !!note.deletedAt}
          onChange={event => change({ ...input, title: event.target.value })}
        />
        <div className="nook-meta">
          <Select
            variant="ghost"
            aria-label="笔记所属项目"
            value={input.projectId ?? ''}
            disabled={disabled || busy || historyOpen || !!note.deletedAt}
            onValueChange={value => change({ ...input, projectId: value || null })}
            options={[
              { value: '', label: '未分类' },
              ...projects.map(project => ({ value: project.id, label: project.name })),
            ]}
          />
          <span title={fullDate(note.createdAt)}>创建于 {fullDate(note.createdAt)}</span>
          <span title={fullDate(note.updatedAt)}>更新于 {fullDate(note.updatedAt)}</span>
          <Button
            variant="ghost"
            className="nook-pin"
            disabled={disabled || busy || historyOpen || !!note.deletedAt}
            aria-pressed={input.pinned}
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
