---
name: nook-sync-deploy
description: 部署 Nook 家庭同步服务器并接入当前设备，或导入已有服务器连接并验证首次同步。
---

# Nook 同步部署

本 skill 通过 `nook_sync_deployment_guide` 随应用提供；该工具同时返回当前发布的助手 URL、SHA-256 和交互安装命令。若单独加载本文，先调用该工具取得固定版本信息。

## 当前状态与授权

先调用 nook_sync_status，确定当前 Host 的目标及状态。用户要求完成部署与接入后，连续推进到导入和首次同步；已有授权不要重复询问。只在缺少服务器连接方式、账号登录、系统提权或宿主明确要求审批时请求用户参与。

## 环境预检

通过可用终端检查当前 Host 操作系统、SSH、Tailscale；询问尚未知的 SSH 别名或地址。使用已有 SSH 配置，不索取聊天中的密码或私钥。预检服务器系统、sudo、磁盘、现有容器、Nook 回执和网络。只支持助手声明的 Ubuntu/Debian、systemd 和 amd64/arm64；不卸载其他容器运行时。

## 可信安装

使用本指南固定的 HTTPS URL 下载助手到管理员专用目录，并比对 assistantSha256；成功后以 root 运行 python3 assistant.py install --yes。助手会逐层验证归档和镜像。直连超时才检查已有代理；仅为当前进程配置必要代理。不要修改全局代理或重启既有 Docker。交互用户可使用 interactiveInstallCommand。

## 服务器登录与验收

安装输出包含 NOOK-SYNC-1 凭据，完整日志必须私密保存，对话输出过滤该行。Tailscale 登录链接只交给用户，并等待 status --json 的 BackendState=Running；不要把等待超时当作授权。已有有效登录复用。服务器完成后检查目标绑定、健康、systemd 和备份。不要默认重启承载其他业务的整机。

## 客户端接入

当前 Nook Host 也须安装 Tailscale 并加入同一网络。从官方来源获取匹配架构安装包，Windows 验证 Authenticode 签名。Windows MSI 1603 先查日志；依赖 iphlpsvc 被禁用时记录原状态并恢复到 Manual 后重试，不绕过安装器检查。提权和账号授权需要用户在系统页面完成。不要开启 exit node、子网路由或公网 Funnel。

## 私密连接交接

确认 SSH 目标和 Tailscale 地址。经 SSH 将 docker exec nook-sync-assistant-sync-1 python3 container.py export 的 stdout 直接保存成当前 Host 上的私有 connection.json；不要让模型读取文件内容。跨 Windows 传输使用二进制流，目录限当前用户及 SYSTEM，禁止提交到版本库。遵守宿主的敏感文件传输审批，首次需要时明确说明源、目的地及所含凭据。

## Host 内部导入

得到独立核实的完整 HTTPS URL 后，调用 nook_sync_import_connection(file=<本机绝对路径>, expected_url=<服务器同步目录>)。工具内部读取凭据，复用正常 Host 备份、TLS、认证和原子写入验证。不要直接改 settings.json，不要把密码放进 Tool 参数、提示词或日志。文件在远程 Host 时不能误用浏览器电脑路径。

## 同步验收

导入后调用 nook_sync_run 和 nook_sync_status，只有 enabled=true、lastSync 非空、error=null、pending=0 才报告首次同步完成；冲突及 unsupported 需另行报告。同步失败保留双方数据、凭据与备份并诊断，不重置远端库。

## 交付

回报连接地址、同步状态、备份位置及仍需用户处理的账号授权/密钥到期事项；区分已验证的客户端连接与尚未验证的外网和整机重启。记录脱敏执行证据及故障恢复经验。

## 实机恢复经验

SSH 别名解析失败可能来自执行沙箱无法读取用户 SSH 配置，先核查执行权限。Nook 数据锁阻止启动时，检查 owner.json 对应进程及启动身份；只有确认其已退出才保留旧锁记录并恢复启动，不绕过仍在运行的数据锁。当前 Host 的正式数据与临时开发数据分别识别，不把测试实例的连接当作用户正式配置。

## 官方依据

依赖配置需要核对当前官方文档：[Tailscale CLI](https://tailscale.com/docs/reference/tailscale-cli)、[Windows MSI](https://tailscale.com/docs/install/windows/msi)、[Docker Ubuntu](https://docs.docker.com/engine/install/ubuntu/)和 [Docker Debian](https://docs.docker.com/engine/install/debian/)。安装产物与日志是本次故障诊断的直接证据。
