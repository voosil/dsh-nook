import {
  ArrowUpRight,
  Bold,
  Code,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  Heading2,
  Inbox,
  Italic,
  List,
  ListChecks,
  NotebookPen,
  Plus,
  Quote,
  Redo2,
  Sprout,
  Star,
  Trash2,
  Undo2,
  Video,
} from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { noteTitle, type NoteDto, type NoteInput } from '@nook-dsh/capability-note'
import type { ProjectDto } from '@nook-dsh/capability-project'
import {
  descriptors,
  RPC_PACKAGE,
  type NotebookRemote,
  type Request,
  type Method,
  type Value,
  type Result,
} from '@nook-dsh/adapter-notes-dsh/rpc'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { Autosave } from './autosave.js'
import css from './style.css'
import { SummaryPanel } from './summary.js'
import { VideoPanel } from './video.js'

export const inject = ['slots', 'remote']
export type Api = <K extends Method>(method: K, request: Request<K>, signal?: AbortSignal) => Promise<Value<K>>
const sourceLabels: Record<string, string> = {
  personal: '个人笔记',
  transcript: '视频字幕 / 转写',
  'comment-note': '评论区笔记',
  'ai-article': 'AI 整理文稿',
  'ai-summary': 'AI 总结',
}
const personal = { kind: 'personal' as const, url: null, author: null, basedOn: [] }
const date = (value: string) =>
  new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
const fullDate = (value: string) =>
  new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
const draftKey = (id: string) => `nook.note-draft.v1.${id}`

function Button({
  children,
  onClick,
  active,
  disabled,
  title,
}: {
  children: ReactNode
  onClick: () => void
  active?: boolean
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      aria-label={title}
      title={title}
      className={active ? 'active' : ''}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}

function RichEditor({
  markdown,
  onChange,
  disabled,
}: {
  markdown: string
  onChange: (markdown: string) => void
  disabled: boolean
}) {
  const changed = useRef(onChange)
  changed.current = onChange
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false }, underline: false }),
      Markdown,
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: markdown,
    contentType: 'markdown',
    editable: !disabled,
    immediatelyRender: false,
    editorProps: { attributes: { 'aria-label': '笔记正文', role: 'textbox', 'aria-multiline': 'true' } },
    onUpdate: ({ editor: current }) => changed.current(current.getMarkdown()),
  })
  useEffect(() => {
    editor?.setEditable(!disabled, false)
  }, [editor, disabled])
  return (
    <>
      {!disabled && (
        <div className="nook-toolbar" role="toolbar" aria-label="正文格式">
          <Button
            title="标题"
            onClick={() => {
              editor?.chain().focus().toggleHeading({ level: 2 }).run()
            }}
          >
            <Heading2 size={16} aria-hidden="true" />
          </Button>
          <Button
            title="粗体"
            onClick={() => {
              editor?.chain().focus().toggleBold().run()
            }}
          >
            <Bold size={16} aria-hidden="true" />
          </Button>
          <Button
            title="斜体"
            onClick={() => {
              editor?.chain().focus().toggleItalic().run()
            }}
          >
            <Italic size={16} aria-hidden="true" />
          </Button>
          <Button
            title="无序列表"
            onClick={() => {
              editor?.chain().focus().toggleBulletList().run()
            }}
          >
            <List size={16} aria-hidden="true" /> 列表
          </Button>
          <Button
            title="待办清单"
            onClick={() => {
              editor?.chain().focus().toggleTaskList().run()
            }}
          >
            <ListChecks size={16} aria-hidden="true" /> 待办
          </Button>
          <Button
            title="引用"
            onClick={() => {
              editor?.chain().focus().toggleBlockquote().run()
            }}
          >
            <Quote size={16} aria-hidden="true" /> 引用
          </Button>
          <Button
            title="代码块"
            onClick={() => {
              editor?.chain().focus().toggleCodeBlock().run()
            }}
          >
            <Code size={16} aria-hidden="true" />
          </Button>
          <Button
            title="撤销"
            onClick={() => {
              editor?.chain().focus().undo().run()
            }}
          >
            <Undo2 size={16} aria-hidden="true" />
          </Button>
          <Button
            title="重做"
            onClick={() => {
              editor?.chain().focus().redo().run()
            }}
          >
            <Redo2 size={16} aria-hidden="true" />
          </Button>
        </div>
      )}
      <EditorContent editor={editor} />
    </>
  )
}

