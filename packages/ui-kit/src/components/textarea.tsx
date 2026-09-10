import { Field } from '@base-ui-components/react/field'
import type { TextareaHTMLAttributes } from 'react'

// The pinned Base UI has no Textarea part; Field.Control supports a textarea render element.
export function Textarea({
  className,
  value,
  defaultValue,
  disabled = false,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Field.Control
      {...(value === undefined ? {} : { value })}
      {...(defaultValue === undefined ? {} : { defaultValue })}
      disabled={disabled}
      className={className ? `nui-textarea ${className}` : 'nui-textarea'}
      render={<textarea {...rest} />}
    />
  )
}
