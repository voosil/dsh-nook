import { useState } from 'react'

declare const __NOOK_SYNC_ASSISTANT_COMMAND__: string

export function SyncAssistantGuide({ onConnect, onDeploy }: { onConnect: () => void; onDeploy: () => Promise<void> }) {
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState('')
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  return (
    <section aria-label="部署家庭服务器">
      <h2>部署家庭服务器</h2>
      <p>让 AI 帮你部署服务器、连接这台设备并验证同步。进入对话后发送已填好的请求，按提示完成账号登录。</p>
      <button
        type="button"
        disabled={opening}
        onClick={async () => {
          setOpening(true)
          setOpenError('')
          try {
            await onDeploy()
          } catch (error) {
            setOpenError(error instanceof Error ? error.message : '无法打开部署对话，请重试。')
          } finally {
            setOpening(false)
          }
        }}
      >
        {opening ? '正在打开部署对话…' : '让 AI 帮我部署并连接'}
      </button>
      {openError && <p role="alert">{openError}</p>}
      <details>
        <summary>手动安装</summary>
        <ol>
          <li>通过 SSH 登录服务器，复制并执行下方安装命令。</li>
          <li>按终端提示登录 Tailscale。助手自动安装依赖、配置地址、证书和开机启动。</li>
          <li>复制终端输出的连接信息，返回数据同步粘贴并验证。</li>
        </ol>
        <div className="nook-sync-guide-actions">
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(__NOOK_SYNC_ASSISTANT_COMMAND__)
                setCopied(true)
                setFailed(false)
              } catch {
                setFailed(true)
              }
            }}
          >
            {copied ? '已复制安装命令' : '复制家庭服务器安装命令'}
          </button>
          <button type="button" onClick={onConnect}>
            已安装，粘贴连接信息
          </button>
        </div>
        {failed && <p role="alert">无法访问剪贴板，请展开下方命令并复制。</p>}
        <details open={failed || undefined}>
          <summary>查看安装命令</summary>
          <textarea
            aria-label="家庭服务器安装命令"
            rows={4}
            readOnly
            value={__NOOK_SYNC_ASSISTANT_COMMAND__}
            onFocus={event => event.target.select()}
          />
        </details>
        <p className="nook-muted">
          支持 Ubuntu 22.04 / 24.04 / 26.04、Debian 12 / 13，amd64 / arm64，需要 root 或 sudo 和 systemd。已有
          Docker、Tailscale 会复用；中断后重新执行可继续，保留数据和凭据。
        </p>
        <p>
          每台电脑也需要安装 Tailscale，登录同一网络。连接信息包含密码，仅粘贴到自己的
          Nook；服务器就绪后仍需从电脑验证连接。
        </p>
        <details>
          <summary>查看状态、备份和维护</summary>
          <p>
            在服务器执行 <code>nook-sync</code>{' '}
            打开维护菜单，可查看连接信息、修复启动、创建并校验备份或更新。备份默认保存在服务器，应另外保存到其他磁盘。
          </p>
        </details>
      </details>
    </section>
  )
}
