---
name: nook-tasks
description: 在 Nook 中管理个人待办、日程、计划和 Agent 执行任务，通过任务回执领取工作并提交可验收产物。
---

# Nook 任务

先用 nook_task_list 查看任务、模型角色、计划、提案和待确认回执。通过 nook_task_command 操作同一套任务能力，每次操作生成稳定的 request_id，重试复用。所有版本值必须来自最近读取。

用户明确交办时直接建立任务，不强制产生提案。自由笔记和待讨论想法不能当作执行授权。区分提醒时间、开始时间、截止时间和日程时段；模糊时段先保存 vague，在精确触发前澄清。Agent 任务必须有 description、scope、constraints、acceptance；来源保存 noteId、version 和必要摘录。只选择配置中已有的模型角色和工作目录。

pending 回执表示已保存并等待执行主机确认，不得声称已经开始、停止或完成。claim 返回 applied 且带 runId、token 后才能执行；外部执行者每分钟 heartbeat。外部执行停止时应停止实际工具活动，不能继续使用失效凭据。将改动限定在固定任务版本内，遇到范围或偏好变化时报告阻塞。

report 必须给出实际产物 uri、稳定 version 和工程检查证据；不要只提交完成说明。AI 验收使用独立上下文读取实际产物，无法访问或不确定的条件为 unverified。未经配置的 AI 验收不得替代用户确认。提案评审绑定 revision，先阅读关键变化，避免确认旧版本。
