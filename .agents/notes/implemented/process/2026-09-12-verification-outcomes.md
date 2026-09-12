# Agent Note: 验收脚本以阶段结果建立证据

Status: implemented

## Problem

Profile 行清单、HTML 包名、CSS 规则和生成命令的字符串检查会在内部重构时失效，却不能证明业务可用；备份目录数量和同步索引存在也不能证明内容可恢复或可传递。

## Decision

验收证据原则归属 [根规则](../../../../AGENTS.md)，产品验收遵循 [tests 规则](../../../../tests/AGENTS.md)，命令编排和静态门禁遵循 [verify 目录约束](../../../../scripts/verify/AGENTS.md)。最初的 Review 覆盖 verify 目录全部十二个既有脚本；后续归属调整见 [测试组织决策](2026-09-12-test-organization.md)。文档链接、依赖边界、发布入口及色值集中管理本身是工程约束，保留这类静态门禁，不把它们当成功能验收。

运行验收通过真实操作、重启后独立读取、恢复后的 Note 契约读取、独立同步接收方及退出后端口复用建立证据。内部日志和旧版文件格式只用于连接运行时、构造兼容性场景和诊断，不复制它们作为正确性的定义。自动保存通过已核实的 Connection HTTP 传输调用 Nook 的只读笔记 RPC，等待服务端出现所输入内容；不读取 localStorage 草稿，也不触发主动保存。传输信封依据固定 DSH 版本的 client-connection 与 api-gateway，业务数据契约归属 [笔记 RPC](../../../../packages/adapter-notes-dsh/src/rpc.ts)。

包验收独立发现工作区包，以发布清单为交付契约验证入口和安装隔离，再执行业务流程，不复制启动器的包成员或 Bundle 行清单。[运行时辅助函数](../../../../tests/helpers/runtime/web.mjs)只准备环境；[Profile 用例](../../../../tests/e2e/profile/profile-boot.test.ts)和[独立安装用例](../../../../tests/e2e/distribution/package/installation.test.mjs)显式验收业务。[同步与恢复探针](../../../../tests/fixtures/notebook/outcomes.mjs)从目标安装目录解析模块。Safe UI 通过官方会话可用及 Nook 入口消失验收。外观检查读取实际计算样式和滚动结果，不读取样式表规则或 token 绑定。桌面与原生验收分别检查渲染进程的 Node 可用性、锁竞争和释放结果。

[Safe UI 场景](../../../../tests/helpers/scenarios/authentication.mjs)在准备工作区后的页面重载处再次处理官方引导；“稍后配置”只结束当前页面的模型引导，不能假设跨页面持久化。[开发重载验收](../../../../tests/e2e/runtime/dev-modes.test.ts)先确认 Host PID 更替，再通过原页面的认证 cookie 轮询只读笔记接口。macOS 实测新进程已监听时创建接口仍返回 HTTP 404，因此端口归属只证明进程接管，不能作为业务写入的就绪条件。接口就绪后只执行一次 UI 创建并通过读取验证保存，同时保留页面未刷新与正式实例未变化的断言。

## Alternatives considered

仅添加规则而保留原断言，会继续让实现自身决定通过条件。把断言机械替换成同义的字符串检查，也无法获得独立结果证据。

删除所有静态检查会丢失可直接判定的工程约束。要求所有验收都只能操作浏览器，则不能直接验收原生进程、包发布和备份恢复等关键节点。

打开历史记录虽然是用户操作，但会主动刷新保存，因此不能代替自动保存的只读等待。

固定延迟依赖机器速度，强制点击会绕过真实引导遮挡，反复点击创建可能产生重复笔记；这些做法均不能代替明确的页面准备与只读就绪检查。

## Consequences

Profile 验收需要实际启动和浏览器，耗时高于配置转储。下载验收只证明部署包可取得、解压，不宣称服务器安装成功；安装行为仍由独立的部署测试负责。Windows 源码启动和 macOS arm64 桌面安装需要各自平台执行，不能用语法检查替代平台验收。

2026-09-12 在 macOS arm64 上验证引导与重启就绪修正：`pnpm verify` 通过全部工程门禁、构建、普通测试及 17 个源码 e2e；`pnpm verify:package` 的 16 个独立安装与更新用例全部通过。Windows 本次未执行。
