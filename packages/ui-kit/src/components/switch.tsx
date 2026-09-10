import { Switch as BaseSwitch } from '@base-ui-components/react/switch'
import { useId, type ReactNode } from 'react'

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  title,
  label,
  children,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  title?: string
  label?: string
  children?: ReactNode
}) {
  const labelId = useId()
  return (
    <label className="nui-switch-label">
      <BaseSwitch.Root
        className="nui-switch"
        aria-labelledby={label === undefined && children !== undefined ? labelId : undefined}
        checked={checked}
        onCheckedChange={onCheckedChange}
        {...(disabled ? { disabled: true } : {})}
        {...(title === undefined ? {} : { title })}
        {...(label === undefined ? {} : { 'aria-label': label })}
      >
        <BaseSwitch.Thumb className="nui-switch-thumb" />
      </BaseSwitch.Root>
      {children === undefined ? null : <span id={labelId}>{children}</span>}
    </label>
  )
}
