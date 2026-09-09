import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

declare const __NOOK_SYNC_CONFIGURATION_GUIDE__: string

export const SYNC_CONFIGURATION_REQUEST = `请协助我配置 Nook 数据同步。

先根据我的需求确定是连接已有服务、部署新服务，还是处理同步问题。需求不明确时先简短问清，确定后只获取下一步所需的信息。已有信息直接复用。

根据随附的 Nook 同步指南执行。有可用工具和相应权限时，直接完成已确定范围内的操作；需要我操作时，给出当前步骤的明确指引，取得结果后继续推进。账号登录和系统提权由我在对应界面完成，不要求我在聊天中提供密码、私钥或完整连接凭据。

保留已有数据和配置；涉及覆盖或迁移时，先明确影响并创建、验证可恢复备份。遇到故障先诊断，不通过清空数据解决问题。

按本次确定的范围验证结果。分别说明服务器是否可用、哪些设备已经接入、哪些设备已完成实际同步，以及尚未验证或需要我处理的事项。`

export function syncConfigurationPrompt(guide: string = __NOOK_SYNC_CONFIGURATION_GUIDE__): string {
  return `${SYNC_CONFIGURATION_REQUEST}\n\n---\n\n${guide}`
}

/** Public DSH controllers only; a fresh session preserves existing drafts. */
export async function openSyncDeployment(
  ctx: Context,
  directory: string,
  signal: AbortSignal,
  prompt: string = syncConfigurationPrompt(),
): Promise<void> {
  signal.throwIfAborted()
  const workspace = await ctx.workspaces.create({ path: directory })
  signal.throwIfAborted()
  const sessionId = await ctx.sessions.create({ workspaceId: workspace.workspaceId })
  signal.throwIfAborted()
  const scope = ctx.sessions.scope(sessionId)
  if (!scope) throw new Error('同步配置对话暂未就绪，请重试。')
  ctx.conversation.input.for(scope).setDraft(prompt)
  ctx.sessions.open(sessionId)
}
