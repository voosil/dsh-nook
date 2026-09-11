# Nook 会话知识检索

该插件依赖 Nook Knowledge 与 Project Capability，以及 DSH 的会话和提示词服务。它与视频流程和笔记工作区 UI 独立；[会话控件](../ui-knowledge/src/client/toggle.tsx)通过[专用 RPC](src/rpc.ts)访问会话开关和项目目录。

会话标题栏的“知识库”开关按会话保存。启用后，每轮提示词组装从当前会话最新一条用户消息提取查询，检索最多 8 个片段。可选择全部项目或单个项目。关闭时不添加 Nook 检索上下文。删除选中的项目会关闭该会话的检索，避免把范围默默扩大到全部项目。

检索上下文标记标题、来源种类、来源链接、笔记版本和片段偏移，并要求回答使用可打开的笔记引用。无命中时明确通知模型无检索结果；检索失败不伪装成成功。来源资料作为数据传入，不参与提示词模板求值。

[Host 实现](src/index.ts)只把 JSON 安全的数据交给模型和 Client，不跨边界传递 Session 或 Cordis 对象。DSH 契约依据见[发现记录](../../docs/discovery.md)。本地检索算法与持久化语义见[笔记契约](../feature-notes/README.md#存储与检索)。

## 提示词接入限制

固定 DSH 版本的 `system-prompt/assemble` 是带 `next()` 的 waterfall，Agent 为上下文提供 `agent`；实现从 `agent.session.deriveMessages()` 中选择最新的用户来源消息，监听器随 Cordis 生命周期移除。模板变量名须匹配 `^[a-z][a-z0-9_]*$`，变量值中的模板语法不会递归求值。[智能流程测试](../../tests/contract/intelligence.test.ts)使用含字面模板标记的笔记验证资料作为数据插入。
