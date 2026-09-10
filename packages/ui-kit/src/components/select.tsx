import { Select as BaseSelect } from '@base-ui-components/react/select'
import { Combobox } from '@base-ui-components/react/combobox'
import { useContext, type ButtonHTMLAttributes } from 'react'
import { PortalContainerContext } from './portal.js'

export type SelectOption = { value: string; label: string; disabled?: boolean }
export type SelectProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'value' | 'onChange' | 'children'> & {
  value: string
  options: readonly SelectOption[]
  onValueChange: (value: string) => void
  placeholder?: string
  searchable?: boolean
  variant?: 'default' | 'ghost'
}

const chevron = (
  <svg
    className="nui-select-icon"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    aria-hidden="true"
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
)

export function Select({
  value,
  options,
  onValueChange,
  className,
  variant = 'default',
  style = {},
  disabled = false,
  name,
  placeholder = '请选择',
  searchable = options.length > 7,
  ...triggerProps
}: SelectProps) {
  const container = useContext(PortalContainerContext)
  const portalProps = container === null ? {} : { container }
  const triggerClass = ['nui-select', variant === 'ghost' && 'nui-select--ghost', className].filter(Boolean).join(' ')
  if (searchable) {
    const selected = options.find(option => option.value === value) ?? null
    return (
      <Combobox.Root
        items={options}
        value={selected}
        disabled={disabled}
        {...(name === undefined ? {} : { name })}
        isItemEqualToValue={(a, b) => a?.value === b?.value}
        onValueChange={next => {
          if (next !== null) onValueChange(next.value)
        }}
      >
        <Combobox.Trigger {...triggerProps} style={style} className={triggerClass}>
          <span className="nui-select-value">{selected?.label ?? placeholder}</span>
          {chevron}
        </Combobox.Trigger>
        <Combobox.Portal {...portalProps}>
          <Combobox.Positioner
            side="bottom"
            align="start"
            sideOffset={4}
            collisionPadding={8}
            className="nui-select-positioner"
          >
            <Combobox.Popup className="nui-select-popup">
              <Combobox.Input className="nui-input nui-select-search" aria-label="搜索选项" placeholder="搜索…" />
              <Combobox.Empty className="nui-select-empty">没有匹配的选项</Combobox.Empty>
              <Combobox.List className="nui-select-list">
                {(option: SelectOption) => (
                  <Combobox.Item
                    key={option.value}
                    value={option}
                    disabled={option.disabled ?? false}
                    className="nui-select-item"
                  >
                    {option.label}
                    <Combobox.ItemIndicator className="nui-select-check">✓</Combobox.ItemIndicator>
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
    )
  }
  return (
    <BaseSelect.Root
      items={options}
      value={value}
      disabled={disabled}
      {...(name === undefined ? {} : { name })}
      onValueChange={next => {
        if (next !== null) onValueChange(next)
      }}
    >
      <BaseSelect.Trigger {...triggerProps} style={style} className={triggerClass}>
        <BaseSelect.Value className="nui-select-value">
          {options.find(option => option.value === value)?.label ?? placeholder}
        </BaseSelect.Value>
        {chevron}
      </BaseSelect.Trigger>
      <BaseSelect.Portal {...portalProps}>
        <BaseSelect.Positioner
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          alignItemWithTrigger={false}
          className="nui-select-positioner"
        >
          <BaseSelect.Popup className="nui-select-popup">
            <BaseSelect.List className="nui-select-list">
              {options.map(option => (
                <BaseSelect.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled ?? false}
                  className="nui-select-item"
                >
                  <BaseSelect.ItemText>{option.label}</BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator className="nui-select-check">✓</BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
              {!options.length && <div className="nui-select-empty">暂无可选项</div>}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  )
}
