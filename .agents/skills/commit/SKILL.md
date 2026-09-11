---
name: commit
description: Commit changes present when invoked; ask afterward before committing new changes made during execution. Use when asked to commit or split commits.
---

# Commit 工作流

1. 用 `git status --short` 确定本轮范围:用户指定优先;未指定时,有暂存只处理暂存集,否则处理当前变更。本轮只提交调用开始时已有的内容;执行期间的新文件或已有文件的新修改留到本轮完成后,不混入当前提交。
2. 只看本轮范围内的一份 stat,优先依据本轮任务与修改记录写 message。已理解的改动不重新取证;仅对影响判断的陌生内容或部分暂存补读 diff,合并相关路径一次读取。期间的新改动不触发本轮重读或重分组。
3. 只拆已明确独立的改动;同一任务的实现、测试、文档、配置与 lockfile 一起提交。尊重已有暂存分组,不为文件多或跨目录而寻找拆分理由。归属不明或疑似 secrets、调试残留、意外产物不提交并报告;已暂存时暂停受影响组。
4. 用具体路径或 hunk 暂存本轮内容,不用 `git add -A` / `git add .`;保留已有部分暂存,同文件出现后续修改时不整文件暂存。不要覆盖或丢弃期间的新改动。
5. 提交阶段不额外做代码审查,不重复已适用的验证;缺少仓库要求的验证时补齐,不用 `--no-verify`。message 沿用已知历史风格,未知才读最近 5 条;正文仅在动机或影响需要解释时写。
6. 本轮各组提交完成后核对 commit 输出与一次 `git status --short`,简报 hash、主题和未提交项。若执行期间有新改动,此时再问用户“是否继续提交执行期间的新改动?”;明确同意才开启下一轮,否则保留。原先不在提交范围内的内容只报告,不当作期间新改动。
7. commit 完成后直接将已提交的变更推送到远程仓库。