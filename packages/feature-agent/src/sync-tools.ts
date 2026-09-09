import type { Context } from '@deepseek-ai/cordis'
import type { NookToolSpec } from '@nook-dsh/dsh-adapter'
import { SyncError, type SyncService, type SyncStatus } from '@nook-dsh/capability-sync'
import { readFile } from 'node:fs/promises'

declare module '@deepseek-ai/cordis' {
  interface Context {
    nookSync: SyncService
  }
}

const outputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { result: { type: 'string', required: true } },
} as const

function summary(status: SyncStatus) {
  const { caCert: _ca, ...value } = status
  return { result: JSON.stringify(value) }
}

export function registerSyncTools(ctx: Context): void {
  const register = (spec: Omit<NookToolSpec, 'outputSchema' | 'render'>) =>
    ctx.effect(() =>
      ctx.nookDsh.registerTool({
        ...spec,
        outputSchema,
        render: value => (value as { result: string }).result,
      }),
    )
  register({
    name: 'nook_sync_status',
    description: 'Read this Nook Host sync status, target, pending records and failures. Never returns passwords.',
    parameters: {},
    async execute() {
      return summary(ctx.nookSync.status())
    },
  })
  register({
    name: 'nook_sync_import_connection',
    description:
      'Import a local connection.json by absolute path, verify its expected server, create the normal Nook backup, validate TLS/auth/atomic writes, and enable sync. Use when the user authorizes connecting this Nook to that server. Credentials remain inside the Host; never read or paste the file into the conversation. Follow with nook_sync_run to verify completion.',
    parameters: {
      file: {
        type: 'string',
        required: true,
        description: 'Absolute path on this Nook Host to the private connection file.',
      },
      expected_url: {
        type: 'string',
        required: true,
        description: 'The intended complete HTTPS sync directory, independently obtained from deployment.',
      },
    },
    timeoutMs: 180_000,
    async execute(args, signal) {
      try {
        if (typeof args.file !== 'string' || typeof args.expected_url !== 'string')
          throw new SyncError('请提供连接文件和预期地址。')
        return summary(await ctx.nookSync.importConnection(args.file, args.expected_url, signal))
      } catch (error) {
        return {
          result: JSON.stringify({
            ok: false,
            error: error instanceof SyncError ? error.message : '导入未完成，请检查当前同步状态后重试。',
          }),
        }
      }
    },
  })
  register({
    name: 'nook_sync_run',
    description:
      'Run synchronization on this Host and return completion or a safe error. Only report success when enabled, lastSync is present, error is null and pending is zero.',
    parameters: {},
    timeoutMs: 180_000,
    async execute() {
      return summary(await ctx.nookSync.run())
    },
  })
  register({
    name: 'nook_sync_deployment_guide',
    description:
      'Get the packaged Nook sync configuration guide and pinned installer details for deployment, connecting existing services, or troubleshooting. Choose the workflow from the user’s needs and available environment.',
    parameters: {},
    async execute() {
      return { result: await readFile(new URL('./sync-deployment.json', import.meta.url), 'utf8') }
    },
  })
}
