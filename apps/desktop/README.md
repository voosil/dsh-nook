# Nook 桌面应用

桌面应用将 Nook Web 工作区放入 Electron 窗口，附带独立 Node 和完整的 DSH/Nook 运行时。基础笔记功能在首次启动时不需要下载依赖，也不要求用户安装 Node 或 pnpm。支持范围为 macOS 13 及以上的 arm64；打包产物是本地未签名 `.app`，没有自动更新器。

## 开发与打包

在仓库根目录执行：

```bash
pnpm desktop:dev      # 构建后打开桌面窗口；保留独立开发数据
pnpm desktop:stage    # 生成可搬移、带校验清单的离线运行时
pnpm desktop:package  # 构建 .pack/desktop/mac-arm64/Nook.app
pnpm verify:desktop   # 构建安装包，再运行真实窗口验收
```

开发入口构建固定快照，修改源码后重新启动。需要热更新时使用[浏览器开发模式](../../docs/development.md)。开发数据与空白模式遵循[开发指南](../../docs/development.md)，验证使用临时 home。

构建需要仓库开发工具链、网络和当前平台原生编译工具。Electron 与打包器版本归属[应用 manifest](package.json)，附带 Node 的版本和官方 SHA-256 归属[下载脚本](../../scripts/desktop/desktop-node.mjs)。运行时只携带 Node 可执行文件与许可证，原生模块按标准 Node 安装，不按 Electron ABI 重建。

## 数据与升级

桌面应用与 `pnpm start` 共用[正式运行环境](../../docs/runtime.md)。数据位置、旧网页笔记导入、后端复用及版本切换行为由该指南承载。

启动器在安装新运行时前校验分发文件，在复制后再次校验；复用已安装版本时也校验完整内容。它只更新自己管理的包链接，保留 Profile manifest、用户 patch、会话、凭据和业务数据。旧运行时、备份与日志不会自动删除。每次启动的日志最多写入约 5 MB，鉴权 token 被脱敏。

Nook 业务数据在启动前获得互斥锁并创建已校验备份；覆盖范围和恢复操作见[备份说明](../../docs/backup.md)。该快照不覆盖整个 DSH home，也不是跨版本数据库降级工具。桌面入口不执行自动数据格式迁移。

桌面 Profile 默认在后端启动时读取配置；配置变更遵循[共享后端的更新流程](../../docs/runtime.md#启动与退出)。应用运行时依赖通过重新构建分发；直接修改受管理依赖或安装同名包会使后续启动拒绝替换，保留现场供人工迁移。

## 窗口与退出

桌面应用是单实例，关闭最后一个窗口或按 Cmd+Q 会释放自己的共享后端连接。其他入口仍连接时后端继续运行；最后一个入口退出才停止服务。服务异常退出会切换到可重试错误页；“窗口”菜单提供重新连接和日志入口。重新连接不会重放模型请求或 Tool。

Renderer 开启 sandbox、上下文隔离和 Web 安全，关闭 Node integration 与 webview。主窗口只允许当前本地服务的导航，新窗口中的 HTTPS 链接交给系统浏览器；其他新窗口与权限请求被拒绝。专用 preload 仅暴露笔记导出和导出文件定位。主进程限制调用者为当前本地服务主 frame，导出文件以排他创建写入下载目录，定位只接受当前窗口生成的导出回执。开发及测试导出写入隔离状态目录的 `exports` 子目录。

## 验证与限制

[打包门禁](../../scripts/desktop/package-desktop.mjs)在 electron-builder 完成后再次校验包内运行时，以检查构建工具遗漏或修改资源。[窗口验收](../../tests/e2e/distribution/desktop/lifecycle.test.mjs)把 `.app` 复制到包含空格和中文的临时目录，使用不含开发工具的 PATH，验证鉴权、窗口隔离、笔记 RPC、保存与重载、第二次启动、网页与桌面共享读写及独立退出、资源损坏后的重试和退出清理；截图保存在 `.pack/desktop/nook-window.png`。

[生命周期测试](../../tests/integration/desktop/desktop-runtime.test.ts)覆盖重复停止、日志脱敏、子进程树清理和桌面父进程崩溃后的回收。[运行时安装测试](../../tests/integration/desktop/payload.test.ts)覆盖升级保留数据和用户 patch、损坏资源及越界符号链接。

[原生模块验收](../../tests/fixtures/desktop/native.mjs)使用安装包附带的 Node 和依赖，实际执行文件锁、SQLite FTS5、DSH shell、PTY 与服务释放。

视频采集与浏览器预览仍使用各自的外部依赖，见[视频功能](../../packages/feature-video/README.md)与[浏览器适配器](../../packages/adapter-browser-community/src/index.ts)。Electron 的 Chromium 不替代社区浏览器 Provider。开发者签名、公证、自动更新及其他操作系统的发布不在当前安装产物中。

方案取舍、参考项目评审与验证依据见[桌面化决策](../../.agents/notes/implemented/architecture/2026-09-08-electron-desktop.md)。
