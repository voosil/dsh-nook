import { useEffect, useState } from 'react'
import { Button, Input, Textarea, Select, Dialog } from '@nook-dsh/ui-kit'
import { taskInputSchema, emptyTiming, type Task, type TaskInput, type TaskSnapshot } from '@nook-dsh/capability-task'
import type { Api } from '../lib/api.js'
import { localInput } from '../lib/time.js'
export function taskInput(task: Task): TaskInput {
  return taskInputSchema.parse(
    Object.fromEntries(Object.keys(taskInputSchema.shape).map(key => [key, task[key as keyof Task]])),
  )
}
export function TaskEditor({
  task,
  snapshot,
  api,
  save,
  close,
}: {
  task?: Task
  snapshot: TaskSnapshot
  api: Api
  save: (input: TaskInput) => Promise<void>
  close: () => void
}) {
  const [value, setValue] = useState<TaskInput>(() =>
      task
        ? taskInput(task)
        : taskInputSchema.parse({
            title: '新任务',
            timing: emptyTiming(Intl.DateTimeFormat().resolvedOptions().timeZone),
          }),
    ),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [projects, setProjects] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    const controller = new AbortController()
    void api('sources', {}, controller.signal)
      .then(value => setProjects(value.projects))
      .catch(() => {})
    return () => controller.abort()
  }, [api])
  const field = (key: keyof TaskInput, label: string, multiline = false) => (
    <label>
      {label}
      {multiline ? (
        <Textarea value={String(value[key])} onChange={e => setValue({ ...value, [key]: e.target.value })} />
      ) : (
        <Input value={String(value[key])} onChange={e => setValue({ ...value, [key]: e.target.value })} />
      )}
    </label>
  )
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) close()
      }}
      title={task ? '编辑任务' : '新建任务'}
      className="nt-dialog"
    >
      <header>
        <h2>{task ? '编辑任务' : '写下要做的事'}</h2>
        <Button onClick={close}>关闭</Button>
      </header>
      <form
        onSubmit={e => {
          e.preventDefault()
          setBusy(true)
          setError('')
          try {
            const input = taskInputSchema.parse(value)
            void save(input)
              .then(close)
              .catch(error => setError(String(error.message)))
              .finally(() => setBusy(false))
          } catch {
            setError('请检查任务内容与时间安排')
            setBusy(false)
          }
        }}
      >
        {field('title', '任务名称')}
        {field('description', '希望完成什么', true)}
        <div className="nt-columns">
          <label>
            由谁完成
            <Select
              value={value.assignee}
              options={[
                { value: 'human', label: '我来完成' },
                { value: 'agent', label: '交给 Agent' },
                { value: 'unassigned', label: '暂不安排' },
              ]}
              onValueChange={v => setValue({ ...value, assignee: v as TaskInput['assignee'] })}
            />
          </label>
          <label>
            项目
            <Select
              value={value.projectId ?? ''}
              options={[
                { value: '', label: '未分类' },
                ...projects.map(project => ({ value: project.id, label: project.name })),
              ]}
              onValueChange={v => setValue({ ...value, projectId: v || null })}
            />
          </label>
        </div>
        {value.assignee === 'agent' && (
          <>
            <div className="nt-columns">
              <label>
                执行方式
                <Select
                  value={value.executor}
                  options={[
                    { value: 'dsh', label: 'Nook 自动执行' },
                    { value: 'external', label: '由外部 Agent 领取' },
                  ]}
                  onValueChange={v => setValue({ ...value, executor: v as TaskInput['executor'] })}
                />
              </label>
              <label>
                执行角色
                <Select
                  value={value.route}
                  options={Array.from(new Set(['execution', ...Object.keys(snapshot.settings.routes)])).map(key => ({
                    value: key,
                    label: key,
                  }))}
                  onValueChange={v => setValue({ ...value, route: v ?? 'execution' })}
                />
              </label>
            </div>
            {field('scope', '范围', true)}
            {field('constraints', '约束', true)}
            {field('acceptance', '怎样算完成', true)}
            <label>
              执行工作目录
              <Select
                value={value.workspace}
                options={[
                  { value: '', label: '后台默认目录' },
                  ...Object.keys(snapshot.settings.workspaces).map(key => ({ value: key, label: key })),
                ]}
                onValueChange={v => setValue({ ...value, workspace: v ?? '' })}
              />
            </label>
            <label className="nt-check">
              <input
                type="checkbox"
                checked={value.writes}
                onChange={e => setValue({ ...value, writes: e.target.checked })}
              />
              需要写入工作目录
            </label>
            <label className="nt-check">
              <input
                type="checkbox"
                checked={value.aiReview}
                onChange={e => setValue({ ...value, aiReview: e.target.checked })}
              />
              AI 验收通过后自动完成
            </label>
            <label>
              验收角色
              <Select
                value={value.reviewRoute}
                options={Array.from(new Set(['review', ...Object.keys(snapshot.settings.routes)])).map(key => ({
                  value: key,
                  label: key,
                }))}
                onValueChange={v => setValue({ ...value, reviewRoute: v ?? 'review' })}
              />
            </label>
          </>
        )}
        <details>
          <summary>计划与依赖</summary>
          <label>
            组织方式
            <Select
              value={value.kind}
              options={[
                { value: 'task', label: '独立任务或子任务' },
                { value: 'plan', label: '包含子任务的计划' },
              ]}
              onValueChange={kind =>
                setValue({
                  ...value,
                  kind: kind as TaskInput['kind'],
                  parentId: kind === 'plan' ? null : value.parentId,
                })
              }
            />
          </label>
          {value.kind === 'task' && (
            <label>
              所属计划
              <Select
                value={value.parentId ?? ''}
                options={[
                  { value: '', label: '独立任务' },
                  ...snapshot.tasks
                    .filter(
                      p => p.kind === 'plan' && p.id !== task?.id && p.status !== 'done' && p.status !== 'cancelled',
                    )
                    .map(p => ({ value: p.id, label: p.title })),
                ]}
                onValueChange={parentId => setValue({ ...value, parentId: parentId || null })}
              />
            </label>
          )}
          <p className="nt-muted">依赖任务的产物通过技术检查后，Agent 才能开始本任务。</p>
          {snapshot.tasks
            .filter(
              t => t.id !== task?.id && t.id !== value.parentId && t.parentId !== task?.id && t.status !== 'cancelled',
            )
            .map(dependency => (
              <label className="nt-check" key={dependency.id}>
                <input
                  type="checkbox"
                  checked={value.dependencies.includes(dependency.id)}
                  onChange={e =>
                    setValue({
                      ...value,
                      dependencies: e.target.checked
                        ? [...value.dependencies, dependency.id]
                        : value.dependencies.filter(id => id !== dependency.id),
                    })
                  }
                />
                {dependency.title}
              </label>
            ))}
        </details>
        <details>
          <summary>时间与重复安排</summary>
          <p className="nt-muted">时间输入使用这台设备的本地时间，保存为明确时刻。重复安排按下方时区计算。</p>
          <div className="nt-columns">
            {(
              [
                ['remindAt', '提醒我'],
                ['startAt', '开始时间'],
                ['dueAt', '截止时间'],
                ['endAt', '结束时间'],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <Input
                  type="datetime-local"
                  value={localInput(value.timing[key])}
                  onChange={e =>
                    setValue({
                      ...value,
                      timing: {
                        ...value.timing,
                        [key]: e.target.value ? new Date(e.target.value).toISOString() : null,
                      },
                    })
                  }
                />
              </label>
            ))}
          </div>
          <label>
            还没确定的时间
            <Input
              placeholder="例如：下周找一个上午"
              value={value.timing.vague}
              onChange={e => setValue({ ...value, timing: { ...value.timing, vague: e.target.value } })}
            />
          </label>
          <label>
            时区
            <Input
              value={value.timing.timeZone}
              onChange={e => setValue({ ...value, timing: { ...value.timing, timeZone: e.target.value } })}
            />
          </label>
          <label>
            重复
            <Select
              value={value.timing.repeat}
              options={[
                { value: 'none', label: '不重复' },
                { value: 'daily', label: '每天' },
                { value: 'weekly', label: '每周' },
              ]}
              onValueChange={v =>
                setValue({ ...value, timing: { ...value.timing, repeat: v as TaskInput['timing']['repeat'] } })
              }
            />
          </label>
          {value.timing.repeat === 'weekly' && (
            <div className="nt-weekdays">
              {'日一二三四五六'.split('').map((day, i) => (
                <label key={day}>
                  <input
                    type="checkbox"
                    checked={value.timing.weekdays.includes(i)}
                    onChange={e =>
                      setValue({
                        ...value,
                        timing: {
                          ...value.timing,
                          weekdays: e.target.checked
                            ? [...value.timing.weekdays, i]
                            : value.timing.weekdays.filter(d => d !== i),
                        },
                      })
                    }
                  />
                  {day}
                </label>
              ))}
            </div>
          )}
        </details>
        {error && <p role="alert">{error}</p>}
        <footer>
          <Button type="submit" variant="accent" disabled={busy}>
            {busy ? '保存中…' : value.assignee === 'agent' ? '保存并安排' : '保存任务'}
          </Button>
          <Button onClick={close} type="button">
            取消
          </Button>
        </footer>
      </form>
    </Dialog>
  )
}
