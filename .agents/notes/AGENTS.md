# AGENTS.md — 决策笔记(Agent Notes)

决策笔记记录影响本代码库的决策或提案:_为什么_、_放弃了什么_、_怎么验证_——源码与技术契约承载不了的部分。功能现状通过源码和测试检索，不在笔记中再建一份功能手册。规范来自 DeepSeek Harness 上游 `.agents/notes/README.md` @ `0.1.1-rc.2`,已裁剪。文档分层见 [docs/AGENTS.md](../../docs/AGENTS.md)。

## 布局与命名

路径编码一切:`{lifecycle}/{class}/YYYY-MM-DD-topic.md`。

- **lifecycle = 状态**,状态变更 = 移动目录并同步改 `Status:` 行:
  - `proposed/` — 提案,实施前经过评审;尚未构建(或只构建了一部分)。
  - `implemented/` — 决策已落地,全文现在时。代码后续移动文件、改名、改默认值时,同一变更内更新对应事实(仅路径、名称等事实,不改决策本身)。
  - `rejected/` — 已否决的提案,原样冻结;只要它的理由还能防止一次诱人的错误,就保留。
- **class = 决策类型**:`feature`(新能力)/ `architecture`(结构决策)/ `process`(工具与流程)/ `bug-fix` / `simplification` / `testing`(按需启用)。
- 日期 = 主题**首次提出**的日期。
- `wip/` 是草稿区,不受本规范约束;草稿成形后进入 `proposed/` 或 `implemented/`。
- 笔记之间用相对 Markdown 链接引用,不用裸编号。

## 何时写一篇

任何改变行为、结构、跨包契约、流程工具、测试策略或磁盘/线上格式的非平凡变更,都必须在同一变更内新增或更新至少一篇决策笔记;纯机械、局部的修改豁免。已拥有该决策的笔记直接更新,不另建重复篇。 substantial 的未来工作从 `proposed/` 起步;已定的决策直接落 `implemented/`。

**每次新建笔记前先查重**:在 active 树里搜同主题旧笔记,完全被取代的旧笔记在同一变更内归档或合并,部分被取代的保留并互链。

## 文件格式

前三行固定(门禁 `pnpm docs:check` 校验):

```markdown
# Agent Note: <标题>

Status: proposed
```

`Status:` 取值:`proposed` / `implemented` / `rejected — <一行原因>`,必须与所在目录一致。正文以 `## Problem` 开头,动机要写成脱离方案也能读懂。

| lifecycle      | 骨架                                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `proposed/`    | `## Problem` → `## Proposal`(可用将来时;开放问题放这里)→ 自由小节 → `## Alternatives considered` → `## Acceptance criteria` → `## Risks` |
| `implemented/` | `## Problem` → `## Decision`(现在时,描述已落地的事实)→ 自由小节 → `## Alternatives considered` → `## Consequences`                       |
| `rejected/`    | 保留提案原文,结论写在 `Status:` 行                                                                                                       |

**`## Alternatives considered` 强制**:每个真实备选及它为什么输,一段一个。没记录被打败过的方案,等于邀请重新争论一遍。备选只记录真实考虑过的,不臆造。
