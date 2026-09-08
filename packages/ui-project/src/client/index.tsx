import { NotebookPen } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

export const inject = ['slots']

const CHIP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  height: 22,
  padding: '0 7px 0 5px',
  borderRadius: 6,
  background: 'var(--dsw-alias-fill-tsp-secondary)',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 12,
  fontWeight: 500,
  lineHeight: '22px',
  whiteSpace: 'nowrap',
}

function NookProjectContext(_props: PropsRuntime<'conversation.session.header.actions'>) {
  return (
    <span style={CHIP_STYLE} title="This session can use Nook project and preview tools">
      <NotebookPen size={14} aria-hidden="true" style={{ flexShrink: 0, color: 'oklch(70% 0.13 55)' }} />
      Nook
    </span>
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
