import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

export const inject = ['slots']

type SidebarProps = PropsRuntime<'sidebar.footer.action'>

const ROOT_STYLE: CSSProperties = {
  position: 'relative',
  display: 'flex',
  width: '100%',
}

const POPOVER_STYLE: CSSProperties = {
  position: 'absolute',
  left: 4,
  bottom: 42,
  zIndex: 120,
  boxSizing: 'border-box',
  width: 220,
  padding: '12px 14px 14px',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 12,
  background: 'var(--dsw-specific-menu)',
  color: 'var(--dsw-alias-label-primary)',
  boxShadow: 'var(--dsw-shadow-lv3)',
}

function NookSidebarAction({ wide }: SidebarProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(false)
  const [hovered, setHovered] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const buttonStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: wide ? 'flex-start' : 'center',
    gap: 9,
    width: wide ? '100%' : 36,
    height: 36,
    padding: wide ? '0 10px' : 0,
    border: 0,
    borderRadius: 10,
    background: hovered || open ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
    color: 'var(--dsw-alias-label-primary)',
    font: 'inherit',
    fontSize: 13,
    fontWeight: 500,
    lineHeight: '20px',
    cursor: 'pointer',
    touchAction: 'manipulation',
    transform: active ? 'scale(0.96)' : 'scale(1)',
    transition: 'transform 120ms cubic-bezier(0.16, 1, 0.3, 1)',
  }

  return (
    <div ref={root} style={ROOT_STYLE}>
      <button
        type="button"
        aria-label="About Nook"
        aria-expanded={open}
        style={buttonStyle}
        onClick={() => setOpen(value => !value)}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => {
          setHovered(false)
          setActive(false)
        }}
        onPointerDown={() => setActive(true)}
        onPointerUp={() => setActive(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
      >
        <span
          aria-hidden="true"
          style={{
            width: 14,
            height: 14,
            borderRadius: 4,
            background: 'oklch(70% 0.13 55)',
            boxShadow: 'inset 0 0 0 1px oklch(48% 0.08 55 / 35%)',
          }}
        />
        {wide && <span>Nook</span>}
      </button>
      {open && (
        <div role="status" style={POPOVER_STYLE}>
          <div style={{ fontSize: 13, fontWeight: 600, lineHeight: '20px', letterSpacing: '-0.01em' }}>
            Nook project space
          </div>
          <div
            style={{
              marginTop: 4,
              color: 'var(--dsw-alias-label-secondary)',
              fontSize: 12,
              lineHeight: '18px',
              textWrap: 'pretty',
            }}
          >
            Ask the agent to create projects or capture a browser preview. Nook stores both under this isolated profile.
          </div>
        </div>
      )}
    </div>
  )
}

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register(
      {
        name: 'sidebar.footer.action',
        id: 'nook',
        order: -20,
      },
      NookSidebarAction,
    ),
  )
}
