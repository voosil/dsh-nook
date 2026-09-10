import { useEffect, useRef, useState } from 'react'
import type { ProjectDto } from '@nook-dsh/capability-project'
import type { NoteDto } from '@nook-dsh/capability-note'
import type { Value } from '@nook-dsh/adapter-notes-dsh/rpc'
import { Button, Dialog, Input, Select, Textarea } from '@nook-dsh/ui-kit'
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
    <Dialog
      ariaName="笔记总结"
      open
      onOpenChange={nextOpen => {
        if (!nextOpen) close()
      }}
      title="回看这一段时间"
      className="nook-modal nook-summary"
    >
      <p className="nook-muted">按笔记创建日期选取资料，生成后可编辑、保存。已有 AI 总结不会重复参与。</p>
      <div className="nook-actions">
        <Button disabled={busy} onClick={() => period(false)}>
          今天
        </Button>
        <Button disabled={busy} onClick={() => period(true)}>
          本周
        </Button>
      </div>
      <div className="nook-summary-fields">
        <label>
          开始日期
          <Input
            type="date"
            value={from}
            disabled={busy || !!preview}
            onChange={event => setFrom(event.target.value)}
          />
        </label>
        <label>
          结束日期
          <Input
            type="date"
            value={through}
            disabled={busy || !!preview}
            onChange={event => setThrough(event.target.value)}
          />
        </label>
        <label>
          项目
          <Select
            value={project}
            disabled={busy || !!preview}
            onValueChange={value => setProject(value)}
            options={[
              { value: '', label: '全部项目' },
              ...projects.map(item => ({ value: item.id, label: item.name })),
            ]}
          />
        </label>
      </div>
      <label>
        使用 DSH 模型
        <Select
          value={modelKey}
          disabled={busy}
          onValueChange={value => setModelKey(value)}
          options={[...models.map(item => ({ value: JSON.stringify([item.provider, item.id]), label: item.name }))]}
        />
      </label>
      {!models.length && <p className="nook-muted">尚无可用模型，请先在 DSH 设置中配置模型。</p>}
      {error && (
        <p className="nook-error" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <>
          <Input
            aria-label="总结标题"
            value={preview.title}
            onChange={event => setPreview({ ...preview, title: event.target.value })}
          />
          <Textarea
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
            <Button onClick={() => abort.current?.abort()}>取消生成</Button>
          </>
        ) : (
          <>
            <Button disabled={!modelKey || !from || !through || from > through} onClick={() => void generate()}>
              {preview ? '重新生成' : '生成总结'}
            </Button>
            {preview && (
              <Button variant="accent" onClick={() => void save()}>
                保存为笔记
              </Button>
            )}
          </>
        )}
      </div>
    </Dialog>
  )
}
