# Nook 模型生成适配

[实现](src/index.ts)把 DSH LLM 服务适配为 [Generation Capability](../capability-generation/src/index.ts)。接入版本依据见[全局基线](../../docs/discovery.md)，模型枚举与请求签名以实现使用的公开类型为准。

## 流结束与会话归因

只有 `finish.reason.kind === 'stop'` 且正文非空才返回成功。正文收集可见的 `text-delta`，再由 `block-end` 完整文本替换对应块，不包含推理内容。DSH 会把适配器选择、分发和迭代异常转成 `error` 或 `aborted` 终止块，消费者仍须捕获中间件等环节抛出的异常；仅使用 `catch` 会漏掉终止失败。公开 failure 提供服务商无关的 `code`、message 和可选 HTTP `status`，Nook 只向界面返回安全提示。[智能流程测试](../../tests/integration/intelligence/intelligence.test.ts)覆盖真实 Runtime 与 Gateway 的失败、取消和不完整输出。

DSH 的 `GenerateOptions.sessionId` 可选，但固定版本的 DeepSeek 适配器仅在提供它时发送 `x-deepseek-harness-session-id`。配置的 OpenCode Go 端点接受此原生头；缺失时的在线验证返回 HTTP 400，提示缺少 `x-opencode-session`。Nook 传入工作流标识，无需创建持久化 DSH Session；修复依据与在线验证范围见[决策记录](../../.agents/notes/implemented/bug-fix/2026-09-09-summary-generation-errors.md)。
