import { useEffect, useRef, useState } from 'react'
import type { UpdateStatus } from '@nook-dsh/capability-update'
import type { UpdateApi } from '../lib/update-api.js'

export function useUpdate(api: UpdateApi | undefined, beforeUpdate: () => Promise<void>) {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const running = useRef(false),
    current = useRef<string | null>(null)
  const prepare = useRef(beforeUpdate)
  prepare.current = beforeUpdate
  const lifetime = useRef<AbortController | null>(null)
  async function run(command: 'check' | 'start') {
    const signal = lifetime.current?.signal
    if (!api || !signal || signal.aborted || running.current) return
    running.current = true
    setBusy(true)
    setError('')
    try {
      if (command === 'start') await prepare.current()
      const next = await api(command, {}, signal)
      if (signal.aborted) return
      setStatus(next)
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : '更新操作失败。')
    } finally {
      running.current = false
      if (!signal.aborted) setBusy(false)
    }
  }
  useEffect(() => {
    if (!api) return
    const controller = new AbortController()
    lifetime.current = controller
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const next = await api('status', {}, controller.signal)
        if (controller.signal.aborted) return
        setStatus(next)
        if (current.current === null) current.current = next.current
        else if (next.current && next.current !== current.current) {
          await prepare.current()
          window.location.reload()
          return
        }
      } catch {
        /* The existing authenticated connection reconnects after restart. */
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 2000)
      }
    }
    void poll()
    return () => {
      controller.abort()
      clearTimeout(timer)
      lifetime.current = null
    }
  }, [api])
  return { status, error, busy, run }
}
export type UpdateController = ReturnType<typeof useUpdate>
