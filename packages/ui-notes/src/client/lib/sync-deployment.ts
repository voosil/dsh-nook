import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

export const SYNC_DEPLOYMENT_PROMPT = `请帮我完成 Nook 家庭同步服务器部署和当前设备接入，持续执行到首次同步验证成功。
先调用 nook_sync_deployment_guide 和 nook_sync_status，按实际环境复用已有服务。如果缺少 SSH 连接方式，请先询问我；不要要求我在聊天中发送密码或私钥。
我授权安装和配置必要的 Docker/Tailscale、部署 Nook 同步服务，并把该服务器生成的连接配置经 SSH 保存到当前 Nook Host 的私有目录，供 Nook 导入。先核实服务器和目标地址，保留现有数据，执行并校验备份。账号登录或系统提权时提示我完成，随后继续。
请使用 nook_sync_import_connection 读取本机私有连接文件，自动验证并开启同步；凭据不能进入对话、Tool 参数或日志。随后运行 nook_sync_run 并确认同步状态。遇到故障先诊断修复，不重置数据。最后报告验证结果与仍需处理的事项。`

/** Public DSH controllers only; a fresh session preserves existing drafts. */
export async function openSyncDeployment(ctx: Context, directory: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  const workspace = await ctx.workspaces.create({ path: directory })
  signal.throwIfAborted()
  const sessionId = await ctx.sessions.create({ workspaceId: workspace.workspaceId })
  signal.throwIfAborted()
  const scope = ctx.sessions.scope(sessionId)
  if (!scope) throw new Error('部署对话暂未就绪，请重试。')
  ctx.conversation.input.for(scope).setDraft(SYNC_DEPLOYMENT_PROMPT)
  ctx.sessions.open(sessionId)
}
