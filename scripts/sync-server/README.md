# 同步服务器部署

系统安装由 [setup.py](setup.py) 承载，Docker 部署约束见 [DOCKER.md](DOCKER.md)。[安装助手](assistant.py)组合 Docker 与 Tailscale，使用独立数据卷；三种部署不能互相接管已有数据。WebDAV 条件写入与客户端信任要求见[同步契约](../../packages/feature-sync/README.md)。

## Linux 系统安装

Nook 的独立同步指南页提供“复制一键配置命令”和脚本下载。复制的命令包含当前构建的完整压缩脚本，不访问可变下载地址；通过 SSH 登录服务器后粘贴执行即可。也可把 [setup.py](setup.py) 上传到服务器，执行 `sudo python3 nook-sync-setup.py`。配置指南位于 Nook 的 `#nook-sync-guide` 页面，弹窗只提供入口。

## 支持条件

工具支持 Ubuntu 22.04+、Debian 12+，要求 systemd、Python 3、root 或 sudo 权限，以及可访问发行版软件源的网络。自动安装 Apache 二进制、密码工具、OpenSSL，域名模式额外安装 Certbot。使用专属 systemd 服务和配置，不加载或更改已有 Apache 站点。目标端口被占用时停止，不终止已有进程。

| 选择        | 输入                                  | HTTPS                                                                          |
| ----------- | ------------------------------------- | ------------------------------------------------------------------------------ |
| 内网 / VPN  | 客户端可达的 IP 或内部域名，默认 8443 | 专用 CA；证书只在 Nook 此连接中信任                                            |
| 只有公网 IP | 公网 IP，默认 443                     | 专用 CA；无需域名，不申请公开 IP 证书                                          |
| 公网域名    | 域名、邮箱，固定 443，接受 ACME 条款  | Certbot standalone 自动申请 Let’s Encrypt 证书，公网 TCP 80 用于首次签发和续期 |

域名需提前解析到服务器。云安全组、防火墙、VPN 和路由需允许客户端访问所选端口；工具不自动更改网络策略。IP 或内部域名必须与客户端实际填写地址一致，IPv6 地址自动格式化。公开可信模式的 Nook CA 字段留空；专用 CA 模式完整粘贴工具输出的 CA 公共证书，不能使用私钥或跳过校验。

非交互调用示例：

```bash
sudo python3 nook-sync-setup.py --mode vpn --host 10.0.0.8 --port 8443
sudo python3 nook-sync-setup.py --mode ip --host <公网IP>
sudo python3 nook-sync-setup.py --mode domain --host sync.example.com --email you@example.com --accept-acme-terms
```

后两行的地址、邮箱必须替换为真实值。交互模式会让用户选择环境和填写信息；使用显式参数可以跳过对应问题。

## 完成、重试与维护

工具只有在 HTTPS 证书验证、匿名拒绝、字节完整性、强 ETag、条件创建和条件更新检查通过后才显示“配置完成”。本机访问成功不等于客户端可达，仍需在 Nook 点击“验证并开启同步”。输出包含完整 URL、用户名、随机密码及可选 CA 证书。

安装探测连接本机回环地址，同时按客户端使用的 IP／域名校验证书，兼容不支持公网地址回环访问的 NAT 网络。域名证书的公网验证仍由 ACME 执行。

配置、CA、服务器证书和脚本保存在 `/opt/nook-sync`；业务数据位于其 `data/` 子目录。`connection.json` 和 `state.json` 含密码，仅 root 可读。Apache 工作进程使用专属低权限用户，最多一个进程处理请求，关闭 KeepAlive；HTTPS 不经其他代理时无需额外转发配置。

安装锁阻止并发配置。重复运行不重新生成密码或重置业务库，模式、地址、端口不一致时拒绝覆盖。失败保留配置和数据，可修复后重试；没有回执的非空目录不会被接管。此工具不执行卸载、数据清理、库重置或跨地址迁移。

```bash
sudo python3 /opt/nook-sync/setup.py --info
sudo systemctl status nook-sync
sudo journalctl -u nook-sync -n 50
sudo systemctl status nook-sync-renew.timer
```

