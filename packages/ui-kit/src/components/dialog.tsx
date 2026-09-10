import { Dialog as BaseDialog } from '@base-ui-components/react/dialog'
import { AlertDialog as BaseAlertDialog } from '@base-ui-components/react/alert-dialog'
import { useContext, type ReactNode } from 'react'
import { PortalContainerContext, DialogPortalContainer } from './portal.js'

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  footer,
  width,
  className,
  alert,
  ariaName,
  closeLabel,
  container,
  children,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  title: string
  description?: string
  footer?: ReactNode
  width?: number
  className?: string
  alert?: boolean
  ariaName?: string
  closeLabel?: string
  container?: HTMLElement | null
  children: ReactNode
}) {
  const Root = alert ? BaseAlertDialog.Root : BaseDialog.Root
  const inheritedContainer = useContext(PortalContainerContext)
  const portalTarget = container ?? inheritedContainer
  return (
    <Root open={open} {...(onOpenChange === undefined ? {} : { onOpenChange: (next: boolean) => onOpenChange(next) })}>
      <BaseDialog.Portal {...(portalTarget === null ? {} : { container: portalTarget })}>
        <BaseDialog.Backdrop className="nui-dialog-backdrop" />
        <BaseDialog.Popup
          className={className ? `nui-dialog ${className}` : 'nui-dialog'}
          {...(ariaName === undefined ? {} : { 'aria-label': ariaName, 'aria-labelledby': undefined })}
          {...(width === undefined ? {} : { style: { width } })}
        >
          <BaseDialog.Title className="nui-dialog-title">{title}</BaseDialog.Title>
          {description === undefined ? null : (
            <BaseDialog.Description className="nui-dialog-description">{description}</BaseDialog.Description>
          )}
          {children}
          {footer === undefined ? null : <div className="nui-dialog-footer">{footer}</div>}
          <BaseDialog.Close className="nui-dialog-close" aria-label={closeLabel ?? '关闭'}>
            ✕
          </BaseDialog.Close>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </Root>
  )
}

export { DialogPortalContainer }
