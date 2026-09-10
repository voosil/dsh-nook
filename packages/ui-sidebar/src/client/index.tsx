import { NotebookPen } from 'lucide-react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { Button, uiKitStyles } from '@nook-dsh/ui-kit'

export const inject = ['slots']

type SidebarProps = PropsRuntime<'sidebar.footer.action'>

// Layout only; the button skin (colors, hover, press) comes from @nook-dsh/ui-kit.
const styles = `${uiKitStyles}
.nook-sidebar-action { display: flex; width: 100%; }
.nook-sidebar-action .nui-btn { border-radius: 10px; }
.nook-sidebar-action .nui-btn:not(.nui-btn--icon) {
  width: 100%;
  justify-content: flex-start;
  gap: 9px;
  height: 36px;
  padding: 0 10px;
  font-size: 13px;
  font-weight: 500;
}`

function NookSidebarAction({ wide }: SidebarProps) {
  return (
    <div className="nook-sidebar-action">
      <style>{styles}</style>
      <Button
        iconOnly={!wide}
        aria-label="打开 Nook"
        onClick={() => {
          window.location.hash = 'nook'
        }}
      >
        <NotebookPen size={18} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--nook-color-accent)' }} />
        {wide && <span>Nook</span>}
      </Button>
    </div>
  )
}

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register(
      {
        name: 'sidebar.footer.action',
        id: 'nook',
        order: -20,
      },
      NookSidebarAction,
    ),
  )
}
