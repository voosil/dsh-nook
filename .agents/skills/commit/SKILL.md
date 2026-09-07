---
name: commit
description: Summarize uncommitted changes and commit them, deciding whether mixed modifications must be split into multiple logical commits.
---

# Commit 工作流

## 取证

1. 一次看全:`git status --porcelain`、`git diff HEAD`、`git log --oneline -10`。只看文件名不算取证:必须读 diff 内容判断每处改动的动机;untracked 文件先读内容再归类。
2. 若用户已暂存部分改动,视作其分组意图:先按暂存集提交,再对剩余改动分组。

## 分组

3. 按"为什么改"分组,不按文件类型。一个 commit 只承载一个动机;写 message 时若需要"另外还改了…",就该拆。
4. 必拆:互不相关的 feature / fix / refactor;源码 vs 文档、构建配置等杂务。
5. 不拆:同一改动的伴生物——实现 + 对应测试 + 文档 + lockfile 原子提交,lockfile 跟随触发它的 package.json。
6. 归属拿不准的文件不猜测:问用户,或留在工作区并在汇报中说明。
7. 发现疑似 secrets、调试残留、构建产物:不提交,单独报告。

## 提交

8. 逐组 `git add <具体路径>`(拆分时禁止 `-A` / `.`),message 遵循仓库历史风格(`type(scope): subject`,正文只在需要解释"为什么"时写),不用 `--no-verify`。
9. 完成后用 `git log` + `git status` 验证:每个 commit 主题覆盖其文件;工作区应干净,或只剩用户暂留/报告项。
