import { NotebookPen } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
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

function NookSidebarAction({ wide }: SidebarProps) {
  const [active, setActive] = useState(false)
  const [hovered, setHovered] = useState(false)

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
    background: hovered ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
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
    <div style={ROOT_STYLE}>
      <button
        type="button"
        aria-label="打开 Nook"
        style={buttonStyle}
        onClick={() => {
          window.location.hash = 'nook'
        }}
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
        <NotebookPen size={18} aria-hidden="true" style={{ flexShrink: 0, color: 'oklch(70% 0.13 55)' }} />
        {wide && <span>Nook</span>}
      </button>
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
