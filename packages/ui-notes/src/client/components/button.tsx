import type { ReactNode } from 'react'

export function Button({
  children,
  onClick,
  active,
  disabled,
  title,
}: {
  children: ReactNode
  onClick: () => void
  active?: boolean
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      aria-label={title}
      title={title}
      className={active ? 'active' : ''}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}
