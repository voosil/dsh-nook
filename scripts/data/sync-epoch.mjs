import { parseArgs } from 'node:util'
import { dirname, join, resolve } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import * as Notebook from '../../packages/provider-notebook-local/lib/index.js'
import Tasks from '../../packages/provider-task-sync/lib/index.js'
import { historyStages } from '../../packages/capability-note/lib/index.js'
import { createBackup, verifyBackup, acquireDataLock } from '../../packages/storage-backup/lib/index.js'
import { WebDavStorage } from '../../packages/adapter-sync-webdav/lib/index.js'
import { synchronize } from '../../packages/feature-sync/lib/engine.js'
import { publishEpoch } from '../../packages/feature-sync/lib/epochs.js'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    data: { type: 'string' },
    connection: { type: 'string' },
    output: { type: 'string' },
    backups: { type: 'string' },
    plan: { type: 'string' },
    help: { type: 'boolean' },
  },
})
const [command] = positionals
const usage = `Prepare a same-vault epoch migration from an isolated copy, never a running Nook database.
  node scripts/data/sync-epoch.mjs plan --data <isolated-data> --connection <settings.json> --output <plan.json> --backups <durable-backups>
  node scripts/data/sync-epoch.mjs publish --plan <plan.json> --connection <settings.json>
Planning catches up the isolated replica, may add backward-compatible history packs, verifies a full backup, and records the exact remote baseline.
Publication stages immutable data and switches index.json by CAS. All other clients need an epoch-capable Nook build.
`
if (values.help || !command) {
  console.log(usage)
  process.exit(0)
}
if (!values.connection || !['plan', 'publish'].includes(command)) throw new Error(usage)
const settings = JSON.parse(readFileSync(values.connection, 'utf8'))
const remote = new WebDavStorage(settings),
  signal = AbortSignal.timeout(600000)
try {
  if (command === 'plan') {
    if (!values.data || !values.output || !values.backups) throw new Error(usage)
    const data = resolve(values.data)
    // Operators must stage a copy; the lock also rejects a known live data directory.
    const release = acquireDataLock(data),
      ctx = new Context()
    try {
      await ctx.plugin(Notebook, { file: join(data, 'notebook.sqlite'), projectsFile: join(data, 'projects.json') })
      await ctx.plugin(Tasks, { identity: join(dirname(data), 'epoch-plan-device-id') })
      await synchronize(ctx.nookSyncReplica, remote, settings.url, signal)
      const candidates = []
      for (const item of ctx.nookSyncReplica.records('note')) {
        const entries = []
        let cursor = null
        do {
          const page = await ctx.nookNotes.history({ id: item.value.id, limit: 100, ...(cursor ? { cursor } : {}) })
          entries.push(...page.entries)
          cursor = page.cursor
        } while (cursor)
        for (const stage of historyStages(entries)) candidates.push(...stage.entries.slice(1).map(v => v.versionId))
      }
      const plan = ctx.nookSyncReplica.planHistoryRewrite(candidates)
      const mapping = plan.migration.data.mapping
      const summary = {
        candidates: candidates.length,
        removed: Object.values(mapping).filter(v => v === null).length,
        before: Object.keys(mapping).length,
        after: plan.versions.length,
        records: Object.keys(plan.heads).length,
      }
      const backup = createBackup(data, resolve(values.backups), 'before-sync-epoch-publication')
      verifyBackup(backup)
      mkdirSync(dirname(resolve(values.output)), { recursive: true, mode: 0o700 })
      writeFileSync(
        values.output,
        JSON.stringify({ format: 'nook-epoch-plan', version: 1, target: settings.url, backup, summary, plan }),
        { flag: 'wx', mode: 0o600, flush: true },
      )
      console.log(JSON.stringify({ summary, backup, plan: resolve(values.output) }))
    } finally {
      await ctx.fiber.dispose()
      release()
    }
  } else {
    if (!values.plan) throw new Error(usage)
    const receipt = JSON.parse(readFileSync(values.plan, 'utf8'))
    if (receipt.format !== 'nook-epoch-plan' || receipt.version !== 1 || receipt.target !== settings.url)
      throw new Error('Plan target does not match the connection')
    verifyBackup(receipt.backup)
    const next = await publishEpoch(remote, receipt.plan, signal)
    const result = values.plan + '.published.json'
    if (existsSync(result)) {
      const previous = JSON.parse(readFileSync(result, 'utf8'))
      if (
        previous.epoch !== next.epoch ||
        previous.transition !== next.transition ||
        previous.backup !== receipt.backup
      )
        throw new Error('Published receipt does not match the committed epoch')
    } else
      writeFileSync(
        result,
        JSON.stringify({
          epoch: next.epoch,
          vaultId: next.vaultId,
          generation: next.generation,
          transition: next.transition,
          backup: receipt.backup,
        }),
        { flag: 'wx', mode: 0o600, flush: true },
      )
    console.log(
      JSON.stringify({ published: true, epoch: next.epoch, generation: next.generation, receipt: resolve(result) }),
    )
  }
} finally {
  remote.dispose()
}
