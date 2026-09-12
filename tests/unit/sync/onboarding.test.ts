import assert from 'node:assert/strict'

import { test } from 'node:test'

import type { Context } from '@deepseek-ai/cordis'

import {
  openSyncDeployment,
  syncConfigurationPrompt,
} from '../../../packages/ui-notes/src/client/lib/sync-deployment.ts'

import { deploymentGuide } from '../../../scripts/sync-server/agent-guide.mjs'

test('deployment starts a fresh draft through public controllers without sending', async () => {
  const events: string[] = []
  const scope = {}
  let draft = ''
  const ctx = {
    workspaces: {
      create: async ({ path }: { path: string }) => {
        assert.equal(path, '/deployment')
        events.push('workspace')
        return { workspaceId: 'deployment' }
      },
    },
    sessions: {
      create: async (options: unknown) => {
        assert.deepEqual(options, { workspaceId: 'deployment' })
        events.push('create')
        return 'new'
      },
      scope: () => scope,
      open: (id: string) => events.push('open:' + id),
    },
    conversation: {
      input: {
        for: (value: unknown) => {
          assert.equal(value, scope)
          return {
            setDraft: (text: string) => {
              draft = text
              events.push('draft')
            },
          }
        },
      },
    },
  } as unknown as Context
  const guide = await deploymentGuide()
  const prompt = syncConfigurationPrompt(JSON.stringify(guide))
  await openSyncDeployment(ctx, '/deployment', new AbortController().signal, prompt)
  assert.deepEqual(events, ['workspace', 'create', 'draft', 'open:new'])
  assert.equal(draft, prompt)
  assert.match(draft, /nook_sync_import_connection/)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(openSyncDeployment(ctx, '/deployment', controller.signal, prompt))
  assert.equal(events.length, 4)
})
