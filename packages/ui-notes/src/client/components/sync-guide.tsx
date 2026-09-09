import { useState } from 'react'
import type { ReactNode } from 'react'
declare const __NOOK_SYNC_SETUP_SOURCE__: string
declare const __NOOK_SYNC_SETUP_COMMAND__: string
declare const __NOOK_SYNC_DOCKER_ARCHIVE__: string
declare const __NOOK_SYNC_DOCKER_FILENAME__: string
function Source({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children} ↗
    </a>
  )
}
export function SyncGuidePage({ onBack }: { onBack: () => void }) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  return (
    <section className="nook-sync-guide-page" aria-label="同步配置指南">
      <header className="nook-sync-guide-header">
        <button type="button" onClick={onBack}>
          ← 返回数据同步
        </button>
        <span>Nook / 使用指南</span>
      </header>
      <article className="nook-sync-guide-body">
        <h1>配置你的同步存储</h1>
        <p>
          在服务器上部署同步存储，或连接已有 NAS。完成后导入连接配置，即可在多台设备间同步。 已有 Docker
          的服务器推荐使用部署包；没有 Docker 也可以使用下方安装脚本。
        </p>
        <h2>Docker / Compose 部署</h2>
        <p>下载固定版本部署包，上传服务器并解压。包内包含 Compose 配置、镜像源码和完整部署说明，无需安装 Nook 后端。</p>
        <div className="nook-sync-guide-actions">
          <a
            download={__NOOK_SYNC_DOCKER_FILENAME__}
            href={'data:application/gzip;base64,' + __NOOK_SYNC_DOCKER_ARCHIVE__}
          >
            下载 Docker 部署包
          </a>
        </div>
        <ol>
          <li>服务器需要 Docker 和 Compose v2，并能访问 GHCR；启动时自动拉取对应架构的固定版本镜像。</li>
          <li>
            复制 <code>.env.example</code> 为 <code>.env</code>，填写其他设备实际访问的 <code>NOOK_HOST</code>
            。默认使用内网 / VPN 模式和 8443 端口。
          </li>
          <li>在解压目录运行下方启动命令，等待健康检查通过。</li>
        </ol>
        <pre>
          <code>docker compose up -d --wait --wait-timeout 180</code>
        </pre>
        <details>
          <summary>公网 IP 与域名配置</summary>
          <p>
            公网 IP 设置 <code>NOOK_MODE=ip</code>。使用公网域名时，设置 <code>NOOK_MODE=domain</code>、
            <code>NOOK_PORT=443</code> 和证书通知邮箱 <code>NOOK_EMAIL</code>，阅读并接受{' '}
            <Source href="https://letsencrypt.org/repository/">ACME 服务条款</Source> 后设置{' '}
            <code>NOOK_ACCEPT_ACME_TERMS=true</code>。
          </p>
          <p>域名须提前解析到服务器，TCP 80 和 443 必须可达；域名模式使用以下命令，并在维护时保留两个配置文件参数：</p>
          <pre>
            <code>docker compose -f compose.yaml -f compose.domain.yaml up -d --wait --wait-timeout 180</code>
          </pre>
        </details>
        <h3>导出并导入连接配置</h3>
        <p>在本机终端执行下面的命令，将 SSH 主机和部署目录替换为真实值，即可把配置安全保存到本机：</p>
        <pre>
          <code>{`(umask 077; ssh user@server 'cd /path/to/nook-sync && docker compose exec -T sync python3 container.py export' > connection.json)`}</code>
        </pre>
        <p>
          返回数据同步，点击“导入连接配置”，选择 <code>connection.json</code>。地址、用户名、密码和 CA
          会一起填入；核对地址后点击“验证并开启同步”。连接文件含密码，请妥善保管。
        </p>
        <details>
          <summary>容器维护与数据备份</summary>
          <p>
            数据、凭据和证书保存在 Compose 的 <code>sync-data</code> 命名卷中。请保持部署目录或 Compose
            项目名一致，避免使用新卷。重建容器保留该卷；不要执行会删除卷的 <code>docker compose down -v</code>。
          </p>
          <pre>
            <code>{`docker compose ps\ndocker compose logs --tail 50 sync\ndocker compose restart sync`}</code>
          </pre>
          <p>
            证书自动续期。升级前停止写入并完成整卷备份和校验；包内 <code>DOCKER.md</code>{' '}
            提供完整备份、恢复和预构建镜像加载步骤。镜像托管在 GHCR：ghcr.io/voosil/nook-sync:0.1.0。
          </p>
        </details>
        <h2>Linux 服务器一键配置</h2>
        <p>
          支持 Ubuntu 22.04+、Debian 12+，需要 Python 3、sudo
          权限、systemd，以及可下载系统依赖的网络。安装在独立目录，不修改已有 Web 服务；端口被占用时会停止并保留原服务。
        </p>
        <ol>
          <li>通过 SSH 登录你的 Linux 服务器。</li>
          <li>复制下面的命令，在服务器终端粘贴执行。命令内包含本版本的完整安装脚本，无需预先上传文件。</li>
          <li>选择部署环境，填写访问地址和端口。域名模式还会询问证书通知邮箱及是否接受证书服务条款。</li>
        </ol>
        <div className="nook-sync-guide-actions">
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(__NOOK_SYNC_SETUP_COMMAND__)
                setCopied(true)
                setCopyError(false)
              } catch {
                setCopyError(true)
              }
            }}
          >
            {copied ? '已复制配置命令' : '复制一键配置命令'}
          </button>
          <a
            download="nook-sync-setup.py"
            href={'data:text/x-python;charset=utf-8,' + encodeURIComponent(__NOOK_SYNC_SETUP_SOURCE__)}
          >
            下载安装脚本
          </a>
        </div>
        <p className="nook-muted">
          命令较长是因为携带了完整脚本。也可下载脚本检查内容、上传服务器后执行{' '}
          <code>sudo python3 nook-sync-setup.py</code>。
        </p>
        {copyError && <p role="alert">剪贴板不可用，请展开完整命令后手动复制。</p>}
        <details>
          <summary>查看完整的一行命令</summary>
          <textarea
            aria-label="一键配置命令"
            readOnly
            rows={4}
            value={__NOOK_SYNC_SETUP_COMMAND__}
            onFocus={event => event.target.select()}
          />
        </details>
        <h3>三种环境，由你选择</h3>
        <div className="nook-sync-guide-table">
          <table>
            <thead>
              <tr>
                <th>环境</th>
                <th>需要填写</th>
                <th>HTTPS 如何配置</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>内网 / VPN</td>
                <td>设备可达的 IP 或内部域名；默认端口 8443</td>
                <td>生成专用 CA 和服务器证书，自动续期；把 CA 证书粘贴到 Nook。</td>
              </tr>
              <tr>
                <td>只有公网 IP</td>
                <td>服务器公网 IP；默认端口 443</td>
                <td>同样使用专用 CA，无需购买域名。浏览器不会默认信任它，Nook 可为该连接单独信任。</td>
              </tr>
              <tr>
                <td>有公网域名</td>
                <td>已指向此服务器的域名、邮箱；端口 443</td>
                <td>
                  通过 Let’s Encrypt 自动申请和续期公开可信证书，Nook 的 CA 字段留空。公网 TCP 80 和 443 必须可达。
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          防火墙、云安全组和路由由你管理。内网 / VPN
          模式只需让客户端通过相应网络访问所选端口，无需把服务开放到公网。证书始终校验地址和有效期，不关闭 HTTPS 校验。
        </p>
        <h3>完成后，导入连接配置</h3>
        <p>
          工具会自动生成随机密码，启动服务，并检查 HTTPS、认证、目录写入和并发冲突保护。 检查通过后，把服务器上的
          /opt/nook-sync/connection.json 安全下载到本机，在数据同步中导入。也可以按终端输出手动填写：
        </p>
        <pre>
          <code>{`WebDAV 同步目录：工具输出的完整 HTTPS 地址
存储用户名：nook
存储密码或应用令牌：工具生成的随机密码
服务器 CA 证书：内网 / IP 模式完整粘贴；域名模式留空`}</code>
        </pre>
        <p>
          然后返回数据同步窗口填写，点击“验证并开启同步”。CA
          证书只用于当前同步连接，不会修改系统证书信任。不要粘贴或分享服务器私钥。
        </p>
        <h3>重试、维护与备份</h3>
        <p>
          重复执行会保留已有密码、数据和证书，不会重置同步库。连接检查失败时，查看提示并修复网络后重试；使用不同地址重新执行会被拒绝。
        </p>
        <pre>
          <code>{`# 再次显示连接信息
sudo python3 /opt/nook-sync/setup.py --info
# 查看服务状态与最近错误
sudo systemctl status nook-sync
sudo journalctl -u nook-sync -n 50
# 查看证书自动续期任务
sudo systemctl status nook-sync-renew.timer`}</code>
        </pre>
        <p>
          数据位于 <code>/opt/nook-sync/data</code>，连接信息保存在仅 root 可读的{' '}
          <code>/opt/nook-sync/connection.json</code>
          。停止服务后备份整个安装目录；文件中含密码和证书私钥，不要公开分享。专用 CA 有效期为 10 年，服务器证书每次签发
          90 天并自动续期；到期更换 CA 时需更新 Nook 中的证书。
        </p>
        <p>
          <Source href="https://httpd.apache.org/docs/2.4/mod/mod_dav.html">Apache WebDAV 文档</Source> ·{' '}
          <Source href="https://eff-certbot.readthedocs.io/en/stable/using.html#standalone">Certbot 证书说明</Source>
        </p>
        <h2>使用已有 NAS</h2>
        <p>
          建立专用目录，给存储用户读取、创建、修改和删除权限，并开启 HTTPS。填写 WebDAV
          文件地址，不是管理后台或文件分享链接。
        </p>
        <details>
          <summary>NAS：群晖、QNAP 和其他设备</summary>
          <h4>群晖 DSM 7</h4>
          <ol>
            <li>
              在套件中心安装并打开 WebDAV Server，在设置中启用 HTTPS，记录端口（默认 <code>5006</code>）。
            </li>
            <li>
              建立共享文件夹，例如 <code>Sync</code>，在其中新建 <code>nook</code>
              。给专用用户该目录的读写权限，并允许使用 WebDAV Server 应用。
            </li>
            <li>在“控制面板 → 安全性 → 证书”中为 WebDAV 配置与访问域名匹配的证书。</li>
            <li>
              在同步窗口填写类似 <code>https://nas.example.com:5006/Sync/nook/</code>{' '}
              的地址。共享文件夹名称和端口以你的配置为准。
            </li>
          </ol>
          <p>
            <Source href="https://kb.synology.com/en-global/DSM/tutorial/How_to_fix_WebDAV_connection_issues">
              群晖官方连接与权限说明
            </Source>
          </p>
          <h4>QNAP QTS 5.2</h4>
          <ol>
            <li>打开“控制台 → 网络和文件服务 → Win/Mac/NFS/WebDAV → WebDAV”，启用 WebDAV。</li>
            <li>选择共享文件夹权限或 WebDAV 权限，并按所选模式为专用用户开放目标目录的读写权限。</li>
            <li>
              配置 HTTPS 端口及证书，建立专用目录。地址包含实际端口和共享文件夹路径，例如{' '}
              <code>https://nas.example.com:8443/Sync/nook/</code>；<code>8443</code> 仅为示例。
            </li>
          </ol>
          <p>
            <Source href="https://docs.qnap.com/operating-system/qts/5.2.x/en-us/configuring-webdav-settings-CDDF133D.html">
              QNAP 官方 WebDAV 设置
            </Source>
          </p>
          <p>
            其他 NAS 按厂商说明启用 WebDAV、HTTPS 和目录读写权限。填写的是 WebDAV 文件地址，不是 NAS
            管理页面或文件分享链接。
          </p>
          <p className="nook-sync-guide-callout">
            上述步骤说明如何启用服务，不代表这些 NAS 已通过 Nook
            双向同步验收。点击“验证并开启同步”后才能判断当前配置是否满足要求；提示不支持条件写入时，不要绕过检查。
          </p>
        </details>

        <h2>连接设备与排查问题</h2>
        <details>
          <summary>填入 Nook，并连接第二台设备</summary>
          <ol>
            <li>
              返回数据同步窗口，填写完整目录地址（以 <code>/</code>{' '}
              结尾）、存储用户名及密码或应用令牌。无需填写环境变量，也无需注册 Nook 账号。
            </li>
            <li>点击“验证并开启同步”。应用先备份本地数据，再检查连接和并发写入能力；临时探测文件会自动清理。</li>
            <li>
              等待显示“已同步”，再在另一台设备填写同一地址和凭据，开启同步。每台设备的 Nook 都需要运行才能接收变化。
            </li>
            <li>
              新建一条测试笔记，在另一台设备点击“立即同步”，确认内容可见。两端已有内容会按记录合并，冲突保留供选择。
            </li>
          </ol>
          <p>
            地址绑定后，请保持一致。更换目标需要独立本地库；不要删除远端文件来“重置同步”。同步目录应单独备份，当前内容未做端到端加密。
          </p>
        </details>
        <details>
          <summary>连接失败时怎么排查</summary>
          <dl>
            <dt>连接失败、超时或证书错误</dt>
            <dd>
              内网／IP 模式请完整粘贴工具生成的 CA 证书，再核对地址是否与证书匹配。检查 HTTPS 地址、端口及
              VPN／防火墙；直接填写最终地址，Nook 不跟随重定向，也不提供跳过证书校验选项。
            </dd>
            <dt>拒绝访问（401 / 403）</dt>
            <dd>
              检查用户名、密码、应用访问权限和目录读写权限。当前支持 HTTPS 上的 Basic 认证，不支持 Digest
              或网页交互登录。
            </dd>
            <dt>路径错误（404 / 409）</dt>
            <dd>
              确认这是 WebDAV 路径，共享文件夹和上级目录已存在，并核对路径大小写；管理后台地址和分享链接不能代替它。
            </dd>
            <dt>不支持强 ETag、原子条件创建或更新</dt>
            <dd>
              服务或代理没有提供安全的并发写入能力。检查服务器配置，或更换通过验证的存储；仅能上传下载文件还不够。
            </dd>
            <dt>已绑定的索引不存在、库被替换或历史回退</dt>
            <dd>先停止同步，检查是否改错目录或恢复了旧远端数据。保留本地库与备份，不要清库重下或手工重建索引。</dd>
          </dl>
        </details>
      </article>
    </section>
  )
}
