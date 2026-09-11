import type { UpdateController } from '../hooks/use-update.js'
import { UpdatePanel } from './update-panel.js'
import {
  ArrowUpRight,
  FileText,
  Folder,
  MoreHorizontal,
  FolderOpen,
  Inbox,
  Settings,
  Store,
  NotebookPen,
  ListChecks,
  Plus,
  Sprout,
  Star,
  Trash2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { noteTitle, type NoteDto, type NoteInput } from '@nook-dsh/capability-note'
import type { ProjectDto } from '@nook-dsh/capability-project'
import type { Api } from '../lib/api.js'
import type { SyncApi } from '../lib/sync-api.js'
import { date, fullDate, sourceLabels } from '../lib/note-format.js'
import {
  Button,
  Dialog,
  DialogPortalContainer,
  Input,
  Kbd,
  Menu,
  Select,
  Textarea,
  Toast,
  type MenuAnchor,
} from '@nook-dsh/ui-kit'
import { NoteEditor, type EditorHandle } from './note-editor.js'
import { SummaryPanel } from './summary-panel.js'
import { VideoPanel } from './video-panel.js'
import { exportNote, type ExportReceipt } from '../lib/export-note.js'
import { ToolMarket } from './tool-market.js'
import { useAppearance } from '../hooks/use-appearance.js'
import { SyncControl } from './sync-control.js'

const personal = { kind: 'personal' as const, url: null, author: null, basedOn: [] }

export function NotebookApp({
  visible = true,
  api,
  sync,
  syncDisabled = false,
  updater,
  registerUpdateSave,
  close,
  onDeploy,
}: {
  visible?: boolean
  api: Api
  sync: SyncApi
  syncDisabled?: boolean
  updater?: UpdateController
  registerUpdateSave?: (save: () => Promise<void>) => () => void
  close: () => void
  onDeploy: () => Promise<void>
}) {
  const [appearance, setAppearance] = useAppearance()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [marketOpen, setMarketOpen] = useState(false)
  const [syncChange, setSyncChange] = useState(0)
  const [editorEpoch, setEditorEpoch] = useState(0)
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
  const [menu, setMenu] = useState<
    (MenuAnchor & ({ kind: 'note'; note: NoteDto } | { kind: 'project'; project: ProjectDto })) | null
  >(null)
  const [exportReceipt, setExportReceipt] = useState<ExportReceipt | null>(null)
  const [draggedProject, setDraggedProject] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const operation = useRef(false)
  const selecting = useRef<AbortController | null>(null)
  const handle = useRef<EditorHandle | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  useEffect(
    () =>
      registerUpdateSave?.(async () => {
        if (handle.current && !(await handle.current.flush())) throw new Error('笔记尚未保存，请保存成功后重试更新。')
      }),
    [registerUpdateSave],
  )
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  useEffect(() => {
    if (!visible) return
    const controller = new AbortController()
    setRefresh(value => value + 1)
    const current = selectedRef.current
    if (current)
      void api('get', { id: current.id }, controller.signal)
        .then(next => {
          if (
            !next ||
            controller.signal.aborted ||
            selectedRef.current?.id !== current.id ||
            next.revision === handle.current?.revision()
          )
            return
          if (handle.current?.dirty()) {
            void handle.current.flush()
            return
          }
          setSelected(next)
          setEditorEpoch(value => value + 1)
        })
        .catch(() => {})
    return () => controller.abort()
  }, [syncChange, visible])

  useEffect(() => {
    const controller = new AbortController()
    void api('projects', {}, controller.signal)
      .then(result => {
        if (!controller.signal.aborted) setProjects(result)
      })
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
            if (controller.signal.aborted) return
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
    if (visible && !panel.current?.contains(document.activeElement)) panel.current?.focus({ preventScroll: true })
  }, [visible])
  useEffect(() => {
    const controller = new AbortController()
    const openHash = () => {
      const match = window.location.hash.match(/^#nook-note=([0-9a-f-]{36})$/i)
      if (!match?.[1]) return
      void (async () => {
        if (handle.current && !(await handle.current.flush())) return
        cancelSelection()
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

  async function navigate(action: () => void | Promise<void>) {
    if (busy) return
    if (handle.current && !(await handle.current.flush())) return
    await action()
  }
  async function create(copy?: NoteInput) {
    if (!copy && handle.current && !(await handle.current.flush())) return
    setBusy(true)
    setError('')
    cancelSelection()
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
      cancelSelection()
      setSelected(null)
      setProjectId(id)
      setTrash(deleted)
      setMode('notes')
      setPage(0)
    })
  }
  function cancelSelection() {
    selecting.current?.abort()
    selecting.current = null
  }
  async function openNote(note: NoteDto) {
    await navigate(() => {
      // Selecting a note must not toggle the global busy state: every button in the
      // app is disabled by busy, so flipping it here flashes the whole interface.
      cancelSelection()
      const controller = new AbortController()
      selecting.current = controller
      void api('get', { id: note.id }, controller.signal)
        .then(next => {
          if (!controller.signal.aborted) setSelected(next)
        })
        .catch(cause => {
          if (!controller.signal.aborted) setError(String(cause))
        })
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
  async function download(input: Pick<NoteInput, 'title' | 'markdown'>) {
    try {
      setExportReceipt(await exportNote(input))
    } catch (cause) {
      setError(String(cause))
    }
  }
  async function noteAction(note: NoteDto, action: 'pin' | 'trash' | 'export') {
    if (operation.current) return
    operation.current = true
    setBusy(true)
    setError('')
    try {
      if (action === 'export' && selectedRef.current?.id === note.id && handle.current) {
        await download(handle.current.input())
        return
      }
      if (handle.current && !(await handle.current.flush())) return
      const current = await api('get', { id: note.id })
      if (!current) throw new Error('笔记不存在，请刷新列表。')
      if (action === 'export') {
        await download(current)
        return
      }
      const next =
        action === 'trash'
          ? await api('trash', { id: current.id, revision: current.revision, deleted: !current.deletedAt })
          : (
              await api('save', {
                id: current.id,
                revision: current.revision,
                title: current.title,
                markdown: current.markdown,
                projectId: current.projectId,
                pinned: !current.pinned,
                versionId: current.versionId,
                requestId: crypto.randomUUID(),
              })
            ).note
      setNotes(notes =>
        action === 'trash'
          ? notes.filter(item => item.id !== next.id)
          : notes.map(item => (item.id === next.id ? next : item)),
      )
      if (selectedRef.current?.id === note.id) {
        setSelected(action === 'trash' ? null : next)
        setEditorEpoch(value => value + 1)
      }
      setRefresh(value => value + 1)
    } catch (cause) {
      setError(String(cause))
    } finally {
      operation.current = false
      setBusy(false)
    }
  }
  async function moveProject(id: string, target: string) {
    if (operation.current || id === target) return
    const ids = projects.map(project => project.id)
    const from = ids.indexOf(id),
      to = ids.indexOf(target)
    if (from < 0 || to < 0) return
    ids.splice(from, 1)
    ids.splice(to, 0, id)
    operation.current = true
    setBusy(true)
    try {
      setProjects(await api('reorderProjects', { ids }))
      setRefresh(value => value + 1)
    } catch (cause) {
      setError(String(cause))
      setRefresh(value => value + 1)
    } finally {
      operation.current = false
      setBusy(false)
    }
  }
  async function removeProject() {
    if (!deleteProject || operation.current) return
    operation.current = true
    setBusy(true)
    setError('')
    try {
      if (handle.current && !(await handle.current.flush())) {
        setError('当前笔记尚未保存，请取消后处理保存问题，再删除项目。')
        return
      }
      await api('deleteProject', { id: deleteProject.id })
      if (projectId === deleteProject.id) {
        setProjectId(null)
        setPage(0)
      }
      const current = selectedRef.current
      if (current?.projectId === deleteProject.id) {
        // The provider changes note revisions while detaching the deleted project.
        cancelSelection()
        setSelected(null)
        const next = await api('get', { id: current.id })
        setSelected(next)
        setEditorEpoch(value => value + 1)
      }
      setDeleteProject(null)
      setRefresh(value => value + 1)
    } catch (cause) {
      setError(String(cause))
    } finally {
      operation.current = false
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
    <DialogPortalContainer value={panel.current}>
      <div
        ref={panel}
        tabIndex={-1}
        className="nook-workspace"
        // Keep the page and editor instance alive across shell navigation. Inline
        // display also hides portalled descendants despite the workspace flex rule.
        style={visible ? undefined : { display: 'none' }}
        data-nook-theme={appearance}
        role="dialog"
        aria-modal="true"
        aria-label="Nook 笔记工作区"
        onKeyDown={event => {
          if (
            event.key === 'Escape' &&
            !menu &&
            !projectForm &&
            !deleteProject &&
            !summaryOpen &&
            !videoOpen &&
            !settingsOpen &&
            !marketOpen
          ) {
            event.stopPropagation()
            void navigate(close)
          }
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
            event.preventDefault()
            void handle.current?.flush()
          }
          if (event.key === 'Tab' && !(event.target as HTMLElement).closest('.nui-dialog')) {
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
        <aside className="nook-nav">
          <div className="nook-brand">
            <span>
              <NotebookPen size={21} aria-hidden="true" />
            </span>{' '}
            Nook
          </div>
          <p className="nook-tagline">记下此刻，慢慢生长。</p>
          <Button variant="accent" className="nook-new" disabled={busy} onClick={() => void create()}>
            <Plus size={16} aria-hidden="true" /> 写一条笔记 <Kbd>新建</Kbd>
          </Button>
          <nav aria-label="笔记导航">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void navigate(() => {
                  window.location.hash = 'nook-tasks'
                  close()
                })
              }
            >
              <ListChecks size={16} aria-hidden="true" /> 任务与日程
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              active={mode === 'notes' && !trash && projectId === undefined}
              onClick={() => view(undefined)}
            >
              <FileText size={16} aria-hidden="true" /> 所有笔记
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              active={mode === 'notes' && !trash && projectId === null}
              onClick={() => view(null)}
            >
              <Inbox size={16} aria-hidden="true" /> 未分类
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
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
            <Button
              variant="ghost"
              disabled={busy}
              title="新建项目"
              onClick={() => setProjectForm({ name: '', description: '' })}
            >
              <Plus size={16} aria-hidden="true" />
            </Button>
          </div>
          <nav className="nook-project-nav">
            {projects.map(project => (
              <div
                key={project.id}
                className={`nook-project-row ${draggedProject === project.id ? 'dragging' : ''} ${dropTarget === project.id ? 'drop-target' : ''}`}
                draggable={!busy}
                onDragStart={event => {
                  setMenu(null)
                  setDraggedProject(project.id)
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', project.id)
                }}
                onDragEnd={() => {
                  setDraggedProject(null)
                  setDropTarget(null)
                }}
                onDragOver={event => {
                  if (draggedProject && !busy) {
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                    setDropTarget(project.id)
                  }
                }}
                onDrop={event => {
                  event.preventDefault()
                  if (draggedProject) void moveProject(draggedProject, project.id)
                  setDraggedProject(null)
                  setDropTarget(null)
                }}
                onContextMenu={event => {
                  event.preventDefault()
                  if (!busy) setMenu({ kind: 'project', project, x: event.clientX, y: event.clientY })
                }}
              >
                <Button
                  variant="ghost"
                  disabled={busy}
                  active={projectId === project.id && mode === 'notes' && !trash}
                  onClick={() => view(project.id)}
                >
                  <Folder size={16} aria-hidden="true" />
                  <span>{project.name}</span>
                </Button>
                <Button
                  variant="ghost"
                  className="nook-project-more"
                  iconOnly
                  disabled={busy}
                  title={`项目操作：${project.name}`}
                  aria-haspopup="menu"
                  onClick={event => {
                    const rect = event.currentTarget.getBoundingClientRect()
                    setMenu({ kind: 'project', project, x: rect.left, y: rect.bottom })
                  }}
                >
                  <MoreHorizontal size={16} aria-hidden="true" />
                </Button>
              </div>
            ))}
            {!projects.length && <p className="nook-muted">想法可以先不分类。</p>}
          </nav>
          <div className="nook-nav-bottom">
            <Button variant="ghost" disabled={busy} onClick={() => void navigate(() => setMarketOpen(true))}>
              <Store size={16} aria-hidden="true" /> 工具市集
            </Button>
            <Button variant="ghost" disabled={busy} active={trash} onClick={() => view(undefined, true)}>
              <Trash2 size={16} aria-hidden="true" /> 回收站
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => void navigate(close)}>
              <ArrowUpRight size={16} aria-hidden="true" /> 返回 AI 对话
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setSettingsOpen(true)}>
              <Settings size={16} aria-hidden="true" /> 设置
            </Button>
          </div>
        </aside>
        <SyncControl
          visible={visible}
          disabled={syncDisabled}
          update={updater && <UpdatePanel controller={updater} />}
          api={sync}
          onChanged={setSyncChange}
          onDeploy={() => navigate(onDeploy)}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          appearance={appearance}
          onAppearanceChange={setAppearance}
        />
        <ToolMarket
          open={marketOpen}
          onOpenChange={setMarketOpen}
          onVideo={() => {
            setMarketOpen(false)
            setVideoOpen(true)
          }}
          onSummary={() => {
            setMarketOpen(false)
            setSummaryOpen(true)
          }}
        />
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
                <Button disabled={busy} onClick={() => setProjectForm({ name: '', description: '' })}>
                  <Plus size={16} aria-hidden="true" /> 新建项目
                </Button>
              </div>
              <div className="nook-project-grid">
                {projects.map(project => (
                  <article key={project.id}>
                    <small>PROJECT</small>
                    <h2>
                      <Button variant="ghost" onClick={() => view(project.id)}>
                        {project.name}
                      </Button>
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
                      <Button disabled={busy} onClick={() => setDeleteProject(project)}>
                        删除项目
                      </Button>
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
                  <Input
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
                    <Select
                      aria-label="笔记排序"
                      value={sort}
                      onValueChange={value => {
                        setSort(value as typeof sort)
                        setPage(0)
                      }}
                      options={[
                        { value: 'updated', label: '最近编辑' },
                        { value: 'created', label: '最近创建' },
                        { value: 'title', label: '标题顺序' },
                      ]}
                    />
                    {loading && <small role="status">加载中…</small>}
                  </div>
                </div>
                <div className="nook-note-items">
                  {notes.map(note => (
                    <Button
                      variant="ghost"
                      key={note.id}
                      className={`nook-note-card ${selected?.id === note.id ? 'selected' : ''}`}
                      disabled={busy}
                      onClick={() => void openNote(note)}
                      aria-haspopup="menu"
                      onContextMenu={event => {
                        event.preventDefault()
                        if (!busy) setMenu({ kind: 'note', note, x: event.clientX, y: event.clientY })
                      }}
                      onKeyDown={event => {
                        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                          event.preventDefault()
                          const rect = event.currentTarget.getBoundingClientRect()
                          setMenu({ kind: 'note', note, x: rect.left + 20, y: rect.top + 20 })
                        }
                      }}
                    >
                      <strong>
                        {note.pinned && (
                          <span className="nook-pin" role="img" aria-label="已置顶">
                            <Star size={14} fill="currentColor" aria-hidden="true" />
                          </span>
                        )}
                        {noteTitle(note)}
                      </strong>
                      <p>{note.markdown.replace(/[#*`>]/g, '').slice(0, 120) || '还没有正文…'}</p>
                      <footer>
                        <time dateTime={sort === 'created' ? note.createdAt : note.updatedAt}>
                          {date(sort === 'created' ? note.createdAt : note.updatedAt)}
                        </time>
                        <span>{sourceLabels[note.source.kind]}</span>
                      </footer>
                    </Button>
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
                  key={`${selected.id}:${editorEpoch}`}
                  initial={selected}
                  api={api}
                  projects={projects}
                  handle={handle}
                  disabled={busy}
                  onExport={download}
                  onSaved={note => {
                    setSelected(note)
                    setNotes(notes => notes.map(item => (item.id === note.id ? note : item)))
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
                  <small>NOOK FOR YOUR MIND</small>
                  <h2>让想法，有处安放。</h2>
                  <Button variant="accent" className="nook-new" disabled={busy} onClick={() => void create()}>
                    <Plus size={16} aria-hidden="true" /> 写一条笔记
                  </Button>
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
          <Dialog
            open
            onOpenChange={nextOpen => {
              if (!nextOpen) setProjectForm(null)
            }}
            title={projectForm.id ? '编辑项目' : '新建项目'}
            className="nook-modal"
          >
            <form
              onSubmit={event => {
                event.preventDefault()
                void submitProject()
              }}
            >
              <label>
                项目名称
                <Input
                  aria-label="项目名称"
                  autoFocus
                  disabled={busy}
                  required
                  maxLength={120}
                  value={projectForm.name}
                  onChange={event => setProjectForm({ ...projectForm, name: event.target.value })}
                />
              </label>
              <label>
                描述
                <Textarea
                  aria-label="描述"
                  maxLength={2000}
                  disabled={busy}
                  rows={4}
                  value={projectForm.description}
                  onChange={event => setProjectForm({ ...projectForm, description: event.target.value })}
                />
              </label>
              {error && (
                <p className="nook-error" role="alert">
                  {error}
                </p>
              )}
              <div className="nook-actions">
                <Button disabled={busy} onClick={() => setProjectForm(null)}>
                  取消
                </Button>
                <Button type="submit" variant="accent" disabled={busy}>
                  保存项目
                </Button>
              </div>
            </form>
          </Dialog>
        )}
        {deleteProject && (
          <Dialog
            alert
            ariaName="删除项目"
            open
            onOpenChange={nextOpen => {
              if (!nextOpen) setDeleteProject(null)
            }}
            title={`删除「${deleteProject.name}」？`}
            description="其中的笔记会保留，并移到“未分类”。"
            className="nook-modal"
            footer={
              <>
                <Button disabled={busy} onClick={() => setDeleteProject(null)}>
                  取消
                </Button>
                <Button variant="danger" disabled={busy} onClick={() => void removeProject()}>
                  删除项目
                </Button>
              </>
            }
          >
            {error && (
              <p className="nook-error" role="alert">
                {error}
              </p>
            )}
          </Dialog>
        )}
        {menu && (
          <Menu
            key={`${menu.kind}:${menu.kind === 'note' ? menu.note.id : menu.project.id}:${menu.x}:${menu.y}`}
            anchor={menu}
            open
            onOpenChange={nextOpen => {
              if (!nextOpen) setMenu(null)
            }}
            items={
              menu.kind === 'note'
                ? [
                    { label: '导出', run: () => void noteAction(menu.note, 'export') },
                    ...(!menu.note.deletedAt
                      ? [
                          {
                            label: menu.note.pinned ? '取消置顶' : '置顶',
                            run: () => void noteAction(menu.note, 'pin'),
                          },
                        ]
                      : []),
                    {
                      label: menu.note.deletedAt ? '恢复笔记' : '删除',
                      danger: !menu.note.deletedAt,
                      run: () => void noteAction(menu.note, 'trash'),
                    },
                  ]
                : [
                    {
                      label: '编辑项目',
                      run: () => {
                        setError('')
                        setProjectForm({
                          id: menu.project.id,
                          name: menu.project.name,
                          description: menu.project.description,
                        })
                      },
                    },
                    {
                      label: '上移',
                      disabled: projects[0]?.id === menu.project.id,
                      run: () => {
                        const index = projects.findIndex(p => p.id === menu.project.id)
                        if (index > 0) void moveProject(menu.project.id, projects[index - 1]!.id)
                      },
                    },
                    {
                      label: '下移',
                      disabled: projects.at(-1)?.id === menu.project.id,
                      run: () => {
                        const index = projects.findIndex(p => p.id === menu.project.id)
                        const next = projects[index + 1]
                        if (next) void moveProject(menu.project.id, next.id)
                      },
                    },
                    {
                      label: '删除项目',
                      danger: true,
                      run: () => {
                        setError('')
                        setDeleteProject(menu.project)
                      },
                    },
                  ]
            }
          />
        )}
        {exportReceipt && (
          <Toast
            title={exportReceipt.id ? '笔记已导出' : '已开始下载笔记'}
            closeLabel="关闭导出提示"
            message={
              exportReceipt.id ? (
                exportReceipt.name
              ) : (
                <>
                  {exportReceipt.name}
                  <br />
                  <small>可在浏览器下载列表中查看文件。</small>
                </>
              )
            }
            onClose={() => setExportReceipt(null)}
            action={
              exportReceipt.id ? (
                <Button
                  onClick={() => {
                    void window.nookDesktop?.revealExport(exportReceipt.id!).catch(cause => setError(String(cause)))
                  }}
                >
                  <FolderOpen size={16} aria-hidden="true" /> 打开文件夹
                </Button>
              ) : undefined
            }
          />
        )}
      </div>
    </DialogPortalContainer>
  )
}
