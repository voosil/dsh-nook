import { useCallback, useEffect, useState } from 'react'
import { Button, Input, DialogPortalContainer } from '@nook-dsh/ui-kit'
import {
  emptyTiming,
  type Task,
  type TaskInput,
  type TaskCommand,
  type TaskSnapshot,
  type Proposal,
} from '@nook-dsh/capability-task'
import type { Api } from '../lib/api.js'
import { TaskEditor, taskInput } from './task-editor.js'
import { TaskCalendar } from './task-calendar.js'
import { TaskSettingsPanel } from './task-settings.js'
import { displayTime } from '../lib/time.js'
const statusLabel: Record<Task['status'], string> = {
  todo: '待办',
  unscheduled: '待安排',
  queued: '待执行',
  running: '进行中',
  review: '待验收',
  done: '已完成',
  paused: '已暂停',
  attention: '需要介入',
  cancelled: '已取消',
}
export function TaskApp({ api }: { api: Api }) {
  const [panel, setPanel] = useState<HTMLDivElement | null>(null)
  const readTheme = () => {
    try {
      return localStorage.getItem('nook.appearance') ?? 'paper'
    } catch {
      return 'paper'
    }
  }
  const [theme, setTheme] = useState(readTheme)
  useEffect(() => {
    const update = () => setTheme(readTheme())
    window.addEventListener('storage', update)
    return () => window.removeEventListener('storage', update)
  }, [])
  const [snapshot, setSnapshot] = useState<TaskSnapshot>(),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [view, setView] = useState<'inbox' | 'list' | 'calendar'>('inbox'),
    [selected, setSelected] = useState<string | null>(null),
    [editor, setEditor] = useState<Task | 'new' | null>(null),
    [settings, setSettings] = useState(false),
    [search, setSearch] = useState('')
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const next = await api('snapshot', {}, signal)
      setSnapshot(next)
    },
    [api],
  )
  useEffect(() => {
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        await refresh(abort.signal)
      } catch (e) {
        if (!abort.signal.aborted) setError(e instanceof Error ? e.message : '连接暂不可用')
      } finally {
        if (!abort.signal.aborted)
          timer = setTimeout(() => {
            void poll()
          }, 2500)
      }
    }
    void poll()
    const hash = () => {
      if (window.location.hash.startsWith('#nook-task='))
        setSelected(decodeURIComponent(window.location.hash.slice(11)))
    }
    hash()
    window.addEventListener('hashchange', hash)
    return () => {
      abort.abort()
      clearTimeout(timer)
      window.removeEventListener('hashchange', hash)
    }
  }, [refresh])
  const command = async (command: TaskCommand) => {
    if (!snapshot) throw new Error('任务尚未加载')
    setError('')
    const receipt = await api('submit', {
      id: crypto.randomUUID(),
      deviceId: snapshot.deviceId,
      createdAt: new Date().toISOString(),
      command,
    })
    if (receipt.status === 'conflict') throw new Error(receipt.message)
    setMessage(receipt.message)
    await refresh()
  }
  const act = (task: Task, action: 'pause' | 'cancel' | 'complete' | 'resume' | 'start' | 'rework', detail = '') => {
    void command({ op: 'action', taskId: task.id, revision: task.revision, action, detail }).catch(e =>
      setError(e.message),
    )
  }
  const open = (task: Task) => {
    setSelected(task.id)
    window.location.hash = 'nook-task=' + task.id
  }
  const proposalAction = async (proposal: Proposal, action: 'approve' | 'defer' | 'feedback', text = '') =>
    command({ op: 'proposal', proposalId: proposal.id, revision: proposal.revision, action, text })
  const tasks = snapshot?.tasks.filter(t => !search || [t.title, t.description].join(' ').includes(search)) ?? []
  const selectedTask = snapshot?.tasks.find(t => t.id === selected),
    selectedProposal = snapshot?.proposals.find(p => p.id === selected)
  const reorder = (id: string, before: string) => {
    const ids = snapshot!.tasks.map(t => t.id).filter(t => t !== id)
    const index = ids.indexOf(before)
    if (index < 0) return
    ids.splice(index, 0, id)
    void command({ op: 'reorder', ids }).catch(e => setError(e.message))
  }
  const row = (task: Task) => (
    <article
      className="nt-task-row"
      key={task.id}
      draggable
      onDragStart={e => e.dataTransfer.setData('text/nook-task', task.id)}
      onDragOver={e => e.preventDefault()}
      onDrop={e => {
        e.preventDefault()
        reorder(e.dataTransfer.getData('text/nook-task'), task.id)
      }}
    >
      <button className="nt-row-main" onClick={() => open(task)}>
        <span>
          {task.kind === 'plan' ? '计划 · ' : ''}
          {task.title}
        </span>
        <small>
          {task.assignee === 'human' ? '我' : task.assignee === 'agent' ? 'Agent' : '未安排'} ·{' '}
          {statusLabel[task.status]}
          {task.timing.startAt ? ' · ' + displayTime(task.timing.startAt) : ''}
          {task.timing.repeat !== 'none' ? ' · 重复安排' : ''}
        </small>
        {task.reason && <small>{task.reason}</small>}
      </button>
      <div className="nt-actions">
        {task.assignee === 'human' && !['done', 'cancelled'].includes(task.status) && (
          <Button aria-label={'完成 ' + task.title} onClick={() => act(task, 'complete')}>
            完成
          </Button>
        )}
        <Button
          aria-label={'上移 ' + task.title}
          onClick={() => {
            const index = snapshot!.tasks.findIndex(t => t.id === task.id)
            if (index > 0) reorder(task.id, snapshot!.tasks[index - 1]!.id)
          }}
        >
          ↑
        </Button>
        <Button
          aria-label={'下移 ' + task.title}
          onClick={() => {
            const index = snapshot!.tasks.findIndex(t => t.id === task.id)
            const next = snapshot!.tasks[index + 1]
            if (next) reorder(next.id, task.id)
          }}
        >
          ↓
        </Button>
      </div>
    </article>
  )
  return (
    <div ref={setPanel} className="nt-workspace" data-nook-theme={theme} aria-label="Nook 任务工作区">
      <aside className="nt-sidebar">
        <a className="nt-brand" href="#nook">
          Nook
        </a>
        <h1>任务</h1>
        <nav aria-label="任务视图">
          {(
            [
              ['inbox', '待处理'],
              ['list', '计划与清单'],
              ['calendar', '日历与日程'],
            ] as const
          ).map(([key, label]) => (
            <Button
              key={key}
              variant="ghost"
              active={view === key}
              aria-pressed={view === key}
              onClick={() => {
                setView(key)
                setSelected(null)
              }}
            >
              {label}
            </Button>
          ))}
        </nav>
        <div className="nt-spacer" />
        <Button onClick={() => setSettings(true)}>任务设置</Button>
        <a href="#nook">返回笔记</a>
      </aside>
      <main className="nt-main">
        <header>
          <div>
            <p className="nt-eyebrow">让想法继续往前</p>
            <h2>
              {selectedTask?.title ??
                selectedProposal?.topic ??
                (view === 'inbox' ? '需要你的一点判断' : view === 'list' ? '计划与清单' : '日历与日程')}
            </h2>
          </div>
          <Button variant="accent" onClick={() => setEditor('new')}>
            ＋ 新建任务
          </Button>
        </header>
        {error && (
          <p className="nt-alert" role="alert">
            {error}
            <Button onClick={() => setError('')}>关闭</Button>
          </p>
        )}
        {message && (
          <p className="nt-message" role="status">
            {message}
            <Button variant="ghost" onClick={() => setMessage('')}>
              关闭
            </Button>
          </p>
        )}
        {!snapshot ? (
          <p>正在读取任务…</p>
        ) : (
          <>
            {snapshot.executionIssue && (
              <p className="nt-alert" role="alert">
                {snapshot.executionIssue}
              </p>
            )}
            {snapshot.conflict && <p className="nt-alert">任务同步存在冲突，后台已停止执行。请先处理同步冲突。</p>}
            {!snapshot.settings.ownerId && (
              <section className="nt-empty">
                <h3>先选一台负责执行的设备</h3>
                <p>任务会通过现有同步在设备间流转。设定主机后，就能统一安排和追踪。</p>
                <Button onClick={() => setSettings(true)}>设置执行主机</Button>
              </section>
            )}
            {snapshot.requests.filter(r => !snapshot.receipts.some(receipt => receipt.id === r.id)).length > 0 && (
              <p className="nt-muted">有操作已保存，等待执行主机确认。</p>
            )}
            {selectedTask ? (
              <section className="nt-detail">
                <div className="nt-actions">
                  <Button onClick={() => setSelected(null)}>← 返回</Button>
                  <Button onClick={() => setEditor(selectedTask)}>编辑</Button>
                  {['paused', 'attention', 'unscheduled'].includes(selectedTask.status) && (
                    <Button onClick={() => act(selectedTask, 'resume')}>继续</Button>
                  )}
                  {!['done', 'cancelled', 'paused'].includes(selectedTask.status) && (
                    <Button onClick={() => act(selectedTask, 'pause')}>暂停</Button>
                  )}
                  {!['done', 'cancelled'].includes(selectedTask.status) && (
                    <Button variant="danger" onClick={() => act(selectedTask, 'cancel')}>
                      取消任务
                    </Button>
                  )}
                </div>
                <p className="nt-muted">
                  {statusLabel[selectedTask.status]} · {selectedTask.assignee === 'human' ? '我来完成' : 'Agent'}
                  {selectedTask.reason ? ' · ' + selectedTask.reason : ''}
                </p>
                <p className="nt-prose">{selectedTask.description}</p>
                {selectedTask.scope && (
                  <p className="nt-prose">
                    <strong>范围</strong>
                    <br />
                    {selectedTask.scope}
                  </p>
                )}
                {selectedTask.constraints && (
                  <p className="nt-prose">
                    <strong>约束</strong>
                    <br />
                    {selectedTask.constraints}
                  </p>
                )}
                {selectedTask.acceptance && (
                  <p className="nt-prose">
                    <strong>完成标准</strong>
                    <br />
                    {selectedTask.acceptance}
                  </p>
                )}
                {selectedTask.kind === 'plan' && (
                  <section>
                    <h3>计划中的任务</h3>
                    {snapshot.tasks.filter(t => t.parentId === selectedTask.id).map(row)}
                  </section>
                )}
                {selectedTask.report && (
                  <section>
                    <h3>产物与检查</h3>
                    <p className="nt-prose">{selectedTask.report.summary}</p>
                    {selectedTask.report.artifacts.map((a, i) => (
                      <p key={i}>
                        <strong>{a.name}</strong>
                        <br />
                        {/^https?:\/\//.test(a.uri) ? (
                          <a href={a.uri} target="_blank" rel="noreferrer">
                            打开产物
                          </a>
                        ) : (
                          a.uri
                        )}
                        <small> · {a.version}</small>
                      </p>
                    ))}
                    {selectedTask.report.checks.map((c, i) => (
                      <p key={i}>
                        {c.passed ? '✓' : '○'} {c.name}：{c.evidence}
                      </p>
                    ))}
                    {selectedTask.status === 'review' && (
                      <div className="nt-actions">
                        <Button variant="accent" onClick={() => act(selectedTask, 'complete')}>
                          验收通过
                        </Button>
                        <Rework onSubmit={text => act(selectedTask, 'rework', text)} />
                      </div>
                    )}
                  </section>
                )}
                {selectedTask.sources.length > 0 && (
                  <details>
                    <summary>来源与依据</summary>
                    {selectedTask.sources.map((s, i) => (
                      <p key={i}>
                        <a
                          href={
                            s.kind === 'retrospective'
                              ? '#nook-task=' + s.noteId.replace(/^retrospective-(.+)-[0-9]+$/, '$1')
                              : '#nook-note=' + s.noteId
                          }
                        >
                          {s.kind === 'retrospective' ? '查看执行复盘' : '查看笔记'}
                        </a>{' '}
                        · {s.version}
                        <br />
                        {s.excerpt}
                      </p>
                    ))}
                  </details>
                )}
                <details>
                  <summary>执行与验收记录</summary>
                  {snapshot.runs
                    .filter(r => r.taskId === selectedTask.id)
                    .map(r => (
                      <p key={r.id}>
                        {r.phase === 'review' ? '验收' : '执行'} · {r.status} · {displayTime(r.startedAt)}
                        {r.error && ' · ' + r.error}
                      </p>
                    ))}
                  {snapshot.reviews
                    .filter(r => r.taskId === selectedTask.id)
                    .map(r => (
                      <p key={r.id}>
                        {r.verdict} · {r.summary}
                      </p>
                    ))}
                </details>
                <details>
                  <summary>任务历史</summary>
                  {selectedTask.history.map((h, i) => (
                    <p key={i}>
                      {displayTime(h.at)} · {h.detail || h.action}
                    </p>
                  ))}
                </details>
              </section>
            ) : selectedProposal ? (
              <ProposalCard proposal={selectedProposal} expanded action={proposalAction} />
            ) : view === 'inbox' ? (
              <>
                <section>
                  <h3>待评审提案</h3>
                  {snapshot.proposals
                    .filter(p => p.status === 'ready')
                    .map(p => (
                      <ProposalCard key={p.id} proposal={p} action={proposalAction} />
                    ))}
                  {!snapshot.proposals.some(p => p.status === 'ready') && (
                    <p className="nt-muted">有明确建议时，提案会出现在这里。</p>
                  )}
                  <Button
                    onClick={() => {
                      setMessage('正在整理选定来源…')
                      void api('refine', {})
                        .then(() => refresh())
                        .then(() => setMessage('本次整理结束'))
                        .catch(e => setError(e.message))
                    }}
                  >
                    整理选定来源
                  </Button>
                </section>
                <section>
                  <h3>待办与待验收</h3>
                  {tasks
                    .filter(
                      t =>
                        !t.parentId && ['todo', 'review', 'attention'].includes(t.status) && t.timing.repeat === 'none',
                    )
                    .map(row)}
                </section>
                <section>
                  <h3>提醒</h3>
                  {snapshot.notifications
                    .filter(n => !n.read)
                    .map(n => (
                      <article className="nt-task-row" key={n.id}>
                        <button
                          className="nt-row-main"
                          onClick={() => {
                            setSelected(n.targetId)
                            void command({ op: 'read', notificationId: n.id }).catch(e => setError(e.message))
                          }}
                        >
                          <strong>{n.title}</strong>
                          <small>{n.body}</small>
                        </button>
                        <Button
                          onClick={() => {
                            void command({ op: 'read', notificationId: n.id }).catch(e => setError(e.message))
                          }}
                        >
                          已读
                        </Button>
                      </article>
                    ))}
                </section>
                {snapshot.understandings.some(u => u.error) && (
                  <details>
                    <summary>有来源尚未完成理解</summary>
                    {snapshot.understandings
                      .filter(u => u.error)
                      .map(u => (
                        <p key={u.id}>
                          {u.title}：{u.error}
                        </p>
                      ))}
                  </details>
                )}
              </>
            ) : view === 'list' ? (
              <>
                <Input
                  placeholder="查找任务"
                  aria-label="查找任务"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                {(
                  [
                    'unscheduled',
                    'todo',
                    'queued',
                    'running',
                    'review',
                    'attention',
                    'paused',
                    'done',
                    'cancelled',
                  ] as const
                ).map(status => {
                  const group = tasks.filter(t => t.status === status && !t.parentId)
                  return group.length ? (
                    <section key={status}>
                      <h3>{statusLabel[status]}</h3>
                      {group.map(row)}
                    </section>
                  ) : null
                })}
                <details>
                  <summary>草案与暂缓的提案</summary>
                  {snapshot.proposals
                    .filter(p => p.status === 'draft' || p.status === 'deferred')
                    .map(p => (
                      <ProposalCard key={p.id} proposal={p} action={proposalAction} />
                    ))}
                </details>
              </>
            ) : (
              <TaskCalendar
                tasks={tasks.filter(t => !['done', 'cancelled'].includes(t.status))}
                open={open}
                schedule={(id, day) => {
                  const task = snapshot.tasks.find(t => t.id === id)
                  if (!task) return
                  const timing = day
                    ? { ...task.timing, startAt: new Date(day + 'T09:00:00').toISOString(), vague: '' }
                    : emptyTiming(task.timing.timeZone)
                  void command({
                    op: 'update',
                    taskId: id,
                    revision: task.revision,
                    input: { ...taskInput(task), timing },
                  }).catch(e => setError(e.message))
                }}
              />
            )}
          </>
        )}
      </main>
      <DialogPortalContainer value={panel}>
        {editor && snapshot && (
          <TaskEditor
            api={api}
            key={editor === 'new' ? 'new' : editor.id}
            {...(editor === 'new' ? {} : { task: editor })}
            snapshot={snapshot}
            close={() => setEditor(null)}
            save={async (input: TaskInput) => {
              await command(
                editor === 'new'
                  ? { op: 'create', taskId: crypto.randomUUID(), input }
                  : { op: 'update', taskId: editor.id, revision: editor.revision, input },
              )
            }}
          />
        )}
        {settings && snapshot && (
          <TaskSettingsPanel
            snapshot={snapshot}
            api={api}
            close={() => setSettings(false)}
            save={async settings => {
              const receipt = await api('configure', settings)
              if (receipt.status === 'conflict') throw new Error(receipt.message)
              setMessage(receipt.message)
              await refresh()
            }}
          />
        )}
      </DialogPortalContainer>
    </div>
  )
}
function Rework({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [text, setText] = useState('')
  return (
    <>
      <Input
        aria-label="返工意见"
        placeholder="补充一句需要修改的地方"
        value={text}
        onChange={e => setText(e.target.value)}
      />
      <Button onClick={() => onSubmit(text)}>安排返工</Button>
    </>
  )
}
function ProposalCard({
  proposal,
  action,
  expanded = false,
}: {
  proposal: Proposal
  expanded?: boolean
  action: (proposal: Proposal, action: 'approve' | 'defer' | 'feedback', text?: string) => Promise<void>
}) {
  const [text, setText] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const run = (op: 'approve' | 'defer' | 'feedback') => {
    setBusy(true)
    void action(proposal, op, text)
      .catch(e => setError(e.message))
      .finally(() => setBusy(false))
  }
  return (
    <article className="nt-proposal">
      <h3>{proposal.topic}</h3>
      <p>{proposal.summary}</p>
      <p>
        <strong>本次范围：</strong>
        {proposal.scope}
      </p>
      <p>
        <strong>关键后果：</strong>
        {proposal.consequences}
      </p>
      <p>
        <strong>需要决定：</strong>
        {proposal.decision}
      </p>
      <details open={expanded}>
        <summary>查看执行方案与依据</summary>
        {proposal.steps.map(step => (
          <p key={step.key}>
            <strong>{step.task.title}</strong>
            <br />
            {step.task.description}
            <br />
            完成标准：{step.task.acceptance}
          </p>
        ))}
        {proposal.sources.map((s, i) => (
          <p key={i}>
            <a
              href={
                s.kind === 'retrospective'
                  ? '#nook-task=' + s.noteId.replace(/^retrospective-(.+)-[0-9]+$/, '$1')
                  : '#nook-note=' + s.noteId
              }
            >
              {s.kind === 'retrospective' ? '执行复盘' : '来源笔记'}
            </a>{' '}
            · {s.excerpt}
          </p>
        ))}
      </details>
      <Input
        aria-label="补充意见"
        placeholder="补充一句，或写下暂缓原因"
        value={text}
        onChange={e => setText(e.target.value)}
      />
      <div className="nt-actions">
        <Button variant="accent" disabled={busy || proposal.status !== 'ready'} onClick={() => run('approve')}>
          按此推进
        </Button>
        <Button disabled={busy || !text.trim()} onClick={() => run('feedback')}>
          补充一句
        </Button>
        <Button disabled={busy} onClick={() => run('defer')}>
          暂缓
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
    </article>
  )
}
