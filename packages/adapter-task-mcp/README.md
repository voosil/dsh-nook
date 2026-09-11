# Nook 任务 MCP

本地 stdio 入口复用正在运行的 Nook 后台。客户端配置以 Node 执行本包的 `lib/index.js`，首个参数为实际 DSH home 下 `task-connection.json` 的绝对路径，也可设置 `NOOK_TASK_CONNECTION`。连接文件由后台写入，仅包含本机回环端口和随机令牌；不要分享或同步它。

工具 `nook_task_list` 返回任务快照；`nook_task_command` 接受 `requestId` 和 `command`，操作结构由[能力 schema](../capability-task/src/index.ts)发布到 MCP。请求使用稳定 UUID，重试复用；版本值从最近快照读取。任务管理语义见[使用指南](../../docs/tasks.md)。

外部执行者选择 `executor: external` 的任务，提交 `claim`。必须收到 `applied` 和 `runId`、`token` 后才开始，执行期间每分钟 `heartbeat`。`pending` 仅表示本机已保存；可查询同一请求的回执。`report` 必须携带领取凭据、实际产物入口、不可变版本和检查证据。失效凭据不能覆盖当前运行；不支持 Nook 主动启动外部执行器。

配套[任务 Skill](../adapter-tasks-dsh/skills/nook-tasks/SKILL.md)说明交办、时间澄清、领取、交接及异常处理。DSH 对话工具复用相同业务能力，命名参数分别为 `request_id` 和 JSON 字符串 `json`。