type EditorHandle = { flush: () => Promise<boolean> }
function NoteEditor({
  initial,
  projects,
  api,
  onSaved,
  onDeleted,
  onCopy,
  handle,
}: {
  initial: NoteDto
  projects: readonly ProjectDto[]
  api: Api
  onSaved: (note: NoteDto) => void
  onDeleted: () => void
  onCopy: (input: NoteInput) => Promise<void>
  handle: { current: EditorHandle | null }
}) {
  const [recovery] = useState(() => {
    try {
      const draft = JSON.parse(localStorage.getItem(draftKey(initial.id)) ?? 'null') as {
        revision: number
        input: NoteInput
      } | null
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
  const [blocked, setBlocked] = useState(!!recovery && recovery.revision !== initial.revision)
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const saved = useRef(onSaved)
  saved.current = onSaved
  const [controller] = useState(
    () =>
      new Autosave(
        initial,
        async request => {
          const next = await api('save', request)
          if (alive.current) {
            setNote(next)
            saved.current(next)
          }
          return next
        },
        (status, message) => {
          if (!alive.current) return
          setState(status)
          setError(message ?? '')
          if (status === 'saved') {
            try {
              localStorage.removeItem(draftKey(initial.id))
            } catch {
              /* server copy is saved */
            }
          }
        },
      ),
  )

  function preserve(next: NoteInput) {
    try {
      localStorage.setItem(draftKey(initial.id), JSON.stringify({ revision: controller.note.revision, input: next }))
    } catch {
      setError('浏览器无法保留临时草稿，请保持页面打开直至保存完成。')
    }
  }
  function change(next: NoteInput) {
    setInput(next)
    controller.edit(next)
    preserve(next)
    clearTimeout(timer.current)
    if (!blocked)
      timer.current = setTimeout(() => {
        void controller.flush()
      }, 650)
  }
  useEffect(() => {
    alive.current = true
    if (recovery) {
      controller.edit(recovery.input)
      if (recovery.revision === initial.revision && !initial.deletedAt) void controller.flush()
      else setError('发现未保存草稿，但服务器版本已变化。请另存为新笔记，或导出草稿后重新载入。')
    }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (controller.dirty) {
        event.preventDefault()
        preserve(controller.current)
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      alive.current = false
      clearTimeout(timer.current)
      window.removeEventListener('beforeunload', beforeUnload)
      if (controller.dirty) preserve(controller.current)
    }
  }, [])
  useEffect(() => {
    handle.current = { flush: () => (blocked ? Promise.resolve(false) : controller.flush()) }
    return () => {
      handle.current = null
    }
  }, [controller, blocked, handle])

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
  function download() {
    const blob = new Blob([input.title ? `# ${input.title}\n\n${input.markdown}` : input.markdown], {
      type: 'text/markdown;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${noteTitle(input).replace(/[\\/:*?"<>|]/g, '_')}.md`
    anchor.click()
    URL.revokeObjectURL(url)
  }
  return (
    <section className="nook-editor" aria-label="笔记编辑区">
      <div className="nook-editor-top">
        <span className="nook-muted">{sourceLabels[note.source.kind]}</span>
        <div className="nook-actions">
          <span role="status" className={state === 'error' ? 'nook-error-text' : 'nook-muted'}>
            {blocked
              ? '草稿待处理'
              : state === 'saving'
                ? '正在保存…'
                : state === 'dirty'
                  ? '未保存'
                  : state === 'error'
                    ? '保存失败'
                    : '已保存 · 已入库'}
          </span>
          <Button onClick={download}>导出</Button>
          <Button disabled={busy || blocked} onClick={() => void trash()}>
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
                setBlocked(false)
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
          disabled={!!note.deletedAt}
          onChange={event => change({ ...input, title: event.target.value })}
        />
        <div className="nook-meta">
          <select
            aria-label="笔记所属项目"
            value={input.projectId ?? ''}
            disabled={!!note.deletedAt}
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
            disabled={!!note.deletedAt}
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
          disabled={!!note.deletedAt}
          onChange={markdown => change({ ...controller.current, markdown })}
        />
      </div>
    </section>
  )
}

function NotebookApp({ api, close }: { api: Api; close: () => void }) {
  const [projects, setProjects] = useState<readonly ProjectDto[]>([])
  const [notes, setNotes] = useState<readonly NoteDto[]>([])
  const [selected, setSelected] = useState<NoteDto | null>(null)
  const [projectId, setProjectId] = useState<string | null | undefined>(undefined)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'updated' | 'created' | 'title'>('updated')
  const [trash, setTrash] = useState(false)
  const [mode, setMode] = useState<'notes' | 'projects'>('notes')
  const [total, setTotal] = useState(0)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [videoOpen, setVideoOpen] = useState(false)
  const [page, setPage] = useState(0)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [projectForm, setProjectForm] = useState<{ id?: string; name: string; description: string } | null>(null)
  const [deleteProject, setDeleteProject] = useState<ProjectDto | null>(null)
  const handle = useRef<EditorHandle | null>(null)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    void api('projects', {}, controller.signal)
      .then(setProjects)
      .catch(cause => {
        if (!controller.signal.aborted) setError(String(cause))
      })
    return () => controller.abort()
  }, [refresh])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    const timer = setTimeout(
      () => {
        void api(
          'list',
          { search, sort, trash, offset: page * 50, limit: 50, ...(projectId === undefined ? {} : { projectId }) },
          controller.signal,
        )
          .then(result => {
            setNotes(result.notes)
            setTotal(result.total)
            setLoading(false)
          })
          .catch(cause => {
            if (!controller.signal.aborted) {
              setError(String(cause))
              setLoading(false)
            }
          })
      },
      search ? 200 : 0,
    )
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [projectId, search, sort, trash, page, refresh])
  useEffect(() => {
    panel.current?.focus()
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    const openHash = () => {
      const match = window.location.hash.match(/^#nook-note=([0-9a-f-]{36})$/i)
      if (!match?.[1]) return
      void (async () => {
        if (handle.current && !(await handle.current.flush())) return
        const note = await api('get', { id: match[1]! }, controller.signal)
        if (!note || note.deletedAt) {
          setError('引用的笔记不存在或已进入回收站。')
          return
        }
        setSelected(note)
        setMode('notes')
        setTrash(false)
      })().catch(cause => {
        if (!controller.signal.aborted) setError(String(cause))
      })
    }
    openHash()
    window.addEventListener('hashchange', openHash)
    return () => {
      controller.abort()
      window.removeEventListener('hashchange', openHash)
    }
  }, [])

  async function navigate(action: () => void) {
    if (handle.current && !(await handle.current.flush())) return
    action()
  }
  async function create(copy?: NoteInput) {
    if (!copy && handle.current && !(await handle.current.flush())) return
    setBusy(true)
    setError('')
    try {
      const note = await api('create', {
        id: crypto.randomUUID(),
        title: copy?.title ?? '',
        markdown: copy?.markdown ?? '',
        projectId: copy?.projectId ?? projectId ?? null,
        pinned: copy?.pinned ?? false,
        source: personal,
      })
      setSelected(note)
      setMode('notes')
      setTrash(false)
      setSearch('')
      setPage(0)
      setRefresh(value => value + 1)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  function view(id: string | null | undefined, deleted = false) {
    void navigate(() => {
      setSelected(null)
      setProjectId(id)
      setTrash(deleted)
      setMode('notes')
      setPage(0)
    })
  }
  async function openNote(note: NoteDto) {
    await navigate(() => {
      setBusy(true)
      void api('get', { id: note.id })
        .then(setSelected)
        .catch(cause => setError(String(cause)))
        .finally(() => setBusy(false))
    })
  }
  async function submitProject() {
    if (!projectForm) return
    setBusy(true)
    try {
      if (projectForm.id)
        await api('updateProject', { id: projectForm.id, name: projectForm.name, description: projectForm.description })
      else await api('createProject', { name: projectForm.name, description: projectForm.description })
      setProjectForm(null)
      setRefresh(value => value + 1)
    } catch (cause) {
      setError(String(cause))
    } finally {
      setBusy(false)
    }
  }
  const heading = trash
    ? '回收站'
    : projectId === null
      ? '未分类'
      : projectId
        ? (projects.find(project => project.id === projectId)?.name ?? '项目笔记')
        : '所有笔记'
  return (
    <div
      ref={panel}
      tabIndex={-1}
      className="nook-workspace"
      role="dialog"
      aria-modal="true"
      aria-label="Nook 笔记工作区"
      onKeyDown={event => {
        if (event.key === 'Escape' && !projectForm && !deleteProject && !summaryOpen && !videoOpen) {
          event.stopPropagation()
          void navigate(close)
        }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
          event.preventDefault()
          void handle.current?.flush()
        }
        if (event.key === 'Tab') {
          const items = Array.from(
            panel.current?.querySelectorAll<HTMLElement>(
              'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], a[href]',
            ) ?? [],
          ).filter(item => item.offsetParent !== null)
          const first = items[0],
            last = items.at(-1)
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last?.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first?.focus()
          }
        }
      }}
    >
      <style>{css}</style>
      <aside className="nook-nav">
        <div className="nook-brand">
          <span>
            <NotebookPen size={21} aria-hidden="true" />
          </span>{' '}
          Nook
        </div>
        <p className="nook-tagline">记下此刻，慢慢生长。</p>
        <button className="nook-new" disabled={busy} onClick={() => void create()}>
          <Plus size={16} aria-hidden="true" /> 写一条笔记 <kbd>新建</kbd>
        </button>
        <nav aria-label="笔记导航">
          <Button active={mode === 'notes' && !trash && projectId === undefined} onClick={() => view(undefined)}>
            <FileText size={16} aria-hidden="true" /> 所有笔记
          </Button>
          <Button active={mode === 'notes' && !trash && projectId === null} onClick={() => view(null)}>
            <Inbox size={16} aria-hidden="true" /> 未分类
          </Button>
          <Button
            active={mode === 'projects'}
            onClick={() =>
              void navigate(() => {
                setSelected(null)
                setMode('projects')
              })
            }
          >
            <FolderOpen size={16} aria-hidden="true" /> 项目
          </Button>
        </nav>
        <div className="nook-section-label">
          我的项目{' '}
          <Button title="新建项目" onClick={() => setProjectForm({ name: '', description: '' })}>
            <Plus size={16} aria-hidden="true" />
          </Button>
        </div>
        <nav className="nook-project-nav">
          {projects.map(project => (
            <Button
              key={project.id}
              active={projectId === project.id && mode === 'notes' && !trash}
              onClick={() => view(project.id)}
            >
              <Folder size={16} aria-hidden="true" />
              {project.name}
            </Button>
          ))}
          {!projects.length && <p className="nook-muted">想法可以先不分类。</p>}
        </nav>
        <div className="nook-nav-bottom">
          <Button onClick={() => void navigate(() => setVideoOpen(true))}>
            <Video size={16} aria-hidden="true" /> 视频转文稿
          </Button>
          <Button onClick={() => void navigate(() => setSummaryOpen(true))}>
            <ListChecks size={16} aria-hidden="true" /> 日 / 周总结
          </Button>
          <Button active={trash} onClick={() => view(undefined, true)}>
            <Trash2 size={16} aria-hidden="true" /> 回收站
          </Button>
          <Button onClick={() => void navigate(close)}>
            <ArrowUpRight size={16} aria-hidden="true" /> 返回 AI 对话
          </Button>
        </div>
      </aside>
      <main className="nook-main">
        {error && (
          <div className="nook-error" role="alert">
            {error}{' '}
            <Button
              onClick={() => {
                setError('')
                setRefresh(value => value + 1)
              }}
            >
              重试
            </Button>
          </div>
        )}
        {mode === 'projects' ? (
          <section className="nook-projects">
            <div className="nook-heading">
              <div>
                <small>为长期的事情留一处空间</small>
                <h1>项目</h1>
              </div>
              <Button onClick={() => setProjectForm({ name: '', description: '' })}>
                <Plus size={16} aria-hidden="true" /> 新建项目
              </Button>
            </div>
            <div className="nook-project-grid">
              {projects.map(project => (
                <article key={project.id}>
                  <small>PROJECT</small>
                  <h2>
                    <button onClick={() => view(project.id)}>{project.name}</button>
                  </h2>
                  <p className="nook-muted">
                    创建于 {fullDate(project.createdAt)}
                    <br />
                    更新于 {fullDate(project.updatedAt)}
                  </p>
                  <div className="nook-actions">
                    <Button
                      onClick={() =>
                        setProjectForm({ id: project.id, name: project.name, description: project.description })
                      }
                    >
                      编辑
                    </Button>
                    <Button onClick={() => setDeleteProject(project)}>删除项目</Button>
                  </div>
                </article>
              ))}
            </div>
            {!projects.length && (
              <div className="nook-empty">
                <h2>把相关的笔记放在一起</h2>
                <p>一本正在读的书，一个长期实践，或一个尚未成形的想法。</p>
              </div>
            )}
          </section>
        ) : (
          <div className="nook-notes-layout">
            <section className="nook-list" aria-label="笔记列表">
              <div className="nook-list-heading">
                <h1>
                  {heading} <span>{total}</span>
                </h1>
                <input
                  type="search"
                  aria-label="搜索笔记"
                  placeholder="搜索标题和正文…"
                  value={search}
                  onChange={event => {
                    setSearch(event.target.value)
                    setPage(0)
                  }}
                />
                <div className="nook-list-sort">
                  <select
                    aria-label="笔记排序"
                    value={sort}
                    onChange={event => {
                      setSort(event.target.value as typeof sort)
                      setPage(0)
                    }}
                  >
                    <option value="updated">最近编辑</option>
                    <option value="created">最近创建</option>
                    <option value="title">标题顺序</option>
                  </select>
                  {loading && <small role="status">加载中…</small>}
                </div>
              </div>
              <div className="nook-note-items">
                {notes.map(note => (
                  <button
                    key={note.id}
                    className={`nook-note-card ${selected?.id === note.id ? 'selected' : ''}`}
                    disabled={busy}
                    onClick={() => void openNote(note)}
                  >
                    <strong>
                      {note.pinned && (
                        <span className="nook-pin" role="img" aria-label="已置顶">
                          <Star size={14} fill="currentColor" aria-hidden="true" />
                        </span>
                      )}
                      {noteTitle(note)}
                    </strong>
                    <p>{note.markdown.replace(/[#*`>]/g, '').slice(0, 120) || '还没有正文，继续写下去…'}</p>
                    <footer>
                      <time dateTime={sort === 'created' ? note.createdAt : note.updatedAt}>
                        {date(sort === 'created' ? note.createdAt : note.updatedAt)}
                      </time>
                      <span>{sourceLabels[note.source.kind]}</span>
                    </footer>
                  </button>
                ))}
              </div>
              {!loading && !notes.length && (
                <div className="nook-empty">
                  <p>{search ? '没有找到匹配的笔记' : trash ? '回收站是空的' : '还没有笔记，记下第一个想法吧。'}</p>
                </div>
              )}
              {total > 50 && (
                <div className="nook-pagination">
                  <Button disabled={page === 0} onClick={() => setPage(value => value - 1)}>
                    上一页
                  </Button>
                  <span>
                    {page + 1} / {Math.ceil(total / 50)}
                  </span>
                  <Button disabled={(page + 1) * 50 >= total} onClick={() => setPage(value => value + 1)}>
                    下一页
                  </Button>
                </div>
              )}
            </section>
            {selected ? (
              <NoteEditor
                key={selected.id}
                initial={selected}
                api={api}
                projects={projects}
                handle={handle}
                onSaved={note => {
                  setSelected(note)
                  setRefresh(value => value + 1)
                }}
                onDeleted={() => {
                  setSelected(null)
                  setRefresh(value => value + 1)
                }}
                onCopy={async input => {
                  await create(input)
                }}
              />
            ) : (
              <section className="nook-welcome">
                <Sprout className="nook-welcome-mark" size={60} strokeWidth={1.5} aria-hidden="true" />
                <small>A LITTLE SPACE FOR YOUR MIND</small>
                <h2>让想法，有处安放。</h2>
                <button className="nook-new" disabled={busy} onClick={() => void create()}>
                  <Plus size={16} aria-hidden="true" /> 写一条笔记
                </button>
                <div className="nook-welcome-foot">选择左侧笔记，继续上一次的思考。</div>
              </section>
            )}
          </div>
        )}
      </main>
      {videoOpen && (
        <VideoPanel
          api={api}
          projects={projects}
          close={() => setVideoOpen(false)}
          refresh={() => setRefresh(value => value + 1)}
          openNote={id => {
            void api('get', { id })
              .then(note => {
                setVideoOpen(false)
                setSelected(note)
                setMode('notes')
                setTrash(false)
              })
              .catch(cause => setError(String(cause)))
          }}
        />
      )}
      {summaryOpen && (
        <SummaryPanel
          api={api}
          projects={projects}
          projectId={projectId ?? null}
          close={() => setSummaryOpen(false)}
          saved={note => {
            setSummaryOpen(false)
            setSelected(note)
            setMode('notes')
            setTrash(false)
            setRefresh(value => value + 1)
          }}
        />
      )}
      {projectForm && (
        <div className="nook-modal-backdrop">
          <form
            className="nook-modal"
            onSubmit={event => {
              event.preventDefault()
              void submitProject()
            }}
          >
            <h2>{projectForm.id ? '编辑项目' : '新建项目'}</h2>
            <label>
              项目名称
              <input
                autoFocus
                required
                maxLength={120}
                value={projectForm.name}
                onChange={event => setProjectForm({ ...projectForm, name: event.target.value })}
              />
            </label>
            <label>
              描述
              <textarea
                maxLength={2000}
                rows={4}
                value={projectForm.description}
                onChange={event => setProjectForm({ ...projectForm, description: event.target.value })}
              />
            </label>
            <div className="nook-actions">
              <Button onClick={() => setProjectForm(null)}>取消</Button>
              <button type="submit" disabled={busy}>
                保存项目
              </button>
            </div>
          </form>
        </div>
      )}
      {deleteProject && (
        <div className="nook-modal-backdrop">
          <div className="nook-modal" role="alertdialog" aria-label="删除项目">
            <h2>删除「{deleteProject.name}」？</h2>
            <p>其中的笔记会保留，并移到“未分类”。</p>
            <div className="nook-actions">
              <Button onClick={() => setDeleteProject(null)}>取消</Button>
              <Button
                disabled={busy}
                onClick={() => {
                  setBusy(true)
                  void api('deleteProject', { id: deleteProject.id })
                    .then(() => {
                      setDeleteProject(null)
                      setRefresh(value => value + 1)
                    })
                    .catch(cause => setError(String(cause)))
                    .finally(() => setBusy(false))
                }}
              >
                删除项目
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export async function apply(ctx: ClientContext): Promise<void> {
  await ctx.remote.$mount({ package: RPC_PACKAGE, descriptors })
  ctx.inject(['remote.nookNotebookRpc', 'slots'], mountWorkspace)
}

function mountWorkspace(ctx: ClientContext): void {
  const remote: NotebookRemote = ctx.remote.nookNotebookRpc
  const api: Api = async <K extends Method>(
    method: K,
    request: Request<K>,
    signal?: AbortSignal,
  ): Promise<Value<K>> => {
    const call = remote[method] as (
      request: Request<K>,
      signal?: AbortSignal,
    ) => Promise<RemoteResult<Result<Value<K>>>>
    const response = await call(request, signal)
    if (!response.ok) throw new Error(response.error.message)
    if (!response.value.ok) throw new Error(response.value.error.message)
    return response.value.value
  }
  let open = true
  const listeners = new Set<() => void>()
  const setOpen = (value: boolean) => {
    open = value
    if (!value && (window.location.hash === '#nook' || window.location.hash.startsWith('#nook-note='))) {
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
    }
    for (const listener of listeners) listener()
  }
  function Workspace() {
    const visible = useSyncExternalStore(
      listener => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      () => open,
    )
    return visible ? <NotebookApp api={api} close={() => setOpen(false)} /> : null
  }
  ctx.effect(() => {
    const openHash = () => {
      if (window.location.hash === '#nook' || window.location.hash.startsWith('#nook-note=')) setOpen(true)
    }
    window.addEventListener('hashchange', openHash)
    return () => {
      listeners.clear()
      window.removeEventListener('hashchange', openHash)
    }
  })
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register({ name: 'shell.overlay', id: 'nook-notebook', order: 10 }, Workspace),
  )
}
