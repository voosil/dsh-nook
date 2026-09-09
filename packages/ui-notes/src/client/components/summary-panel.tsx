import { useEffect, useRef, useState } from 'react'
import type { ProjectDto } from '@nook-dsh/capability-project'
import type { NoteDto } from '@nook-dsh/capability-note'
import type { Value } from '@nook-dsh/adapter-notes-dsh/rpc'
import type { Api } from '../lib/api.js'

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function dateRange(from: string, through: string) {
  const start = new Date(`${from}T00:00:00`)
  const end = new Date(`${through}T00:00:00`)
  end.setDate(end.getDate() + 1)
  return { from: start.toISOString(), to: end.toISOString() }
}

export function SummaryPanel({
  api,
  projects,
  projectId,
  close,
  saved,
}: {
  api: Api
  projects: readonly ProjectDto[]
  projectId: string | null
  close: () => void
  saved: (note: NoteDto) => void
}) {
  const [from, setFrom] = useState(localDate(new Date()))
  const [through, setThrough] = useState(localDate(new Date()))
  const [project, setProject] = useState(projectId ?? '')
  const [models, setModels] = useState<Value<'models'>>([])
  const [modelKey, setModelKey] = useState('')
  const [preview, setPreview] = useState<Value<'summarize'> | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    const controller = new AbortController()
    void api('models', {}, controller.signal)
      .then(values => {
        setModels(values)
        setModelKey(values[0] ? JSON.stringify([values[0].provider, values[0].id]) : '')
      })
      .catch(cause => {
        if (!controller.signal.aborted) setError(String(cause))
      })
    return () => {
      alive.current = false
      controller.abort()
      abort.current?.abort()
    }
  }, [])
  function period(week: boolean) {
    const today = new Date()
    const start = new Date()
    if (week) start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
    setFrom(localDate(start))
    setThrough(localDate(today))
    setPreview(null)
  }
  async function generate() {
    const model = models.find(item => JSON.stringify([item.provider, item.id]) === modelKey)
    if (!model) return
    const controller = new AbortController()
    abort.current = controller
    setBusy(true)
    setError('')
    setPreview(null)
    try {
      const range = dateRange(from, through)
      const value = await api(
        'summarize',
        {
          ...range,
          projectId: project || null,
          provider: model.provider,
          model: model.id,
          title: `${from === through ? from + ' 日总结' : from + ' 至 ' + through + ' 总结'}${project ? ' · ' + projects.find(item => item.id === project)?.name : ''}`,
        },
        controller.signal,
      )
      if (alive.current) setPreview(value)
    } catch (cause) {
      if (alive.current)
        setError(controller.signal.aborted ? '已取消生成。' : cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  async function save() {
    if (!preview) return
    setBusy(true)
    try {
      const note = await api('create', {
        id: crypto.randomUUID(),
        title: preview.title,
        markdown: preview.markdown,
        pinned: false,
        projectId: project || null,
        source: { kind: 'ai-summary', url: null, author: null, basedOn: preview.basedOn },
      })
      saved(note)
    } catch (cause) {
      setError(String(cause))
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  return (
    <div className="nook-modal-backdrop">
      <section className="nook-modal nook-summary" role="dialog" aria-label="笔记总结">
        <div className="nook-heading">
          <h2>回看这一段时间</h2>
          <button onClick={close}>关闭</button>
        </div>
        <p className="nook-muted">按笔记创建日期选取资料，生成后可编辑、保存。已有 AI 总结不会重复参与。</p>
        <div className="nook-actions">
          <button disabled={busy} onClick={() => period(false)}>
            今天
          </button>
          <button disabled={busy} onClick={() => period(true)}>
            本周
          </button>
        </div>
        <div className="nook-summary-fields">
          <label>
            开始日期
            <input
              type="date"
              value={from}
              disabled={busy || !!preview}
              onChange={event => setFrom(event.target.value)}
            />
          </label>
          <label>
            结束日期
            <input
              type="date"
              value={through}
              disabled={busy || !!preview}
              onChange={event => setThrough(event.target.value)}
            />
          </label>
          <label>
            项目
            <select value={project} disabled={busy || !!preview} onChange={event => setProject(event.target.value)}>
              <option value="">全部项目</option>
              {projects.map(item => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          使用 DSH 模型
          <select value={modelKey} disabled={busy} onChange={event => setModelKey(event.target.value)}>
            {models.map(item => (
              <option key={JSON.stringify([item.provider, item.id])} value={JSON.stringify([item.provider, item.id])}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {!models.length && <p className="nook-muted">尚无可用模型，请先在 DSH 设置中配置模型。</p>}
        {error && (
          <p className="nook-error" role="alert">
            {error}
          </p>
        )}
        {preview && (
          <>
            <input
              aria-label="总结标题"
              value={preview.title}
              onChange={event => setPreview({ ...preview, title: event.target.value })}
            />
            <textarea
              aria-label="总结预览"
              rows={12}
              value={preview.markdown}
              onChange={event => setPreview({ ...preview, markdown: event.target.value })}
            />
            <p className="nook-muted">依据 {preview.basedOn.length} 条笔记生成</p>
          </>
        )}
        <div className="nook-actions">
          {busy ? (
            <>
              <span role="status">正在处理…</span>
              <button onClick={() => abort.current?.abort()}>取消生成</button>
            </>
          ) : (
            <>
              <button disabled={!modelKey || !from || !through || from > through} onClick={() => void generate()}>
                {preview ? '重新生成' : '生成总结'}
              </button>
              {preview && (
                <button className="nook-new" onClick={() => void save()}>
                  保存为笔记
                </button>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  )
}
