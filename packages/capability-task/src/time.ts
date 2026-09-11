import type { Task, Timing } from './index.js'

function parts(at: number, timeZone: string) {
  const result = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map(p => [p.type, p.value]),
  )
  return {
    day: `${result.year}-${result.month}-${result.day}`,
    time: `${result.hour}:${result.minute}:${result.second}`,
  }
}
/** Resolve wall time explicitly; gaps are skipped, overlaps choose the earlier instant. */
export function wallTime(day: string, time: string, zone: string): number | null {
  const naive = Date.parse(`${day}T${time}Z`)
  const offsets = new Set<number>()
  for (const delta of [-86_400_000, 0, 86_400_000]) {
    const at = naive + delta,
      p = parts(at, zone)
    offsets.add(Date.parse(`${p.day}T${p.time}Z`) - at)
  }
  const candidates = [...offsets]
    .map(offset => naive - offset)
    .filter(at => {
      const p = parts(at, zone)
      return p.day === day && p.time === time
    })
  return candidates.length ? Math.min(...candidates) : null
}
export function latestOccurrence(task: Task, now: number): string | null {
  const timing = task.timing,
    anchor = timing.startAt ?? timing.remindAt
  if (!anchor || timing.repeat === 'none' || Date.parse(anchor) > now) return null
  const a = parts(Date.parse(anchor), timing.timeZone),
    today = parts(now, timing.timeZone).day
  for (let back = 0; back < 15; back++) {
    const day = new Date(Date.parse(`${today}T12:00:00Z`) - back * 86_400_000).toISOString().slice(0, 10)
    if (day < a.day) return null
    if (timing.repeat === 'weekly' && !timing.weekdays.includes(new Date(`${day}T12:00:00Z`).getUTCDay())) continue
    const at = wallTime(day, a.time, timing.timeZone)
    if (at !== null && at <= now && at >= Date.parse(anchor)) return new Date(at).toISOString()
  }
  return null
}
export function occurrenceTiming(timing: Timing, at: string): Timing {
  const anchor = timing.startAt ?? timing.remindAt!
  const days = Math.round(
    (Date.parse(parts(Date.parse(at), timing.timeZone).day) -
      Date.parse(parts(Date.parse(anchor), timing.timeZone).day)) /
      86_400_000,
  )
  const shift = (value: string | null) => {
    if (!value) return null
    const p = parts(Date.parse(value), timing.timeZone)
    const day = new Date(Date.parse(`${p.day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
    const target = wallTime(day, p.time, timing.timeZone)
    return target === null ? null : new Date(target).toISOString()
  }
  return {
    ...timing,
    startAt: shift(timing.startAt),
    remindAt: shift(timing.remindAt),
    dueAt: shift(timing.dueAt),
    endAt: shift(timing.endAt),
    repeat: 'none',
    weekdays: [],
  }
}
