import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { Api } from './index.js'
import type { Value } from '@nook-dsh/adapter-knowledge-dsh/rpc'
import { Button, Select, Switch, uiKitStyles } from '@nook-dsh/ui-kit'

const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }

export function KnowledgeToggle({
  sessionId,
  api,
}: PropsRuntime<'conversation.session.header.actions'> & { api: Api }) {
  const [selection, setSelection] = useState<Value<'knowledgeSession'> | null>(null)
  const [projects, setProjects] = useState<Value<'projects'>>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lifetime = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    setSelection(null)
    setError('')
    setBusy(false)
    void Promise.all([
      api('knowledgeSession', { sessionId }, controller.signal),
      api('projects', {}, controller.signal),
    ])
      .then(([value, projects]) => {
        if (!controller.signal.aborted) {
          setSelection(value)
          setProjects(projects)
        }
      })
      .catch(cause => {
        if (!controller.signal.aborted) setError(String(cause))
      })
    return () => controller.abort()
  }, [sessionId])
  async function change(value: Value<'knowledgeSession'>) {
    const signal = lifetime.current?.signal
    if (!signal || signal.aborted) return
    setBusy(true)
    setError('')
    try {
      const saved = await api('setKnowledgeSession', { sessionId, ...value }, signal)
      if (!signal.aborted) setSelection(saved)
    } catch (cause) {
      if (!signal.aborted) setError(String(cause))
    } finally {
      if (!signal.aborted) setBusy(false)
    }
  }
  return (
    <div style={rowStyle}>
      <style>{uiKitStyles}</style>
      <Switch
        title="开启后，每次发送问题都会检索笔记并提供引用"
        label="使用 Nook 知识库"
        checked={selection?.enabled ?? false}
        disabled={!selection || busy}
        onCheckedChange={checked => void change({ enabled: checked, projectId: selection?.projectId ?? null })}
      >
        知识库{busy ? '…' : ''}
      </Switch>
      {selection?.enabled && (
        <Select
          aria-label="知识库检索项目"
          style={{ maxWidth: 140 }}
          value={selection.projectId ?? ''}
          disabled={busy}
          onValueChange={value => void change({ enabled: true, projectId: value || null })}
          options={[
            { value: '', label: '全部项目' },
            ...projects.map(project => ({ value: project.id, label: project.name })),
          ]}
        />
      )}
      {error && (
        <span role="alert" title={error}>
          设置失败 <Button onClick={() => void change(selection ?? { enabled: false, projectId: null })}>重试</Button>
        </span>
      )}
    </div>
  )
}
