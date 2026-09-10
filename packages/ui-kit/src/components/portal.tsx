import { createContext, type ReactNode } from 'react'

/**
 * Kit floating parts (Dialog, Menu) portal into this element when rendered
 * without an explicit container, keeping them descendants of the consumer's
 * overlay shell.
 */
export const PortalContainerContext = createContext<HTMLElement | null>(null)

export function DialogPortalContainer({ value, children }: { value: HTMLElement | null; children: ReactNode }) {
  return <PortalContainerContext.Provider value={value}>{children}</PortalContainerContext.Provider>
}
