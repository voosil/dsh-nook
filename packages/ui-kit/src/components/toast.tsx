import { Toast as BaseToast } from '@base-ui-components/react/toast'
import { useEffect, useRef, type ReactNode } from 'react'

type ToastProps = {
  title: string
  message?: ReactNode
  action?: ReactNode
  onClose?: () => void
  className?: string
  closeLabel?: string
}

export function Toast(props: ToastProps) {
  return (
    <BaseToast.Provider timeout={0} limit={1}>
      <ToastContent {...props} />
    </BaseToast.Provider>
  )
}

function ToastContent({ title, message, action, onClose, className, closeLabel }: ToastProps) {
  const { toasts, add, close, update } = BaseToast.useToastManager()
  const id = useRef<string>()
  const closeCallback = useRef(onClose)
  closeCallback.current = onClose
  useEffect(() => {
    const toastId = add({ title, description: message, onClose: () => closeCallback.current?.() })
    id.current = toastId
    return () => {
      // Unmount is disposal, not a user dismissal.
      update(toastId, { onClose: () => {} })
      close(toastId)
    }
  }, [add, close, update])
  useEffect(() => {
    if (id.current) update(id.current, { title, description: message })
  }, [title, message, update])
  return (
    <BaseToast.Viewport>
      {toasts.map(toast => (
        <BaseToast.Root
          key={toast.id}
          toast={toast}
          swipeDirection={[]}
          className={className ? `nui-toast ${className}` : 'nui-toast'}
        >
          <BaseToast.Content className="nui-toast-body">
            <BaseToast.Title render={<strong />} />
            {message === undefined ? null : <BaseToast.Description render={<p />} />}
            {action}
          </BaseToast.Content>
          {onClose === undefined ? null : (
            <BaseToast.Close aria-hidden={false} className="nui-toast-close" aria-label={closeLabel ?? '关闭'}>
              ✕
            </BaseToast.Close>
          )}
        </BaseToast.Root>
      ))}
    </BaseToast.Viewport>
  )
}
