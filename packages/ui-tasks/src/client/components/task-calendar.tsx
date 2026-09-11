import { latestOccurrence, occurrenceTiming } from '@nook-dsh/capability-task/time'
import { useState } from 'react'
import { Button } from '@nook-dsh/ui-kit'
import type { Task } from '@nook-dsh/capability-task'
import { dateKey, displayTime } from '../lib/time.js'
export function TaskCalendar({
  tasks,
  open,
  schedule,
}: {
  tasks: Task[]
  open: (task: Task) => void
  schedule: (id: string, day: string | null) => void
}) {
  const [anchor, setAnchor] = useState(() => new Date()),
    [mode, setMode] = useState<'week' | 'month' | 'agenda'>('week')
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), mode === 'month' ? 1 : anchor.getDate())
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  const count = mode === 'month' ? 42 : 7,
    days = Array.from({ length: count }, (_, i) => {
      const d = new Date(start)
      d.setDate(d.getDate() + i)
      return d
    })
  const unscheduled = tasks.filter(t => !t.timing.startAt && !t.timing.remindAt && !t.timing.dueAt)
  const projected = tasks.filter(task => task.timing.repeat === 'none')
  for (const template of tasks.filter(task => task.timing.repeat !== 'none'))
    for (const day of days) {
      const end = new Date(day)
      end.setHours(23, 59, 59, 999)
      const at = latestOccurrence(template, end.getTime())
      if (
        !at ||
        dateKey(new Date(at)) !== dateKey(day) ||
        (template.seriesChangedAt && at < template.seriesChangedAt) ||
        tasks.some(task => task.seriesId === template.id && task.occurrenceAt === at)
      )
        continue
      projected.push({ ...template, timing: occurrenceTiming(template.timing, at) })
    }
  return (
    <>
      <header>
        <h2>
          {anchor.getFullYear()} 年 {anchor.getMonth() + 1} 月
        </h2>
        <div className="nt-actions">
          <Button onClick={() => setAnchor(new Date())}>今天</Button>
          <Button
            aria-label="上一段日期"
            onClick={() => {
              const d = new Date(anchor)
              mode === 'month' ? d.setMonth(d.getMonth() - 1) : d.setDate(d.getDate() - 7)
              setAnchor(d)
            }}
          >
            ←
          </Button>
          <Button
            aria-label="下一段日期"
            onClick={() => {
              const d = new Date(anchor)
              mode === 'month' ? d.setMonth(d.getMonth() + 1) : d.setDate(d.getDate() + 7)
              setAnchor(d)
            }}
          >
            →
          </Button>
          {(['week', 'month', 'agenda'] as const).map(v => (
            <Button key={v} aria-pressed={mode === v} onClick={() => setMode(v)}>
              {v === 'week' ? '周' : v === 'month' ? '月' : '日程'}
            </Button>
          ))}
        </div>
      </header>
      <div className="nt-calendar-layout">
        <div className={'nt-calendar nt-calendar-' + mode}>
          {days.map(day => {
            const key = dateKey(day)
            return (
              <section
                key={key}
                className="nt-day"
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault()
                  schedule(e.dataTransfer.getData('text/nook-task'), key)
                }}
              >
                <h3>
                  {day.getMonth() + 1}/{day.getDate()} <small>{'日一二三四五六'[day.getDay()]}</small>
                </h3>
                {projected
                  .filter(t =>
                    [t.timing.startAt, t.timing.remindAt, t.timing.dueAt].some(
                      at => at && dateKey(new Date(at)) === key,
                    ),
                  )
                  .map(task => (
                    <button
                      className="nt-calendar-item"
                      key={task.id}
                      draggable
                      onDragStart={e => e.dataTransfer.setData('text/nook-task', task.id)}
                      onClick={() => open(task)}
                    >
                      <strong>{task.title}</strong>
                      {(
                        [
                          ['startAt', '开始'],
                          ['remindAt', '提醒'],
                          ['dueAt', '截止'],
                        ] as const
                      ).map(([field, label]) =>
                        task.timing[field] && dateKey(new Date(task.timing[field]!)) === key ? (
                          <small key={field}>
                            {label} {displayTime(task.timing[field])}
                          </small>
                        ) : null,
                      )}
                    </button>
                  ))}
              </section>
            )
          })}
        </div>
        <aside
          className="nt-unscheduled"
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault()
            schedule(e.dataTransfer.getData('text/nook-task'), null)
          }}
        >
          <h3>未排期</h3>
          <p className="nt-muted">拖到日期安排开始时间；拖回这里移除时间安排。</p>
          {unscheduled.map(task => (
            <button
              key={task.id}
              className="nt-calendar-item"
              draggable
              onDragStart={e => e.dataTransfer.setData('text/nook-task', task.id)}
              onClick={() => open(task)}
            >
              {task.title}
            </button>
          ))}
        </aside>
      </div>
    </>
  )
}
