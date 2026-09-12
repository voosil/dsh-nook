# Nook 任务执行适配

[实现](src/index.ts)通过 DSH Agent 提供 [Execution Capability](../capability-execution/src/index.ts)，接入版本依据见[全局基线](../../docs/discovery.md)。Agent 的 `setup` 提供局部 Tool 作用域，返回的 handle 必须释放；`sessionPersistence.flush()` 不接收 Session 参数。实际创建、发消息与取消签名以实现使用的公开类型为准。

`whenIdle()` 只证明 Agent 空闲，执行成功还须收到并校验 Nook 的显式结果报告。官方 Schedule 面向活跃会话的提醒，不承载 Nook 的持久化日历规则、任务状态或应用后台生命周期；状态转换以[任务引擎](../feature-tasks/src/engine.ts)为准，解耦依据见[任务决策](../../.agents/notes/implemented/feature/2026-09-10-tasks-refinement.md)。[执行集成测试](../../tests/integration/task-execution.test.ts)验证适配边界。
