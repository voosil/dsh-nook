import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { UpdatePhase, UpdateStatus } from '@nook-dsh/capability-update'
import { useAppearance } from '../hooks/use-appearance.js'

const stageProgress: Partial<Record<UpdatePhase, number>> = {
  preparing: 40,
  switching: 80,
  succeeded: 100,
}

/**
 * Opaque full-app loading layer for a running update. It latches on the first
 * preparing/switching sighting so a stale `succeeded` status left in the broker
 * never blocks an unrelated later session, and stays up through the reload.
 */
export function UpdateOverlay({ status }: { status: UpdateStatus | null }) {
  const [appearance] = useAppearance()
  const [active, setActive] = useState(false)
  const overlay = useRef<HTMLDivElement | null>(null)
  const phase = status?.phase
  useEffect(() => {
    if (phase === 'preparing' || phase === 'switching') setActive(true)
    else if (phase && phase !== 'succeeded') setActive(false)
  }, [phase])
  useEffect(() => {
    if (active) overlay.current?.focus({ preventScroll: true })
  }, [active])
  if (!active || !status) return null
  const progress = stageProgress[status.phase]
  if (progress === undefined) return null
  return createPortal(
    <div
      ref={overlay}
      className="nook-update-overlay"
      data-nook-theme={appearance}
      role="dialog"
      aria-modal="true"
      aria-label="正在更新应用"
      tabIndex={-1}
      onKeyDown={event => {
        // The update ends in a page reload; keep focus pinned here so no
        // background control reacts while the interface is covered.
        if (event.key === 'Tab') event.preventDefault()
      }}
    >
      <div className="nook-update-loading">
        <div
          className="nook-update-bar"
          role="progressbar"
          aria-label="更新进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <div
            className="nook-update-bar-fill"
            data-working={status.phase !== 'succeeded' || undefined}
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="nook-update-stage" role="status">
          {status.phase === 'succeeded' ? '更新完成，正在重启应用…' : status.message}
        </p>
      </div>
    </div>,
    document.body,
  )
}
