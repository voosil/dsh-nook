# Agent Note: 笔记与项目快捷操作

Status: implemented

## Problem

笔记导出缺少完成反馈和文件定位入口，侧栏中的项目缺少直接管理与调整顺序的方式。卡片操作需要先进入编辑器，增加整理笔记的步骤。

## Decision

笔记卡片使用独立右键菜单，项目侧栏提供整行拖动排序，不显示拖动图标；右侧操作菜单入口仅在悬停项目时显示，隐藏时保留占位以避免名称跳动。排序通过 Nook Project Capability 持久化，完整 ID 列表校验拒绝过期项目集合，SQLite 在同一事务内写入顺序及同步版本。旧项目记录允许缺少顺序字段，以创建时间和标识稳定排序；并发顺序碰撞使用同一规则。

编辑器暴露当前草稿与保存句柄，卡片修改操作先完成保存、再获取最新版本。导出当前笔记直接使用草稿，保存冲突时仍能导出。删除项目后重新获取被解除归属的当前笔记，避免继续使用旧版本保存。删除保护遵循[备份指南](../../../docs/backup.md)。

桌面通过专用 preload 暴露导出和定位两个操作，主进程校验发送窗口、主 frame 和当前运行地址。导出只写下载目录，使用排他创建避免覆盖同名文件；定位只接受该窗口成功导出的不透明回执。窗口关闭时移除 IPC 处理器并清理回执。接入依据为本机 Electron 类型和官方 [contextBridge](https://www.electronjs.org/docs/latest/api/context-bridge)、[shell](https://www.electronjs.org/docs/latest/api/shell/) 文档。网页下载不伪报写盘完成，提示用户在浏览器下载列表查看。

## Alternatives considered

只在浏览器本地保存项目顺序：无法在桌面、网页及其他设备间保持一致，因此使用项目记录中的可选顺序字段。

允许页面提交任意文件路径以打开文件夹：权限超过笔记导出所需，因此采用主进程持有路径、页面持有回执的方式。

使用 hover Tooltip 承载导出结果：完成事件没有自然的悬停目标，因此采用右下角可关闭提示，并提供文件夹按钮。

## Consequences

具体操作与网页限制归属[笔记说明](../../../packages/feature-notes/README.md)。顺序作为项目元数据同步，跨设备并发修改沿用项目版本冲突机制；新项目追加到已有排序之后。导出提示保留至关闭或下次导出，便于用户稍后定位文件。

[契约测试](../../../tests/contract/notebook.test.ts)覆盖 Gateway、顺序重启、重复及过期 ID；[同步集成测试](../../../tests/integration/webdav-sync.test.ts)覆盖双副本顺序传播；[桌面文件测试](../../../tests/desktop/note-export.test.ts)覆盖同名导出、路径约束、失败及回执撤销。[界面验收](../../../scripts/verify/notebook-smoke.mjs)覆盖拖动刷新、侧栏改名删除、卡片菜单、未保存正文保护与导出提示。

[桌面安装包验收](../../../scripts/verify/verify-desktop.mjs)调用真实文件夹定位、验证导出字节及拒绝任意路径回执，并检查重启和共享后端。清理测试目录对 Finder 异步写入 `.DS_Store` 导致的目录非空执行有限重试。
