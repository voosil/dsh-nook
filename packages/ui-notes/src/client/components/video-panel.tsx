import { ExternalLink } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Api } from '../lib/api.js'
import type { Value } from '@nook-dsh/adapter-notes-dsh/rpc'
import type { ProjectDto } from '@nook-dsh/capability-project'
import { Button, Dialog, Input, Select, Switch } from '@nook-dsh/ui-kit'
export function VideoPanel({
  api,
  projects,
  close,
  refresh,
  openNote,
}: {
  api: Api
  projects: readonly ProjectDto[]
  close: () => void
  refresh: () => void
  openNote: (id: string) => void
}) {
  const [url, setUrl] = useState('')
  const [projectId, setProjectId] = useState('')
  const [strategy, setStrategy] = useState<'none' | 'local' | 'llm'>('local')
  const [write, setWrite] = useState(false)
  const [models, setModels] = useState<Value<'models'>>([])
  const [modelKey, setModelKey] = useState('')
  const [skills, setSkills] = useState<Value<'videoSkills'>>([])
  const [skill, setSkill] = useState('video-to-essay')
  const [jobId, setJobId] = useState(() => {
    try {
      return sessionStorage.getItem('nook.video.job') ?? ''
    } catch {
      return ''
    }
  })
  const [job, setJob] = useState<Value<'videoJob'>>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const refreshed = useRef('')
  useEffect(() => {
    const controller = new AbortController()
    void Promise.all([api('models', {}, controller.signal), api('videoSkills', {}, controller.signal)])
      .then(([models, skills]) => {
        setModels(models)
        setSkills(skills)
        setModelKey(models[0] ? JSON.stringify([models[0].provider, models[0].id]) : '')
      })
      .catch(cause => {
        if (!controller.signal.aborted) setError(String(cause))
      })
    return () => controller.abort()
  }, [])
  useEffect(() => {
    if (!jobId) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    async function poll() {
      try {
        const next = await api('videoJob', { id: jobId }, controller.signal)
        if (controller.signal.aborted) return
        setJob(next)
        if (!next) {
          setJobId('')
          setError('上次任务不在当前进程中；已保存的笔记和资料缓存仍保留，可重新提交。')
          return
        }
        if (next.status === 'running') timer = setTimeout(() => void poll(), 1500)
        else if (refreshed.current !== next.id) {
          refreshed.current = next.id
          refresh()
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(String(cause))
          timer = setTimeout(() => void poll(), 3000)
        }
      }
    }
    void poll()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [jobId])
  async function start() {
    setBusy(true)
    setError('')
    const model = models.find(item => JSON.stringify([item.provider, item.id]) === modelKey)
    try {
      const next = await api('startVideo', {
        id: crypto.randomUUID(),
        url,
        projectId: projectId || null,
        strategy,
        write,
        skill,
        provider: model?.provider ?? '',
        model: model?.id ?? '',
      })
      setJob(next)
      setJobId(next.id)
      try {
        sessionStorage.setItem('nook.video.job', next.id)
      } catch {
        /* only a UI resume hint */
      }
    } catch (cause) {
      setError(String(cause))
    } finally {
      setBusy(false)
    }
  }
  const running = job?.status === 'running'
  return (
    <Dialog
      ariaName="视频转文稿"
      open
      onOpenChange={nextOpen => {
        if (!nextOpen) close()
      }}
      title="把视频，留下来"
      className="nook-modal nook-summary"
    >
      <p className="nook-muted">保存字幕或评论区笔记，也可以进一步整理成文章。所有来源会显示在笔记中。</p>
      <label>
        视频链接或 BV 号
        <Input
          autoFocus
          value={url}
          disabled={busy || running}
          placeholder="Bilibili / YouTube 单视频链接"
          onChange={event => setUrl(event.target.value)}
        />
      </label>
      <label>
        保存到项目
        <Select
          value={projectId}
          disabled={busy || running}
          onValueChange={value => setProjectId(value)}
          options={[
            { value: '', label: '未分类' },
            ...projects.map(project => ({ value: project.id, label: project.name })),
          ]}
        />
      </label>
      <label>
        B站评论笔记
        <Select
          value={strategy}
          disabled={busy || running}
          onValueChange={value => setStrategy(value as typeof strategy)}
          options={[
            { value: 'local', label: '本地规则选卡（不调用模型）' },
            { value: 'llm', label: '模型评估笔记质量' },
            { value: 'none', label: '跳过评论笔记，只取字幕' },
          ]}
        />
      </label>
      <p className="nook-muted">选卡用于筛选学习资料，不代表已经核实与视频完全一致。YouTube 当前只获取字幕。</p>
      <label style={{ display: 'flex', gap: 6, marginTop: 16 }}>
        <Switch checked={write} disabled={busy || running} onCheckedChange={nextWrite => setWrite(nextWrite)} />
        同时生成 AI 整理文稿
      </label>
      {write && (
        <label>
          写作方式
          <Select
            value={skill}
            disabled={busy || running}
            onValueChange={value => setSkill(value)}
            options={[...skills.map(item => ({ value: item.id, label: item.name }))]}
          />
        </label>
      )}
      {(write || strategy === 'llm') && (
        <label>
          使用 DSH 模型
          <Select
            value={modelKey}
            disabled={busy || running}
            onValueChange={value => setModelKey(value)}
            options={[...models.map(item => ({ value: JSON.stringify([item.provider, item.id]), label: item.name }))]}
          />
          {!models.length && <span className="nook-muted">请先在 DSH 设置中配置模型。</span>}
        </label>
      )}
      {job && (
        <div className="nook-video-progress">
          <strong role="status">{job.stage}</strong>
          <p className="nook-muted">更新于 {new Date(job.updatedAt).toLocaleTimeString('zh-CN')}</p>
          {job.warnings.map((warning, i) => (
            <p className="nook-muted" key={i}>
              {warning}
            </p>
          ))}
          {job.error && (
            <p role="alert" className="nook-error">
              {job.error}
            </p>
          )}
          <div className="nook-actions">
            {job.noteIds.map((id, i) => (
              <Button key={id} onClick={() => openNote(id)}>
                打开已保存资料 {i + 1} <ExternalLink size={14} aria-hidden="true" />
              </Button>
            ))}
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="nook-error">
          {error}
        </p>
      )}
      <div className="nook-actions">
        {running ? (
          <Button
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void api('cancelVideo', { id: job.id })
                .catch(cause => setError(String(cause)))
                .finally(() => setBusy(false))
            }}
          >
            取消处理
          </Button>
        ) : (
          <Button
            variant="accent"
            disabled={busy || !url.trim() || ((write || strategy === 'llm') && !modelKey)}
            onClick={() => void start()}
          >
            {busy ? '正在提交…' : '开始处理'}
          </Button>
        )}
      </div>
    </Dialog>
  )
}
