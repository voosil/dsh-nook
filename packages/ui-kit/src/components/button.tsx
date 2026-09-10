import { Button as BaseButton } from '@base-ui-components/react/button'
import type { ButtonHTMLAttributes, MouseEventHandler, ReactNode } from 'react'

export type ButtonVariant = 'default' | 'secondary' | 'ghost' | 'accent' | 'danger'

export function Button({
  variant = 'secondary',
  active,
  iconOnly,
  type = 'button',
  disabled = false,
  style = {},
  title,
  'aria-label': ariaLabel,
  onClick,
  className,
  children,
  ...rest
}: {
  variant?: ButtonVariant
  active?: boolean
  iconOnly?: boolean
  type?: 'button' | 'submit'
  disabled?: boolean
  title?: string
  'aria-label'?: string
  onClick?: MouseEventHandler<HTMLButtonElement>
  className?: string
  children: ReactNode
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'title' | 'onClick' | 'disabled' | 'className'>) {
  const classes = ['nui-btn']
  if (variant && variant !== 'default') classes.push(`nui-btn--${variant}`)
  if (active) classes.push('nui-btn--active')
  if (iconOnly) classes.push('nui-btn--icon')
  if (className) classes.push(className)
  return (
    <BaseButton
      {...rest}
      style={style}
      type={type}
      title={title}
      aria-label={ariaLabel ?? title}
      className={classes.join(' ')}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </BaseButton>
  )
}
