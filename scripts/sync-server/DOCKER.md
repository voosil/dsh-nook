# Nook Sync Docker 部署

部署包包含 Nook Sync 0.1.0 的 Compose 配置及镜像源码。需要 Linux Docker Engine 和 Docker Compose v2。默认从 GHCR 拉取 `ghcr.io/voosil/nook-sync:0.1.0`，支持 linux/amd64 与 linux/arm64，无需在服务器编译或安装系统软件包。基础镜像固定到内容摘要，系统软件包在构建时从 Debian 软件源安装；交付的镜像归档由 SHA-256 校验。同一源码重新构建可能获取更新的软件包。

## 内网 / VPN 或公网 IP

把部署包解压到服务器的一个固定目录，所有维护命令都在该目录运行。复制 `.env.example` 为 `.env`，至少填写 `NOOK_HOST` 为其他设备实际使用的 IP 或域名，不带协议和路径。默认 `vpn` 模式和 8443 端口；公网 IP 使用 `NOOK_MODE=ip`。地址与端口写入持久化回执，重复部署必须保持一致。

```bash
cp .env.example .env
# 编辑 .env 后启动
docker compose up -d --wait --wait-timeout 180
```

若收到预构建的镜像归档，先校验随包的 SHA256SUMS，再加载对应服务器架构的归档。已加载镜像的服务器无需构建依赖：

```bash
sha256sum -c SHA256SUMS
docker load -i nook-sync-0.1.0-linux-arm64.tar
docker compose -f compose.yaml -f compose.build.yaml up -d --no-build --wait --wait-timeout 180
```

归档文件名中的架构须与服务器一致；amd64 使用相应的 amd64 归档。Compose 默认发布到全部 IPv4 接口，可用 `NOOK_BIND_IP` 指定某个服务器接口。默认模板不发布 IPv6 端口；IPv6 部署需要自行调整端口映射并验证网络。防火墙、VPN、路由和云安全组需要允许所选端口。

## 公网域名

设置 `NOOK_MODE=domain`、`NOOK_PORT=443`、`NOOK_HOST` 为已解析到服务器的域名，填写 `NOOK_EMAIL`，阅读 https://letsencrypt.org/repository/ 后设置 `NOOK_ACCEPT_ACME_TERMS=true`。此模式还需发布 TCP 80，供首次签发和续期的 HTTP-01 验证使用：

```bash
docker compose -f compose.yaml -f compose.domain.yaml up -d --wait --wait-timeout 180
```

此模式的后续 Compose 操作都带相同的两个 `-f` 参数。80 或 443 已有服务时，不要停止其他服务来强行部署；应先安排独立地址或部署环境。

## 导入 Nook

服务健康后，把连接配置通过 SSH 直接导出到本机。将下面的 SSH 主机和部署目录替换成真实值，在本机终端执行：

```bash
(umask 077; ssh user@server 'cd /path/to/nook-sync && docker compose exec -T sync python3 container.py export' > connection.json)
```

也可在服务器用 `docker compose exec -T sync python3 container.py export` 显式导出，再通过安全文件传输保存到本机。正常启动日志不输出密码或证书。导出失败应先修复服务健康状态，不要把空文件用于连接。

在 Nook → 数据同步点击“导入连接配置”，选择 `connection.json`。导入会填好地址、用户名、密码和可选 CA；核对服务器地址后点击“验证并开启同步”。客户端会实际验证网络、TLS、认证及原子写入，再执行本地备份与同步。导入文件本身不连接服务器或开启同步。文件含密码，应按凭据保管；其中 CA 仅信任此同步连接。

## 运维、备份与升级

Compose 的 `sync-data` 命名卷保存 `/var/lib/nook-sync` 整个目录，包括业务数据、凭据、CA、服务器证书和恢复记录。默认卷名由项目目录名决定；维护时保持目录名或显式保持相同的 Compose 项目名，避免连接到新卷。每个卷只允许一个服务实例；不能横向扩容。

```bash
docker compose ps
docker compose logs --tail 50 sync
docker compose exec -T sync tail -n 50 /var/lib/nook-sync/logs/apache.log
docker compose restart sync
```

内网和 IP 模式使用专用 CA；域名模式使用 Certbot。容器启动及运行中每 12 小时检查续期，更新时完整停止并重新启动 Apache，保留单写入者约束。私有服务器证书替换前执行备份校验。健康检查验证 TLS、认证和服务响应，不写业务数据；初始化另行验证条件创建与更新。续期失败保留数据并退出，由 Compose 重试，错误可在日志中查看。

备份时先停止写入，复制整个数据卷并校验备份文件。下面的操作只创建备份，不删除或覆盖业务卷；归档包含密码和私钥，备份目录需要保密：

```bash
docker compose stop sync
mkdir -m 700 backup
docker compose run --rm --no-deps --entrypoint tar sync -C /var/lib/nook-sync -czf - . > backup/nook-sync.tar.gz
tar -tzf backup/nook-sync.tar.gz > backup/contents.txt
sha256sum backup/nook-sync.tar.gz > backup/SHA256SUMS
sha256sum -c backup/SHA256SUMS
docker compose start sync
```

升级前完成离线备份和恢复校验，再加载新版本镜像、更新 Compose 中的固定版本并用同一卷重建服务。恢复应解压到一个全新卷，保留原卷，在隔离环境核验数据、权限和凭据后切换；不要把归档直接覆盖到运行中的卷。不要执行 `docker compose down -v`，它会删除业务数据卷。系统脚本安装目录不能直接作为容器卷接管；部署方式之间的迁移需要独立备份与迁移流程。

## 本地构建与维护者打包

无法访问 GHCR 时，使用 `docker compose -f compose.yaml -f compose.build.yaml up -d --build --wait --wait-timeout 180` 从源码构建本地镜像，需要访问 Docker Hub 和 Debian 软件源。域名模式继续追加域名配置文件。

在仓库根目录执行 `pnpm sync-server:package` 生成 `.pack/sync-server/nook-sync-0.1.0.tar.gz`，其中包含本说明和完整构建材料。执行 `pnpm sync-server:package -- --image` 会构建本机架构镜像并生成 Docker 归档、SHA256SUMS 和镜像元数据。应用指南内的下载包使用相同的文件集合。发布其他架构需在对应环境构建或使用 Docker Buildx，并独立验收。打包命令不推送镜像。仓库发布工作流在 `sync-server-v0.1.0` 标签上分别构建与验收两个架构，使用短期 `GITHUB_TOKEN` 推送 GHCR，再生成固定版本的多架构清单；已存在的版本拒绝覆盖。首次创建的 GHCR 包需设置公开可见，供客户端匿名拉取。
