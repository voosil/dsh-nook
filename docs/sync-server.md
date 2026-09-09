# 家庭同步服务器

Nook 同步服务器安装助手在家庭 Linux 服务器上配置 Docker、Tailscale 和独立同步存储。Nook → 数据同步 → 部署家庭服务器提供当前版本的安装命令。服务器无需运行 Nook Host 或模型；同步范围和连接格式见[同步契约](../packages/feature-sync/README.md)。

## 安装与连接

支持使用 systemd 的 Ubuntu 22.04 / 24.04 / 26.04、Debian 12 / 13，amd64 或 arm64，要求 root 或 sudo、至少 2 GB 可用磁盘，以及可访问 GitHub、GHCR、发行版与 Docker / Tailscale 官方软件源的网络。已有 Docker 和 Tailscale 复用；冲突的容器运行时不自动卸载，缺失的 Compose 插件仅从已有对应软件源补装。

1. 点击“让 AI 帮我部署并连接”，在新建的 DSH 对话中发送已经填好的请求。
2. 提供 AI 尚不知道的 SSH 连接方式，按提示完成系统提权和 Tailscale 账号授权。已有有效登录复用。
3. AI 按内置 [nook-sync-deploy skill](../packages/feature-agent/skills/nook-sync-deploy/SKILL.md) 完成服务器与当前 Nook Host 配置，通过[私有文件导入工具](../packages/feature-sync/README.md#配置与隐私)验证并开启同步，最后报告首次对账结果。

入口通过官方会话 API 创建独立对话并填入草稿，用户发送前不触发模型或部署；原有对话草稿保留。`nook_sync_deployment_guide` 提供随应用打包的 skill 和固定版本安装信息，不要求另行安装 skill。AI 需要可用的终端、SSH 和系统权限；账号登录、系统提权及宿主要求的审批仍可能需要用户参与。

“手动安装”展开项保留安装命令。用户可自行在服务器执行，随后在 Nook 粘贴连接信息或导入文件，再点击“验证并开启同步”。

安装命令自动准备下载工具，随后显示安装说明。地址取服务器的 Tailscale IPv4，默认从 8443–8463 选择可用端口，仅绑定该地址。HTTPS 使用服务生成的专用 CA，其信任只应用于当前 Nook 同步连接。服务器探测成功不表示电脑可达，Nook 会再次验证网络、TLS、认证及条件写入能力。

连接信息包含明文凭据的编码，编码不提供加密；只粘贴到自己的 Nook。该信息仅在安装交接或显式查看时输出，不进入正常服务日志。也可使用[文件导入与手动部署](../scripts/sync-server/DOCKER.md)。

## 数据与维护

助手及回执保存在 `/opt/nook-sync-assistant`，服务数据使用固定的 Docker 命名卷 `nook-sync-assistant-data`。此卷包含正文、凭据、CA 和服务器证书，每个卷只能运行一个同步服务。它与手动 Compose 部署、`/opt/nook-sync` 系统安装相互独立；已有部署不会被助手自动迁移。

服务器执行 `nook-sync` 打开维护菜单，也可使用：

```bash
nook-sync status
nook-sync info
nook-sync repair
nook-sync backup
nook-sync update
nook-sync diagnose
```

命令通过 sudo 运行。下载或启动中断后重新执行安装命令，沿用已记录的目标及端口。已有目标地址发生变化时停止，需恢复原 Tailscale 设备身份；不自动改证书地址、迁移同步库或重置客户端。

systemd 管理 `nook-sync-assistant.service`，等待 Docker、Tailscale 启动并检查原地址；地址未就绪时每 15 秒重试。容器使用 `on-failure`，由 systemd 负责宿主机启动时的顺序。首次安装后应重启服务器，并从家庭网络外的 Nook 做一次连接验收。长期无人值守的 Tailscale 设备需管理密钥过期策略。

备份先停止服务，以只读方式读取数据卷，归档后逐文件比较 SHA-256，并重新启动服务。结果保存在助手目录的 `backups/`，包含私钥和密码，应复制到另一块磁盘保管。恢复应使用全新卷，在隔离环境校验文件内容、权限、凭据和服务后再切换；不要覆盖运行中的卷。助手不提供数据删除或自动覆盖恢复。

更新从仓库稳定版助手发布中选择较新版本，下载并校验发布入口；新的助手固定对应服务镜像。镜像下载成功后先创建并校验备份，失败则中止更新。程序选择失败时尝试恢复原程序版本，不自动用备份覆盖业务数据。旧版本安装命令拒绝降级较新的部署。

## 发布与验证

`pnpm sync-server:package` 生成安装入口、可复制命令、Python 助手、部署归档和 SHA256SUMS。应用中的命令固定入口校验值，入口固定助手校验值，助手固定归档校验值和多架构镜像摘要。安装助手与同步镜像独立版本化；源码变更发布时必须增加助手版本，不能覆盖同版本产物。

打包输入统一为 LF 换行，gzip 系统头固定为 Linux，Windows 的 Git 换行转换不影响公开产物的校验链。应用构建同时生成包含相同安装摘要的 AI 指南，并随 `feature-agent` 包分发。

[发布工作流](../.github/workflows/sync-assistant.yml)由 `sync-assistant-v*` 标签触发，先在两个原生架构验证固定镜像与助手生命周期，再创建 GitHub Release，最后检查匿名下载和校验值。手动触发仅验证，不发布。工作区构建不代表公网安装地址已经发布；交付安装命令前需确认对应发布验收成功。

[逻辑测试](../tests/sync-server/test_assistant.py)覆盖失败重试、地址与版本保护、备份校验及端口占用。[Docker 验收](../tests/sync-server/verify_assistant.py)使用唯一的一次性卷，执行真实镜像安装、重复执行、连接导出、备份恢复与容器重建。[依赖安装验收](../tests/sync-server/verify_dependencies.py)在一次性 Debian / Ubuntu 容器内安装真实软件包并验证复用；生命周期验收替代宿主机包安装、Tailscale 身份与 systemd 调用，不替代真实 Tailscale 授权、跨网络连通性或物理机重启验收；生成的服务单元另经 `systemd-analyze verify` 检查。[入口验收](../tests/sync-server/verify_bootstrap.py)在 Linux 容器中执行真实的一行命令，以本地下载和空操作执行器验证 root 入口及两级校验失败时不执行代码。

软件源安装依据 [Docker Ubuntu](https://docs.docker.com/engine/install/ubuntu/)、[Docker Debian](https://docs.docker.com/engine/install/debian/) 与 [Tailscale 官方软件源](https://pkgs.tailscale.com/stable/)，登录和状态读取依据 [Tailscale CLI](https://tailscale.com/docs/reference/tailscale-cli)。
