# Agent Note: 源码设备的应用内更新

Status: implemented

## Problem

日常使用设备依赖频繁拉取代码、构建和手动重启。网页与桌面共用后端，单个入口重启也可能继续连接旧版本；直接在运行中替换依赖会破坏正在使用的快照。

## Decision

[应用更新](../../../docs/update.md)采用源码检出、独立构建和共享 broker 切换。Nook 自有更新 Capability 通过本机 Provider 与 broker 通信，DSH Adapter 提供严格 DTO 的鉴权 RPC。命令不能携带任意路径、远端地址或 shell 文本，也不注册 Agent Tool。broker 位于 Host 之外，停止 Host 不会中断切换。

更新采用应用关闭语义：Client 保存当前笔记，候选准备完成后自动停止旧 Host。进行中的任务随正常关闭流程停止，不维护忙碌检查、等待队列、稍后切换或多窗口确认。入口提示重启会中止任务。保存失败不开始更新。

更新提交通过独立 Git ref 固定，使用 detached worktree 保护开发工作区。候选 Profile 安装在最终目录，避免 Windows junction 搬迁失效。生产 Profile 在旧 Host 退出前不发生变化；源码启动和桌面启动读取同一成功版本记录。

[完整更新备份](../../../docs/backup.md#应用更新备份)覆盖会话和配置，补足仅业务数据备份无法恢复 DSH 迁移的边界。原始 home 与失败候选 home 均保留，恢复不删除用户内容。Windows 备份库从安装 Profile 解析，保留其 Koffi 依赖解析位置。

## Alternatives considered

**应用进程执行原地拉取、安装和重启。** 更新任务会随 Host 退出，安装失败可能破坏旧版本；不满足重度使用设备的恢复要求。

**检查忙碌、等待任务或协调窗口确认。** 过渡功能采用用户认可的关闭语义，额外的检查、排队及窗口协议增加复杂度而不改变任务可被应用关闭中止的事实。

**下载发布平台的预构建安装包。** 需要建立多平台构建与分发流程；当前设备已有源码工具链，源码准备可以先解决日常更新。

## Consequences

一次手动启动完成更新器引导。更新速度取决于本机工具链与网络，日志和快照占用磁盘且不自动回收。broker 保持当前协议直到所有入口退出；后续启动使用候选版本携带的 broker。协议不兼容候选在准备阶段失败。干净安装门禁同时要求消费 RPC 包的 UI 传递必要 Host peer；知识 UI 补齐其 Adapter 的 system-prompt peer 声明。

[Gateway 测试](../../../tests/contract/update.test.ts)验证固定命令、输入校验和生命周期退出。[备份测试](../../../tests/desktop/update.test.ts)验证配置与 SQLite 恢复、备份失败和成功版本记录。[共享 broker 集成测试](../../../tests/integration/update.test.ts)验证两条入口连接、更新后再次启动和候选迁移失败恢复。正式发布继续经过 Profile 与干净打包门禁。

macOS 验收还覆盖真实候选打包与完整 Harness 备份恢复，以及浏览器点击检查、更新、自动刷新和更新前笔记保留。常规回归为 118 项通过、3 项平台条件跳过；Windows 原生更新流程需要对应设备验收。
