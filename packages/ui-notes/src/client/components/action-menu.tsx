import { useLayoutEffect, useRef } from 'react'

export interface MenuAction {
  label: string
  run: () => void
  danger?: boolean
  disabled?: boolean
}
export interface MenuPosition {
  x: number
  y: number
}

export function ActionMenu({
  position,
  actions,
  close,
}: {
  position: MenuPosition
  actions: MenuAction[]
  close: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const menu = ref.current!
    const previous = document.activeElement as HTMLElement | null
    const bounds = menu.getBoundingClientRect()
    menu.style.left = `${Math.max(8, Math.min(position.x, window.innerWidth - bounds.width - 8))}px`
    menu.style.top = `${Math.max(8, Math.min(position.y, window.innerHeight - bounds.height - 8))}px`
    menu.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
    const outside = (event: Event) => {
      if (!menu.contains(event.target as Node)) close()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('scroll', outside, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('scroll', outside, true)
      window.removeEventListener('resize', close)
      if (menu.contains(document.activeElement) || document.activeElement === document.body) previous?.focus()
    }
  }, [])
  return (
    <div
      ref={ref}
      className="nook-action-menu"
      role="menu"
      style={{ left: position.x, top: position.y }}
      onKeyDown={event => {
        event.stopPropagation()
        if (event.key === 'Escape' || event.key === 'Tab') {
          event.preventDefault()
          close()
        }
        const items = Array.from(ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
        const index = items.indexOf(document.activeElement as HTMLButtonElement)
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault()
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? items.length - 1
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
          items[next]?.focus()
        }
      }}
    >
      {actions.map(action => (
        <button
          key={action.label}
          role="menuitem"
          disabled={action.disabled}
          className={action.danger ? 'nook-danger' : ''}
          onClick={() => {
            close()
            action.run()
          }}
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}
