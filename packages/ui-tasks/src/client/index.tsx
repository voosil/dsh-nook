import { useSyncExternalStore } from 'react'
import { ListChecks } from 'lucide-react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import { descriptors, RPC_PACKAGE } from '@nook-dsh/adapter-tasks-dsh/rpc'
import { Button, uiKitStyles } from '@nook-dsh/ui-kit'
import { taskApi } from './lib/api.js'
import { TaskApp } from './components/task-app.js'
import css from './styles/index.css'
export const inject = ['slots', 'remote']
export async function apply(ctx: Context) {
  await ctx.remote.$mount({ package: RPC_PACKAGE, descriptors })
  ctx.inject(['remote.nookTasksRpc', 'slots'], mount)
}
function mount(ctx: Context) {
  const api = taskApi(ctx.remote.nookTasksRpc),
    listeners = new Set<() => void>()
  const isOpen = () => window.location.hash === '#nook-tasks' || window.location.hash.startsWith('#nook-task=')
  ctx.effect(() => {
    const changed = () => {
      for (const listener of listeners) listener()
    }
    window.addEventListener('hashchange', changed)
    return () => {
      window.removeEventListener('hashchange', changed)
      listeners.clear()
    }
  })
  function Workspace() {
    const open = useSyncExternalStore(fn => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    }, isOpen)
    return open ? (
      <>
        <style>{uiKitStyles}</style>
        <style>{css}</style>
        <TaskApp api={api} />
      </>
    ) : null
  }
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register({ name: 'shell.overlay', id: 'nook-tasks', order: 20 }, Workspace),
  )
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register({ name: 'sidebar.footer.action', id: 'nook-tasks', order: -19 }, ({ wide }) => (
      <Button
        iconOnly={!wide}
        aria-label="打开任务"
        onClick={() => {
          window.location.hash = 'nook-tasks'
        }}
      >
        <ListChecks size={18} />
        {wide && '任务'}
      </Button>
    )),
  )
}
