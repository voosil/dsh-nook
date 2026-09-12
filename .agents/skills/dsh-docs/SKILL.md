---
name: dsh-docs
description: Place, write, and check Nook documentation and decision notes against the repo's doc standard.
---

# Nook 文档工作流

规范本体在 [docs/AGENTS.md](../../../docs/AGENTS.md)(文档分层与写作规则)和 [.agents/notes/AGENTS.md](../../../.agents/notes/AGENTS.md)(决策笔记规则);本 skill 只承载操作顺序。

## 放置

1. 按[文档标准](../../../docs/AGENTS.md)先判断内容是否能指导 Agent 编码，再决定归属；删除功能介绍和源码已表达的低信息量复述，不用搬目录代替删冗余。
2. 一个事实只有一个家:目标 tier 已有该事实时链接过去,不重述;目标文档没有该事实的家时,先决定它属于哪一层,再写。

## 决策笔记

3. 新建笔记前先在 `.agents/notes/` 查同主题旧笔记;完全被取代的在同一变更内合并,部分被取代的互链保留。
4. 按生命周期骨架写,`## Alternatives considered` 必须有;状态行与所在目录一致。

## 校验

5. 提交前运行 `pnpm docs:check`(相对链接可达性 + 笔记格式),失败按提示修复。
6. 文档随代码同变更更新：更新受影响的既有契约与 owning 笔记；普通功能变更不要求新增说明文档或扩写 `docs/`。
