import { useSyncExternalStore } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import { descriptors, RPC_PACKAGE } from '@nook-dsh/adapter-notes-dsh/rpc'
import { descriptors as syncDescriptors, RPC_PACKAGE as SYNC_PACKAGE } from '@nook-dsh/adapter-sync-dsh/rpc'
import { notebookApi } from './lib/api.js'
import { syncApi } from './lib/sync-api.js'
import { NotebookApp } from './components/notebook-app.js'
import css from './styles/index.css'

export type { Api } from './lib/api.js'
export const inject = ['slots', 'remote']

export async function apply(ctx: ClientContext): Promise<void> {
  await ctx.remote.$mount({ package: RPC_PACKAGE, descriptors })
  await ctx.remote.$mount({ package: SYNC_PACKAGE, descriptors: syncDescriptors })
  ctx.inject(['remote.nookNotebookRpc', 'remote.nookSyncRpc', 'slots'], mountWorkspace)
}

function mountWorkspace(ctx: ClientContext): void {
  const api = notebookApi(ctx.remote.nookNotebookRpc)
  const sync = syncApi(ctx.remote.nookSyncRpc)
  let open = true
  const listeners = new Set<() => void>()
  const setOpen = (value: boolean) => {
    open = value
    if (
      !value &&
      (window.location.hash === '#nook' ||
        window.location.hash === '#nook-sync-guide' ||
        window.location.hash.startsWith('#nook-note='))
    ) {
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
    }
    for (const listener of listeners) listener()
  }
  function Workspace() {
    const visible = useSyncExternalStore(
      listener => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      () => open,
    )
    return visible ? (
      <>
        <style>{css}</style>
        <NotebookApp api={api} sync={sync} close={() => setOpen(false)} />
      </>
    ) : null
  }
  ctx.effect(() => {
    const openHash = () => {
      if (
        window.location.hash === '#nook' ||
        window.location.hash === '#nook-sync-guide' ||
        window.location.hash.startsWith('#nook-note=')
      )
        setOpen(true)
    }
    window.addEventListener('hashchange', openHash)
    return () => {
      listeners.clear()
      window.removeEventListener('hashchange', openHash)
    }
  })
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register({ name: 'shell.overlay', id: 'nook-notebook', order: 10 }, Workspace),
  )
}
