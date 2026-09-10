import { Tabs as BaseTabs } from '@base-ui-components/react/tabs'
import type { ReactNode } from 'react'

export type TabDef = { value: string; label: ReactNode }

export function Tabs({
  value,
  onValueChange,
  tabs,
  className,
  children,
}: {
  value: string
  onValueChange?: (value: string) => void
  tabs: readonly TabDef[]
  className?: string
  children?: ReactNode
}) {
  return (
    <BaseTabs.Root
      className="nui-tabs-root"
      value={value}
      onValueChange={next => {
        if (typeof next === 'string') onValueChange?.(next)
      }}
    >
      <BaseTabs.List className={className ? `nui-tabs ${className}` : 'nui-tabs'} activateOnFocus>
        {tabs.map(tab => (
          <BaseTabs.Tab key={tab.value} value={tab.value} className="nui-tab">
            {tab.label}
          </BaseTabs.Tab>
        ))}
      </BaseTabs.List>
      {children}
    </BaseTabs.Root>
  )
}

export const TabPanel = BaseTabs.Panel