续期任务每天检查两次并加入随机延迟。私有 CA 有效期 10 年，服务器证书有效期 90 天，在剩余 30 天内续期；续期保留 CA 和地址，因此无需修改客户端。CA 接近到期时工具报错，需安排更换和客户端更新。Certbot 管理公开证书的续期。替换活跃私有服务器证书前先创建并校验备份，失败则中止；证书变化后完整重启服务，避免多个 Apache 代际同时写入。

离线备份应先停止 `nook-sync.service`，保存整个 `/opt/nook-sync` 目录及对应 systemd 单元，再启动服务。该备份包含密码和私钥，不能公开分享。同步记录格式和业务范围见[同步契约](../../packages/feature-sync/README.md)。

## 验证范围

[纯逻辑测试](../../tests/integration/sync-server/posix/test_setup.py)覆盖模式校验、参数注入拒绝、文件权限、备份失败和占用端口保护。[Linux 验收程序](../../tests/fixtures/sync-server/linux.py)在一次性容器中运行真实 Apache、OpenSSL、认证和 HTTPS 并发探测，覆盖三种输入模式、重复执行、目标变更拒绝及私有证书更新。

容器不运行 systemd，也不持有可签发的公网域名，因此验收替代 systemctl 激活和 Certbot 公网签发调用；真实网络请求、TLS、密码文件与 Apache 配置不模拟。公网签发成功及宿主机开机启动需在实际服务器验收，工具会在失败时停止并报告，不能把测试替代当成已签发公网证书。

生成的服务与定时器通过 `systemd-analyze verify` 校验。Linux 验收结束后保留一个仅供测试的 HTTPS 服务；把容器中的 `/tmp/nook-test-client.json` 复制出来，可在仓库运行 `node --import tsx tests/fixtures/sync-server/client.ts /tmp/nook-test-client.json`。该验收只接受固定的本机测试地址，使用真实 Nook Adapter 检查私有 CA、两个副本并发编辑、冲突解决及最终一致性。回执含测试密码，完成后随一次性容器一起清理。

公开证书调用依据 [Certbot standalone 文档](https://eff-certbot.readthedocs.io/en/stable/using.html#standalone)，独立服务配置依据 [Apache WebDAV](https://httpd.apache.org/docs/2.4/mod/mod_dav.html) 与 [prefork](https://httpd.apache.org/docs/2.4/mod/prefork.html)。

## 安装助手约束

修改 [assistant.py](assistant.py) 时保留目标地址与数据卷身份：助手回执和证书绑定原 Tailscale IPv4，地址变化时停止；缺失身份不自动改证书、迁移同步库或重置客户端。每个卷只能有一个服务写入。依赖安装复用已有 Docker/Tailscale，不卸载冲突运行时。支持矩阵与安装分支以源码及[依赖验收](../../tests/integration/sync-server/linux/test_dependencies.py)为准。

systemd 等待 Docker、Tailscale 和原地址后启动服务；容器重启策略不能替代宿主机的启动顺序。备份停止服务并只读归档数据卷，逐文件比对 SHA-256 后恢复服务。备份包含私钥与密码；恢复使用独立新卷，不覆盖运行卷。程序更新前验证备份，程序选择失败只回退程序，不自动用备份覆盖业务数据。

[产物生成器](artifacts.mjs)固定安装入口、助手、部署归档的逐级 SHA256 和多架构镜像摘要；应用命令与内置 AI 指南使用同一摘要。输入统一 LF，gzip 系统头固定 Linux，保证跨平台产物一致。助手与镜像独立版本化，发布源码变更必须增加助手版本，不能覆盖同版本产物或允许旧入口降级新部署。

[发布工作流](../../.github/workflows/sync-assistant.yml)在原生双架构验收后创建 Release，并验证匿名下载与校验值；手动触发只验证。工作区打包成功不证明安装地址已公开可用。交付命令前检查对应发布结果；Agent 部署流程由[随包技能](../../packages/feature-agent/skills/nook-sync-deploy/SKILL.md)承载，不在此复制。

[助手验收](../../tests/integration/sync-server/docker/test_assistant.py)使用一次性卷验证镜像、备份恢复和重建；[入口验收](../../tests/fixtures/sync-server/bootstrap.py)验证校验失败不执行代码。容器中替代的 Tailscale 身份、systemd 和软件安装调用不能证明真实授权、跨网络连接或物理机重启成功，宿主服务单元另用 `systemd-analyze verify` 检查。
