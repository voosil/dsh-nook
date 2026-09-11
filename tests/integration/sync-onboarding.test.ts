import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, realpath, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import DshAdapter from '../../packages/dsh-adapter/src/index.ts'
import * as Notebook from '../../packages/provider-notebook-local/src/index.ts'
import Storage from '../../packages/adapter-sync-webdav/src/index.ts'
import Sync from '../../packages/feature-sync/src/index.ts'
import { registerSyncTools } from '../../packages/feature-agent/src/sync-tools.ts'
import { startWebDav } from '../helpers/webdav.mjs'
import { verifyBackup } from '../../packages/storage-backup/src/index.ts'

class ToolSink extends Service {
  readonly definitions = new Map<string, ToolDefinition>()
  constructor(ctx: Context) {
    super(ctx, 'tools')
  }
  register(spec: ToolDefinition) {
    this.definitions.set(spec.name, spec)
    return () => {
      this.definitions.delete(spec.name)
    }
  }
}

test('agent file import verifies target before network, keeps secrets private, backs up and syncs', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nook-sync-onboarding-'))
  const ctx = new Context()
  const server = await startWebDav()
  t.after(async () => {
    await ctx.fiber.dispose()
    await server.close()
    await rm(root, { recursive: true, force: true })
  })
  await mkdir(join(root, 'nook'))
  await ctx.plugin(Notebook, {
    file: join(root, 'nook/notebook.sqlite'),
    projectsFile: join(root, 'nook/projects.json'),
  })
  await ctx.plugin(Storage)
  await ctx.plugin(Sync, { file: join(root, 'private/settings.json') })
  await ctx.plugin(ToolSink)
  await ctx.plugin(DshAdapter)
  const plugin = await ctx.plugin({ inject: ['nookDsh', 'nookSync'], apply: registerSyncTools })
  const tools = (ctx.tools as unknown as ToolSink).definitions
  assert.equal(tools.size, 4)
  const call = async (name: string, args = {}) =>
    JSON.parse(
      (
        (await tools
          .get(name)!
          .execute(args, { signal: AbortSignal.timeout(30000) } as Parameters<ToolDefinition['execute']>[1])) as {
          result: string
        }
      ).result,
    )
  const deployment = await ctx.nookSync.prepareDeployment()
  assert.equal(deployment.directory, await realpath(join(root, 'private/sync-deployment')))
  assert.deepEqual(await ctx.nookSync.prepareDeployment(), deployment)
  const file = join(root, 'connection.json')
  const config = {
    format: 'nook-sync-connection',
    version: 1,
    url: server.url,
    username: 'tester',
    password: 'secret',
    caCert: '',
  }
  await writeFile(file, JSON.stringify(config))
  const before = server.methods.length
  assert.equal(
    (await call('nook_sync_import_connection', { file, expected_url: 'https://unexpected.invalid/nook/' })).ok,
    false,
  )
  assert.equal(server.methods.length, before)
  for (const text of ['{"password":"private-malformed-secret"', 'x'.repeat(32769)]) {
    await writeFile(file, text)
    const result = await call('nook_sync_import_connection', { file, expected_url: server.url })
    assert.equal(result.ok, false)
    assert.ok(!JSON.stringify(result).includes('private-malformed-secret'))
  }
  assert.equal(ctx.nookSync.status().enabled, false)
  await writeFile(file, JSON.stringify(config))
  const imported = await call('nook_sync_import_connection', { file, expected_url: server.url })
  assert.equal(imported.enabled, true)
  assert.ok(!JSON.stringify(imported).includes('secret'))
  assert.ok(!('caCert' in imported))
  const synced = await call('nook_sync_run')
  assert.equal(synced.error, null)
  assert.equal(synced.pending, 0)
  assert.ok(synced.lastSync)
  assert.equal(JSON.parse(await readFile(join(root, 'private/settings.json'), 'utf8')).password, 'secret')
  const backups = await readdir(join(root, 'nook.sync-backups'))
  assert.ok(backups.length)
  for (const backup of backups) verifyBackup(join(root, 'nook.sync-backups', backup))
  const requests = server.methods.length
  const aborted = new AbortController()
  aborted.abort()
  await assert.rejects(ctx.nookSync.importConnection(file, server.url, aborted.signal))
  assert.equal(server.methods.length, requests)
  await plugin.dispose()
  assert.equal(tools.size, 0)
})
