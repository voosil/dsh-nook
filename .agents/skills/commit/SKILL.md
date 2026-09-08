---
name: commit
description: Commit intended changes using task context; split only clearly independent changes. Use when asked to commit or split commits.
---

# Commit 工作流

1. 用 `git status --short` 确定范围:用户指定优先;未指定时,有暂存只提交暂存集,否则处理当前变更。只看范围内的一份 `git diff --stat`(暂存集加 `--cached`)。
2. 优先依据本轮任务与修改记录写 message,已理解的改动不重新逐项取证。只有陌生变更、后续编辑或部分暂存影响判断时才补读对应 diff,将相关路径合并到一次调用;陌生新文件单独读内容。信息足以确定提交范围和主题就继续,不设行数预算或逐文件覆盖流程。
3. 只拆已明确独立的改动;同一任务的实现、测试、文档、配置与 lockfile 一起提交。尊重已有暂存分组,不为文件多或跨目录而寻找拆分理由。归属不明或疑似 secrets、调试残留、意外产物不提交并报告;已暂存时暂停受影响组。
4. 使用具体路径暂存,不用 `git add -A` / `git add .`。部分暂存以 `git diff --cached -- <路径>` 为准,不整文件覆盖;需要拆同文件改动时按 hunk 暂存。
5. 提交阶段不额外做代码审查,不重复已适用的验证;缺少仓库要求的验证时补齐,不用 `--no-verify`。message 沿用已知历史风格,未知才读最近 5 条;正文仅在动机或影响需要解释时写。
6. 提交后核对 commit 输出与一次 `git status --short`,简报 hash、主题和未提交项。
