# 同步服务器部署

家庭服务器优先使用[安装助手](../../docs/sync-server.md)：复制安装命令，按提示登录 Tailscale，再将连接信息粘贴到 Nook。以下为其他网络环境的系统安装方式。

已有 Docker 的服务器使用 [Docker / Compose 部署包](DOCKER.md)，从 GHCR 拉取固定版本镜像。无 Docker 的 Linux 主机使用本页的系统安装工具。两种方式都导出 `connection.json`，可在 Nook → 数据同步直接导入，核对地址后点击“验证并开启同步”。连接文件包含密码，只通过可信渠道传输和保管。

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

[纯逻辑测试](../../tests/sync-server/test_setup.py)覆盖模式校验、参数注入拒绝、文件权限、备份失败和占用端口保护。[Linux 验收程序](../../tests/sync-server/verify_linux.py)在一次性容器中运行真实 Apache、OpenSSL、认证和 HTTPS 并发探测，覆盖三种输入模式、重复执行、目标变更拒绝及私有证书更新。

容器不运行 systemd，也不持有可签发的公网域名，因此验收替代 systemctl 激活和 Certbot 公网签发调用；真实网络请求、TLS、密码文件与 Apache 配置不模拟。公网签发成功及宿主机开机启动需在实际服务器验收，工具会在失败时停止并报告，不能把测试替代当成已签发公网证书。

生成的服务与定时器通过 `systemd-analyze verify` 校验。Linux 验收结束后保留一个仅供测试的 HTTPS 服务；把容器中的 `/tmp/nook-test-client.json` 复制出来，可在仓库运行 `node --import tsx tests/sync-server/verify_client.ts /tmp/nook-test-client.json`。该验收只接受固定的本机测试地址，使用真实 Nook Adapter 检查私有 CA、两个副本并发编辑、冲突解决及最终一致性。回执含测试密码，完成后随一次性容器一起清理。

公开证书调用依据 [Certbot standalone 文档](https://eff-certbot.readthedocs.io/en/stable/using.html#standalone)，独立服务配置依据 [Apache WebDAV](https://httpd.apache.org/docs/2.4/mod/mod_dav.html) 与 [prefork](https://httpd.apache.org/docs/2.4/mod/prefork.html)。
