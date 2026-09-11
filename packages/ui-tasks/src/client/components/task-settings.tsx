import { useEffect, useState } from 'react'
import { Button, Input, Select, Textarea, Dialog } from '@nook-dsh/ui-kit'
import type { TaskSnapshot, TaskSettings } from '@nook-dsh/capability-task'
import type { Api } from '../lib/api.js'
export function TaskSettingsPanel({
  snapshot,
  api,
  close,
  save,
}: {
  snapshot: TaskSnapshot
  api: Api
  close: () => void
  save: (settings: TaskSettings) => Promise<void>
}) {
  const [value, setValue] = useState(snapshot.settings),
    [models, setModels] = useState<{ provider: string; id: string; name: string }[]>([]),
    [error, setError] = useState(''),
    [special, setSpecial] = useState(''),
    [sources, setSources] = useState<{
      notes: { id: string; title: string }[]
      projects: { id: string; name: string }[]
    }>({ notes: [], projects: [] }),
    [workspace, setWorkspace] = useState(''),
    [path, setPath] = useState('')
  useEffect(() => {
    const abort = new AbortController()
    void api('models', {}, abort.signal)
      .then(setModels)
      .catch(() => {})
    void api('sources', {}, abort.signal)
      .then(setSources)
      .catch(() => {})
    return () => abort.abort()
  }, [api])
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) close()
      }}
      title="任务设置"
      className="nt-dialog"
    >
      <header>
        <h2>任务设置</h2>
        <Button onClick={close}>关闭</Button>
      </header>
      <p>
        {snapshot.isOwner
          ? '这台设备负责后台执行'
          : value.ownerId
            ? '由指定主机执行，修改通过同步传递'
            : '先指定一台设备承担后台执行'}
      </p>
      {!value.ownerId && (
        <Button onClick={() => setValue({ ...value, ownerId: snapshot.deviceId, keepAlive: true })}>
          使用这台设备执行
        </Button>
      )}
      <label className="nt-check">
        <input
          type="checkbox"
          checked={value.keepAlive}
          onChange={e => setValue({ ...value, keepAlive: e.target.checked })}
        />
        保持后台运行（关闭窗口后继续）
      </label>
      <label>
        同时运行的 Agent 数量
        <Input
          type="number"
          min={1}
          max={16}
          value={value.concurrency}
          onChange={e => setValue({ ...value, concurrency: Number(e.target.value) })}
        />
      </label>
      <h3>模型角色</h3>
      {Array.from(new Set(['planning', 'execution', 'review', ...Object.keys(value.routes)])).map(key => (
        <label key={key}>
          {({ planning: '规划与理解', execution: '执行', review: '产品验收' } as Record<string, string>)[key] ?? key}
          <Select
            value={value.routes[key] ? value.routes[key]!.provider + '\t' + value.routes[key]!.model : ''}
            options={[
              { value: '', label: '选择模型' },
              ...models.map(m => ({ value: m.provider + '\t' + m.id, label: m.name })),
            ]}
            onValueChange={v => {
              const routes = { ...value.routes }
              if (v) {
                const [provider, model] = v.split('\t')
                routes[key] = { provider: provider!, model: model! }
              } else delete routes[key]
              setValue({ ...value, routes })
            }}
          />
        </label>
      ))}
      <div className="nt-actions">
        <Input
          aria-label="专项角色名称"
          placeholder="例如 frontend-planning"
          value={special}
          onChange={e => setSpecial(e.target.value)}
        />
        <Button
          onClick={() => {
            if (special.trim() && value.routes.planning) {
              setValue({ ...value, routes: { ...value.routes, [special.trim()]: value.routes.planning } })
              setSpecial('')
            }
          }}
        >
          添加专项角色
        </Button>
      </div>
      <h3>工作目录</h3>
      {Object.entries(value.workspaces).map(([key, path]) => (
        <p key={key}>
          {key} · {path}
        </p>
      ))}
      <div className="nt-actions">
        <Input
          placeholder="名称"
          aria-label="工作目录名称"
          value={workspace}
          onChange={e => setWorkspace(e.target.value)}
        />
        <Input
          placeholder="执行主机上的绝对路径"
          aria-label="工作目录路径"
          value={path}
          onChange={e => setPath(e.target.value)}
        />
        <Button
          onClick={() => {
            if (workspace && path) {
              setValue({ ...value, workspaces: { ...value.workspaces, [workspace]: path } })
              setWorkspace('')
              setPath('')
            }
          }}
        >
          添加
        </Button>
      </div>
      <h3>自动整理来源</h3>
      <fieldset>
        <legend>笔记</legend>
        {sources.notes.map(note => (
          <label className="nt-check" key={note.id}>
            <input
              type="checkbox"
              checked={value.watchNotes.includes(note.id)}
              onChange={e =>
                setValue({
                  ...value,
                  watchNotes: e.target.checked
                    ? [...value.watchNotes, note.id]
                    : value.watchNotes.filter(id => id !== note.id),
                })
              }
            />
            {note.title}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>项目</legend>
        {sources.projects.map(project => (
          <label className="nt-check" key={project.id}>
            <input
              type="checkbox"
              checked={value.watchProjects.includes(project.id)}
              onChange={e =>
                setValue({
                  ...value,
                  watchProjects: e.target.checked
                    ? [...value.watchProjects, project.id]
                    : value.watchProjects.filter(id => id !== project.id),
                })
              }
            />
            {project.name}
          </label>
        ))}
      </fieldset>
      <p className="nt-muted">仅这些来源进入后台理解。已有笔记不会被自动改写。</p>
      {error && <p role="alert">{error}</p>}
      <footer>
        <Button
          variant="accent"
          onClick={() => {
            void save(value)
              .then(close)
              .catch(e => setError(e.message))
          }}
        >
          保存设置
        </Button>
      </footer>
    </Dialog>
  )
}
