import type { ReactNode } from 'react'

export function Chip({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={className ? `nui-chip ${className}` : 'nui-chip'}>
      {children}
    </span>
  )
}
