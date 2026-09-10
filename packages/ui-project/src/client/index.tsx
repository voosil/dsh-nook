import { NotebookPen } from 'lucide-react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { Chip, uiKitStyles } from '@nook-dsh/ui-kit'

export const inject = ['slots']

function NookProjectContext(_props: PropsRuntime<'conversation.session.header.actions'>) {
  return (
    <>
      <style>{uiKitStyles}</style>
      <Chip title="This session can use Nook project and preview tools">
        <NotebookPen size={14} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--nook-color-accent)' }} />
        Nook
      </Chip>
    </>
  )
}

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.session.header.actions', () =>
    ctx.slots.register(
      {
        name: 'conversation.session.header.actions',
        id: 'nook-project-context',
        order: -5,
      },
      NookProjectContext,
    ),
  )
}
