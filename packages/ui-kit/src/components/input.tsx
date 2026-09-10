import { Input as BaseInput } from '@base-ui-components/react/input'

export function Input({ className, ...rest }: Omit<BaseInput.Props, 'className'> & { className?: string }) {
  return <BaseInput {...rest} className={className ? `nui-input ${className}` : 'nui-input'} />
}
