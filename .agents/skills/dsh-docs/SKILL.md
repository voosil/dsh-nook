---
name: dsh-docs
description: Place, write, and check Nook documentation and decision notes against the repo's doc standard.
---

# Nook 文档工作流

规范本体在 [docs/AGENTS.md](../../../docs/AGENTS.md)(文档分层与写作规则)和 [.notes/AGENTS.md](../../../.notes/AGENTS.md)(决策笔记规则);本 skill 只承载操作顺序。

## 放置

1. 先分层,再动笔。现状 → `docs/`;外部 DSH 事实 → `docs/discovery.md`;决策与过程 → `.notes/{proposed,implemented,rejected}/`;草稿 → `.notes/wip/`。
2. 一个事实只有一个家:目标 tier 已有该事实时链接过去,不重述;目标文档没有该事实的家时,先决定它属于哪一层,再写。

## 决策笔记

3. 新建笔记前先在 `.notes/` 查同主题旧笔记;完全被取代的在同一变更内合并,部分被取代的互链保留。
4. 按生命周期骨架写,`## Alternatives considered` 必须有;状态行与所在目录一致。

## 校验

5. 提交前运行 `pnpm docs:check`(相对链接可达性 + 笔记格式),失败按提示修复。
6. 文档随代码同变更更新:改了行为,同变更更新 owning 笔记与 `docs/` 现状文档。
