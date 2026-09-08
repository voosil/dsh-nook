# Agent Note: 提交技能按需取证

Status: implemented

## Problem

变更较多时,提交技能的重复取证增加执行时间。用户反馈,加入固定行数预算、上下文有效性确认与分批补读后,实际提交更慢;缩减单次输入量不足以解决多轮判断与工具往返的成本。

## Decision

取证、分组与执行规则统一由 [commit skill](../../../.agents/skills/commit/SKILL.md) 承载。常规提交以本轮任务上下文为依据,优先减少重复确认和串行补读;仅在具体信息缺口影响范围或主题时读取额外内容。

参考 [GitHub git-commit](https://github.com/github/awesome-copilot/blob/main/skills/git-commit/SKILL.md) 的暂存区优先策略。保持单一简短流程,不引入固定行数预算、逐文件覆盖或额外脚本。

## Alternatives considered

强制完整读取所有 diff:证据覆盖直接,但提交范围明确、上下文充足时仍重复付出成本,因此不作为默认工作流。

固定预算后分批补读:借鉴 [aicommits 生成逻辑](https://github.com/Nutlope/aicommits/blob/develop/src/feature/generate-commit-message.ts) 可以限制单次输入,但在本项目的技能执行中用户反馈更慢,因此不保留约 400 行预算及相应的分批流程。

只按文件名生成提交说明或截取整个 diff 的开头:输入量小,但无法解释陌生改动,也可能遗漏后面的文件,因此不采用。

直接替换为热门 skill:公开实现分别侧重格式、全量审查或单次提交,无法同时保留项目的分组约束与按需取证目标,因此选择修改现有技能。

## Consequences

常规路径依赖本轮上下文,不能替代独立代码审查;大量陌生变更仍需要检查。已有暂存且用户未指定范围时,其余工作区变更保留,避免提交请求隐式扩大为全工作区整理。

改动仅涉及技能指令与决策记录。静态审阅覆盖部分暂存、未跟踪文件、已知改动复用和大 diff 补读,不将其视为模型行为测试或成本基准。

## Verification

校验覆盖技能结构、目标文件格式与仓库文档门禁;性能效果以实际使用反馈为准,不根据规则长度推算提速比例。
