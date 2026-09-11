import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import { descriptors, RPC_PACKAGE } from '@nook-dsh/adapter-notes-dsh/rpc'
import { descriptors as syncDescriptors, RPC_PACKAGE as SYNC_PACKAGE } from '@nook-dsh/adapter-sync-dsh/rpc'
import { descriptors as updateDescriptors, RPC_PACKAGE as UPDATE_PACKAGE } from '@nook-dsh/adapter-update-dsh/rpc'
import { updateApi } from './lib/update-api.js'
import { useUpdate } from './hooks/use-update.js'
import { notebookApi } from './lib/api.js'
import { syncApi } from './lib/sync-api.js'
import { NotebookApp } from './components/notebook-app.js'
import { openSyncDeployment } from './lib/sync-deployment.js'
import { uiKitStyles } from '@nook-dsh/ui-kit'
import css from './styles/index.css'
import settingsCss from './styles/settings.css'

export type { Api } from './lib/api.js'
export const inject = ['slots', 'remote']

export async function apply(ctx: ClientContext): Promise<void> {
  await ctx.remote.$mount({ package: RPC_PACKAGE, descriptors })
  await ctx.remote.$mount({ package: SYNC_PACKAGE, descriptors: syncDescriptors })
  await ctx.remote.$mount({ package: UPDATE_PACKAGE, descriptors: updateDescriptors })
  ctx.inject(
    [
      'remote.nookUpdateRpc',
      'remote.nookNotebookRpc',
      'remote.nookSyncRpc',
      'slots',
      'sessions',
      'conversation',
      'workspaces',
    ],
    mountWorkspace,
  )
}

function mountWorkspace(ctx: ClientContext): void {
  const lifecycle = new AbortController()
  ctx.effect(() => () => lifecycle.abort())
  const api = notebookApi(ctx.remote.nookNotebookRpc)
  const update = updateApi(ctx.remote.nookUpdateRpc)
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
  let saveUpdateDraft: () => Promise<void> = async () => {}
  const registerUpdateSave = (save: () => Promise<void>) => {
    saveUpdateDraft = save
    return () => {
      saveUpdateDraft = async () => {}
    }
  }
  function Workspace() {
    const [syncDisabled, setSyncDisabled] = useState(true)
    useEffect(() => {
      const controller = new AbortController()
      void api('runtime', {}, controller.signal)
        .then(runtime => {
          if (!controller.signal.aborted) setSyncDisabled(runtime.development)
        })
        .catch(() => {})
      return () => controller.abort()
    }, [])
    const updater = useUpdate(update, () => saveUpdateDraft())
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
        <style>{uiKitStyles}</style>
        <style>{css}</style>
        <style>{settingsCss}</style>
        <NotebookApp
          api={api}
          sync={sync}
          syncDisabled={syncDisabled}
          updater={updater}
          registerUpdateSave={registerUpdateSave}
          close={() => setOpen(false)}
          onDeploy={async () => {
            if (syncDisabled) return
            const { directory } = await sync('prepareDeployment', {}, lifecycle.signal)
            await openSyncDeployment(ctx, directory, lifecycle.signal)
            setOpen(false)
          }}
        />
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
