import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { openSyncDeployment, SYNC_DEPLOYMENT_PROMPT } from '../../packages/ui-notes/src/client/lib/sync-deployment.ts'
import { dockerArtifacts, deploymentFiles, assistantArtifacts } from '../../scripts/sync-server/artifacts.mjs'
import { deploymentGuide } from '../../scripts/sync-server/agent-guide.mjs'

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
  await openSyncDeployment(ctx, '/deployment', new AbortController().signal)
  assert.deepEqual(events, ['workspace', 'create', 'draft', 'open:new'])
  assert.equal(draft, SYNC_DEPLOYMENT_PROMPT)
  assert.match(draft, /nook_sync_import_connection/)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(openSyncDeployment(ctx, '/deployment', controller.signal))
  assert.equal(events.length, 4)
})

test('CRLF deployment inputs produce the same archive and published checksum chain as LF', async () => {
  const replacements: Record<string, string> = {}
  for (const name of deploymentFiles)
    replacements[name] = (
      await readFile(new URL('../../scripts/sync-server/' + name, import.meta.url), 'utf8')
    ).replace(/\r?\n/g, '\r\n')
  assert.deepEqual((await dockerArtifacts(replacements)).archive, (await dockerArtifacts()).archive)
  const artifact = await assistantArtifacts()
  const guide = await deploymentGuide()
  assert.equal(guide.assistantSha256, createHash('sha256').update(artifact.source).digest('hex'))
  assert.equal(guide.interactiveInstallCommand, artifact.command)
  assert.ok(!artifact.source.includes('\r'))
  assert.equal(
    guide.skill,
    (
      await readFile(new URL('../../packages/feature-agent/skills/nook-sync-deploy/SKILL.md', import.meta.url), 'utf8')
    ).replaceAll('\r\n', '\n'),
  )
})
