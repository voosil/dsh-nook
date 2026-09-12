# Agent Note: 验收脚本以阶段结果建立证据

Status: implemented

## Problem

Profile 行清单、HTML 包名、CSS 规则和生成命令的字符串检查会在内部重构时失效，却不能证明业务可用；备份目录数量和同步索引存在也不能证明内容可恢复或可传递。

## Decision

验收证据原则归属 [根规则](../../../../AGENTS.md)，产品验收遵循 [tests 规则](../../../../tests/AGENTS.md)，命令编排和静态门禁遵循 [verify 目录约束](../../../../scripts/verify/AGENTS.md)。最初的 Review 覆盖 verify 目录全部十二个既有脚本；后续归属调整见 [测试组织决策](2026-09-12-test-organization.md)。文档链接、依赖边界、发布入口及色值集中管理本身是工程约束，保留这类静态门禁，不把它们当成功能验收。

运行验收通过真实操作、重启后独立读取、恢复后的 Note 契约读取、独立同步接收方及退出后端口复用建立证据。内部日志和旧版文件格式只用于连接运行时、构造兼容性场景和诊断，不复制它们作为正确性的定义。自动保存通过已核实的 Connection HTTP 传输调用 Nook 的只读笔记 RPC，等待服务端出现所输入内容；不读取 localStorage 草稿，也不触发主动保存。传输信封依据固定 DSH 版本的 client-connection 与 api-gateway，业务数据契约归属 [笔记 RPC](../../../../packages/adapter-notes-dsh/src/rpc.ts)。

包验收独立发现工作区包，以发布清单为交付契约验证入口和安装隔离，再执行业务流程，不复制启动器的包成员或 Bundle 行清单。[运行时辅助函数](../../../../tests/helpers/runtime/web.mjs)只准备环境；[Profile 用例](../../../../tests/e2e/profile/profile-boot.test.ts)和[独立安装用例](../../../../tests/e2e/distribution/package/installation.test.mjs)显式验收业务。[同步与恢复探针](../../../../tests/fixtures/notebook/outcomes.mjs)从目标安装目录解析模块。Safe UI 通过官方会话可用及 Nook 入口消失验收。外观检查读取实际计算样式和滚动结果，不读取样式表规则或 token 绑定。桌面与原生验收分别检查渲染进程的 Node 可用性、锁竞争和释放结果。

## Alternatives considered

仅添加规则而保留原断言，会继续让实现自身决定通过条件。把断言机械替换成同义的字符串检查，也无法获得独立结果证据。

删除所有静态检查会丢失可直接判定的工程约束。要求所有验收都只能操作浏览器，则不能直接验收原生进程、包发布和备份恢复等关键节点。

打开历史记录虽然是用户操作，但会主动刷新保存，因此不能代替自动保存的只读等待。

## Consequences

Profile 验收需要实际启动和浏览器，耗时高于配置转储。下载验收只证明部署包可取得、解压，不宣称服务器安装成功；安装行为仍由独立的部署测试负责。Windows 源码启动和 macOS arm64 桌面安装需要各自平台执行，不能用语法检查替代平台验收。
