# 家庭服务器同步部署实录

本次用户授权通过 SSH 别名 `pro_evan` 安装配置 Nook 同步服务与 Tailscale。本文持续记录执行和证据，作为后续部署 skill 的材料；不存放密码、私钥、连接编码或授权链接。

## 环境与预检

- 本地为 Windows PowerShell，默认 SSH 来自 Git for Windows。沙箱不能读取用户 SSH 配置，第一次连接出现别名解析失败；授权执行相同 SSH 命令后连接成功。不要据此错误地判断服务器 DNS 或要求用户重新配置 SSH。
- 服务器为 Ubuntu 24.04.3 LTS、x86_64，有 Python 3、Docker 和免交互 sudo；根分区可用约 153 GB，未发现现有 Nook 助手或系统部署目录；Tailscale 未安装。
- 仓库已有用户的同步界面及验证脚本改动，部署记录不接管这些修改。
- 当前会话没有 Context7 MCP；依赖安装与 CLI 依据官方 [Tailscale 软件源](https://pkgs.tailscale.com/stable/)、[Tailscale CLI](https://tailscale.com/docs/reference/tailscale-cli)及 [Docker Ubuntu 安装说明](https://docs.docker.com/engine/install/ubuntu/)核查。

## 执行记录

1. 阅读[家庭服务器指南](../../scripts/sync-server/README.md#安装助手约束)、[安装助手源码](../../scripts/sync-server/assistant.py)和[产物生成器](../../scripts/sync-server/artifacts.mjs)。优先复用公开发布的固定版本与摘要校验链。
2. 通过 `ssh -o BatchMode=yes -o ConnectTimeout=15 pro_evan` 检查系统、权限、依赖和磁盘；退出码 1 来自不存在目录的 `ls`，SSH 本身成功。后续预检必须显式区分命令错误与连接错误。
3. 确认 Docker 29.1.2、Compose v5.0.0、systemd 和 UFW 运行；已有 18 个业务容器。不重启 Docker 或整机，不改现有业务的端口与配置。客户端 Windows 未检测到 Tailscale。
4. GitHub 直连及发布资产下载超时；Tailscale 软件源可直接访问，GHCR `/v2/` 返回预期的未认证 401。复用服务器已运行的 `127.0.0.1:7890` HTTP 代理后下载成功。代理仅传给本次下载/安装进程，不写入全局配置。
5. 公开产物与 Windows 工作区首次打包摘要不一致，立即停止执行。确认 `core.autocrlf=true`；把打包输入复制到被忽略的隔离目录并统一 LF，重新生成五个产物，摘要全部匹配 GitHub Release。已核实助手 SHA-256 为 `c4f356aab5173ec7e7679ab73e56dbf16bc16bd525477f32ae5463504d66c2fa`，归档为 `56e145eb6144774969eb80f1076b5181b4339398b493e7bb5654c4cd0e9e6e35`。正式 Windows 打包的一致性问题需单独修复并测试，不能通过忽略校验解决。
6. 核验后的助手存入服务器 `/root/nook-sync-install-0.1.0.py`，执行 `install --yes`。完整日志存于 root 专用文件 `/root/nook-sync-deployment-20260909.log`；终端过滤连接编码，防止密码进入对话与仓库。
7. Tailscale 官方软件包安装完成，助手输出设备授权链接，已请求用户登录目标账号并授权服务器。授权链接不写入仓库；此步骤不能以超时、默认选项或 AI 推测取代用户的账号授权。安装进程等待时可继续拉取固定镜像及整理记录。
8. 用户完成授权；Tailscale 1.102.3 状态 `Running`、节点在线、健康告警为空，地址为 `100.86.70.90`，DNS 名为 `macmini-server.tail84d798.ts.net`。当前设备密钥到期时间为 `2027-03-08T12:23:21Z`，无人值守使用仍需管理其到期策略。
9. 助手完成安装并退出 0；固定镜像摘要 `67ee7d0fa390d3452a06b8242173d3bbdbe139b87e9b8a97f74935202bfffaa8`，容器 `nook-sync-assistant-sync-1` 健康。Docker 发布端口仅为 `100.86.70.90:8443`；连接地址为 `https://100.86.70.90:8443/nook/`。回执 `complete=true`，Nook、Tailscale、Docker 的 systemd 服务均为 enabled/active；单元通过 `systemd-analyze verify`。
10. 执行 `sudo nook-sync backup`，生成 `/opt/nook-sync-assistant/backups/20260909-122410-643d1c41`，逐文件 SHA-256 验证通过，服务自动恢复健康。随后仅重启 Nook systemd 单元，前后连接 JSON 的摘要一致，容器健康检查再次通过。18 个既有业务容器启动时长未重置。
11. 在服务器创建 root 专用备份交接包 `/root/nook-sync-backup-20260909.tar.gz`，SHA-256 为 `a9021e55c50072e605d9fa237ed30fcd6fb3a4193de4cbff5a31d11060127d9b`。向本机传输连接配置及备份被自动审批拒绝：可信用户指令尚未明确授权将含凭据文件传到本地工作区。没有改道绕过，已向用户说明并请求明确授权；文件仍保留在服务器。
12. 从宿主机直接访问 Tailscale HTTPS 发布地址，完整校验证书：未认证和错误密码均返回 401，正确认证返回 200。此结果证明宿主机访问发布端口正常，不等价于其他 Tailscale 节点的可达性。
13. 用户明确回复允许下载到指定私有目录后，重新执行传输成功。Windows 目录 `.nook-backups/home-server-20260909` 关闭 ACL 继承，仅当前用户与 SYSTEM 拥有权限；连接文件与备份均被 Git 忽略。通过 SSH 标准输出的二进制流保存文件，避免 PowerShell 文本管道破坏 gzip；备份下载后摘要与服务器一致。连接配置格式为 `nook-sync-connection` 版本 1，密码和 CA 内容没有输出到对话。
14. 用 Nook 实际 `parseSyncConnection` 解析下载文件、用 Node `X509Certificate` 验证其 CA 类型，均通过且未联网。仓库 `docs:check` 与本次两个记录文件的 Prettier 检查通过。仅修改部署实录和对应过程笔记，没有修改或提交用户正在进行的其他代码变更。

## 接入与产品改进续录

15. 用户追加授权：由 AI 完成 connection.json 导入，并把过程中的不友好环节改进到代码。Windows 从官方软件源下载 1.102.3 AMD64 MSI，校验 Authenticode 为有效的 Tailscale Inc 签名；完整安装日志保存在临时目录。
16. Windows MSI 首次退出 1603，日志定位到 `iphlpsvc` 被禁用。记录原状态后通过系统提权将其恢复为 Manual 并启动，再次安装退出 0。Tailscale 服务自动启动；用户完成客户端账号登录后，状态 Running、健康告警为空，地址 `100.121.60.76`。
17. 客户端 `tailscale ping` 经香港 DERP 到达服务器，随后使用 Nook 实际 WebDAV Adapter 完整验证 HTTPS、CA、认证及条件写入成功。没有把未形成直接连接视为失败，也没有关闭证书校验。
18. 正式 Nook 数据位于 `%APPDATA%/Nook`，区别于开发实例。启动遇到遗留数据锁，确认 owner PID 37776 不存在且没有正式实例运行后，把锁目录重命名保存为 `nook.lock.stale-20260909-37776`，未删除用户数据。正式启动按产品流程创建并验证备份。
19. 通过固定 DSH 已核实的本机认证及 `nookSyncRpc.configure` 导入私有文件，再调用 run/status。没有直接编辑 settings.json，没有输出密码或令牌。2026-09-09 12:45 UTC 状态 enabled=true、idle、pending=0、conflicts=0、unsupported=0、error=null，首次同步完成。该用户库当时没有待传记录；真实双客户端数据及冲突由隔离集成测试覆盖。
20. 不友好点：浏览器文件选择器不能作为 AI 自动接入的唯一方式。新增 Host 工具 `nook_sync_import_connection`，以绝对文件路径与独立核实的 expected_url 导入，凭据不进入模型参数。复用现有 Feature 的备份、目标绑定与网络验证，并提供状态、同步及部署指南工具。
21. 不友好点：用户必须复制多段命令并反复回到配置页。部署入口通过公开 DSH 控制器创建独立对话草稿，提示词包含完整部署与私密交接授权；由用户发送。部署 skill 随 feature-agent 包发布，由专用指南工具返回，不依赖用户预装仓库 skill。
22. 干净包浏览器验收发现：无工作区的新 DSH 会话输入框会被禁用，单独 create/open 无法形成可发送提示词。核查固定运行时后，入口先由 Nook RPC 准备专用部署目录，再通过公开 workspaces.create 与 sessions.create({workspaceId}) 绑定会话，保持旧草稿不变。这个问题没有通过跳过浏览器断言掩盖。
23. Windows CRLF 摘要问题在产物生成器统一 LF 后修复，正常 Windows 打包的五个摘要与公开 v0.1.0 一致；增加跨换行契约测试。导入集成测试经真实 DshAdapter/官方 defineTool 编译注册，覆盖目标拒绝、无效及超大文件、取消、备份、同步和卸载清理。
24. 干净打包验收通过：35 个 Nook 包、25 个 Profile 组成项、实际浏览器中的工作区注册、新对话预填与手动导入同步。相关 Node 测试 15 项通过，独立 Apache 用例按平台跳过；安装器 19 项 Python 测试和嵌入源码启动校验在服务器的自动清理临时目录通过。Windows 仅有 Python 商店别名，不能把它当作已安装解释器；归档测试同时修正 GNU tar 对 Windows 盘符的解析及原生 tar 输出 CRLF 的兼容性。
25. 仅释放本次启动的正式 Nook 启动器，让共享运行时正常结束，再启动通过验收的新构建。2026-09-09 13:02 UTC 正式 Host `http://127.0.0.1:3020` 的 run RPC 再次返回 enabled=true、idle、pending=0、conflicts=0、unsupported=0、error=null，验证配置与凭据在重启后持久保留。独立的开发实例保持运行。

## 待验收

Windows 客户端安装、登录、真实连接导入及首次同步已经验收。家庭网络外访问、整机重启和恢复到新卷尚未验收；不要对承载其他业务的家庭服务器默认执行 reboot。

## 后续 skill 提炼要点

- 输入只要求目标 SSH 别名或连接方式；先验证已有认证与免交互 sudo，不能要求用户在聊天中发送密码或 SSH 私钥。主机、账号、端口和目录必须从环境与回执读取，不把本次个人配置写成默认值。
- 按预检、产物核验、依赖安装、等待账号授权、部署、验收、私密交接几个阶段执行，逐阶段保存脱敏证据。已有部署先读回执，地址或版本不匹配时沿用助手的保护行为。
- 显式检查发布可达性及完整摘要链。代理是可选且需要发现的环境能力；不要假定所有机器都有 7890 端口，也不要把 GHCR 的标准 401 响应判定为网络故障。
- 优先运行公开固定版本；开发者本地打包要检查 CRLF/LF 和压缩包头的一致性。摘要不符先解释差异，禁止跳过校验。
- 单独请求用户完成账号授权；可在等待期间处理不依赖登录的下载与文档。仅在状态确认 `Running` 并有稳定地址后继续。记录密钥到期日期，给出无人值守维护交接。
- 在支持异步问题的宿主中让用户提前选择是否同时配置客户端。服务器安装完成与客户端同步完成分别报告；没有客户端网络验收时不宣称已完成端到端同步。
- 凭据传输明确给出内容、目的地和权限，遵守宿主审批边界。获准后通过二进制 SSH 通道落盘，验证备份摘要、文件解析和 Git 忽略；不要把连接编码写进模型可见日志。
- 最小验收包括 TLS、认证拒绝、原子条件写入、监听地址、健康状态、开机启动配置、备份逐文件校验与 Nook 单独重启后的凭据持久性。物理重启、跨网络访问和恢复到新卷列为独立验收，不能与这些检查混同。

部署 skill 见 [nook-sync-deploy](../../packages/feature-agent/skills/nook-sync-deploy/SKILL.md)，产品实现与选择依据见[功能笔记](../implemented/feature/2026-09-09-ai-sync-deployment.md)。它由专用指南工具提供给 AI，不声称已经注册进 DSH 原生 skill 目录。
