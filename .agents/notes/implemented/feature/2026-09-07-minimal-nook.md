# Agent Note: Minimal Nook 本地笔记与视频知识流程

Status: implemented

## Problem

个人记录需要随时输入、快速找回，并能服务于学习问答和项目复盘。视频资料质量不一致，笔记选择与文稿风格需要各自可替换。原始需求见[启动草稿](../../wip/startup.md)。

## Decision

首版以本地笔记为统一资料入口，唯一用户分类是可选项目。用户明确要求自动入库、搜索和增删查改、日期信息、手动日/周总结，以及区分视频评论笔记与 AI 整理内容。行为与限制由[笔记契约](../../../../packages/feature-notes/README.md)、[知识检索契约](../../../../packages/adapter-knowledge-dsh/README.md)和[视频契约](../../../../packages/feature-video/README.md)承载。

视频插件在 Nook 内实现，借鉴用户原项目的采集代码与文稿 skill。原项目固定的 DSH 版本与 Nook 不同，不能直接把运行成功当作兼容性证明。新的采集、评估和写作能力分别落在 Nook 契约背后。

知识索引与笔记共享本地事务，采用 SQLite FTS5，不要求额外服务或 embedding 配置。通用知识库的会话开关与视频插件独立。DSH 的外部边界以[发现记录](../../../../docs/discovery.md)为准。

主界面使用单一 Nook 入口打开工作区，跨 Client 插件通过 Nook 自有的 URL 片段导航，避免界面包依赖彼此的内部状态。

## Alternatives considered

并列的 Nook 与“笔记”入口：两者会让同一产品空间的入口含义重叠，用户明确选择只保留 Nook。

直接挂载原视频项目的 Bundle：其依赖固定 DSH `0.1.2-rc.1` 和不同 Cordis 版本，与当前 Nook 不同；用户明确选择在本仓库重做插件，因此只借鉴可分离的采集和编辑逻辑。

手动入库、多设备同步与定时总结：用户选择自动入库、本地存储和手动总结，首版不加入额外操作或调度服务。

复用 [Soren-ABT/dsh-knowledge](https://github.com/Soren-ABT/dsh-knowledge)、[lemoncat7/dsh-knowledge](https://github.com/lemoncat7/dsh-knowledge) 或 [OpenViking DSH 集成](https://docs.openviking.ai/en/agent-integrations/17-dsh)：调研发现可用候选方向，但没有在 Nook 固定运行时验证其公开写入、删除、过滤和生命周期契约。它们不作为未经验证的首版依赖。选择本地 FTS5 是为了让保存与索引一致性可直接验证，并接受语义召回能力有限的代价；Knowledge Capability 保留替换空间。

## Validation

[笔记契约测试](../../../../tests/contract/notebook.test.ts)覆盖 SQLite 重启、中文检索、索引变更、版本冲突、RPC 验证与卸载。[智能流程测试](../../../../tests/contract/intelligence.test.ts)覆盖会话开关、项目范围、完整模型输出、总结来源及真实 Python 进程的缓存采集。浏览器验收覆盖保存、刷新、找回、回收站和项目删除保留正文；安装包门禁将相同流程用于全新 tarball 安装。

全新安装使用仓库锁文件里的外部运行时约束。安装验收发现仅固定 DSH 顶层版本仍会拉取要求更新 Cordis 的工具插件，因此开发 Profile 与 tarball Profile 共享该约束，避免链接环境掩盖版本漂移。

公开视频在线试验中，原项目的 Bilibili 示例要求登录后获取字幕，YouTube 示例触发登录验证。采集器按失败反馈，未使用其他项目的账号资料。真实模型文稿效果仍需配置模型并使用用户认可的样例验收。

## Consequences

本地功能可以不配置模型使用；AI 功能需要 DSH 模型配置。缓存和模拟模型验证只能证明流程与边界，不能证明新视频在线采集的可用性或真实文稿质量。字幕缺失时的音频转写、运行任务跨重启恢复、向量召回和多设备同步不属于这次实现范围，限制见各包契约。

跨设备存储的范围扩展由[通用个人数据同步决策](2026-09-08-note-online-sync.md)承载。
