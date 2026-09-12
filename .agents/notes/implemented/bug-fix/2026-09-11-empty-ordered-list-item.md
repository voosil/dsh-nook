# Agent Note: 空有序列表项在笔记重开后可继续编辑

Status: implemented

## Problem

在笔记里输入 `1. xxx` 后回车，TipTap 自动续出空序号项 `2.`；此时直接离开笔记页再回来，光标无法移动到 `2.` 之后，也无法在该行输入任何文字。用户会看到 `2.` 的序号（浏览器对空 `<li>` 仍渲染 marker），但点击、键盘都无法把光标放入其中。

根因在 pinned 的 `@tiptap/markdown` 3.31.3（`packages/ui-notes/node_modules`）的解析路径：orderedList 扩展注册了自定义 tokenizer（`collectOrderedListItems` + `buildNestedStructure`），空列表项产出 `tokens: []` 的 `list_item`；随后 `parseListItems` 直接构造 `listItem` 节点，缺少 `ListItem.parseMarkdown` 里「内容为空时补一个空段落」的兜底（该兜底 taskItem 与无序 bullet 路径都有）。于是 markdown `1. xxx\n2. ` 往返后得到 `listItem content: []`，不满足 schema 的 `paragraph block*`。

两个可见后果：其一，DOM 里渲染出空 `<li>`，其内没有可编辑的 paragraph，光标无法定位、输入无效；其二，损坏形状会让 `getMarkdown()` 直接抛错——`renderNestedMarkdownContent` 把空数组解构成 `undefined` 再喂给 `renderChildren`，而 RichEditor 的内容同步 effect 在组件挂载后第一时间调用 `getMarkdown()` 比较 markdown，异常会打断该 effect 与后续保存。

## Decision

Nook 侧新增 [fill-empty-blocks](../../../../packages/ui-notes/src/client/lib/fill-empty-blocks.ts) 扩展（`FillEmptyBlocks`），不修改上游源码（仓库规则禁止编辑 `node_modules`），在两个入口补齐 schema 必填内容：

- **初始文档（`onBeforeCreate`）**：该钩子注册在 Markdown 扩展之后，此时 Markdown 已把 `options.content` 解析成含损坏形状的 JSON。扩展用 schema 对 JSON 做 `nodeFromJSON` 检查并把修复结果写回，随后 `createDoc` 构建的初始文档即合法。这发生在任何 React effect 之前，挂载时的首次 `getMarkdown()` 不再崩溃。
- **运行时事务（ProseMirror 插件 `appendTransaction`）**：任何 `docChanged` 的事务之后重新检查文档，覆盖 `setContent` 等在 `onBeforeCreate` 之外的解析路径。补齐操作直接应用到 `newState.tr`，通过局部位置映射保留光标与选区；初始文档修复与运行时事务共用同一补齐函数。

修复规则不针对具体节点类型：对每个内容为空的节点，用 `contentMatch.fillBefore(Fragment.empty, true)` 判断 schema 是否要求非空子内容，成立则以 `createAndFill` 补齐并从后往前替换。该规则只能产出 schema 合法的节点，同时覆盖 listItem、taskItem、blockquote 等可能出现的同类缺口；对合法文档是精确的 no-op。修复后的文档再序列化仍输出 `1. xxx\n2. `，往返稳定。

## Alternatives considered

把修复后的整篇文档通过 `replaceWith(0, size, fixed.content)` 写回事务：整篇替换会把正文中的选区映射到文末，覆盖 RichEditor 在 `setContent` 后恢复的位置，导致后续输入落到错误位置。逐项替换只调整局部位置，保留修复区域之外的选区及其方向。

覆盖（override）`orderedList`/`ListItem` 的 `parseMarkdown` 修正解析结果：损坏点在 extension-list 内部的 `parseListItems`，要走通就得整体重写其 tokenizer 与解析工具，跟随 pinned 版本升级时维护成本高且易漂移；填平最终文档形状比复刻上游解析逻辑稳。

升级 @tiptap 依赖绕开缺陷：缺陷存在于 pinned 3.31.3，依赖版本是独立决策且无法确认上游已修；本次不绑定升级，插件在未来版本修复后自然退化为空操作，可随后移除。

在 RichEditor 里自建一个 `MarkdownManager` 先解析、规范化后再 `setContent`：解析前后需要两个 manager，自定义 tokenizer 会注册到共享的 `marked` 单例上，多一条状态线；且初始 content 的解析仍发生在编辑器构造内部，同样需要在 `onBeforeCreate` 收口，不如一处扩展承担两个入口。

只加 ProseMirror 插件、不加 `onBeforeCreate`：初始文档由 `EditorState.create` 直接构建、不经事务分发，`appendTransaction` 在首个用户操作前不会运行，挂载期的 `getMarkdown()` 崩溃无法避免。

## Validation

[契约测试](../../../../tests/unit/notes/notes-markdown.test.ts)七个用例：断言 pinned 版本确实解析出 `listItem content: []`（记录缺陷形状）、`fixEmptyBlocks` 修复后通过 `doc.check()` 且重序列化回原文、插件在事务后修复并可在原空项内输入文字、合法文档（含空 bullet/task 项与空标题）零改动，以及 Markdown 内容刷新时多个空项之前的光标、反向选区和之后的光标保持原段落内的位置与方向，后续输入落点正确。加强的原有光标断言及三个刷新用例在整篇替换实现上均失败，在局部事务实现上均通过。[端到端测试](../../../../tests/e2e/notes/notes-empty-list-item.test.ts)驱动真实 UI 复现用户路径：输入 `1. xxx` 回车自动续出 `2.`，切走再切回后点击空项输入文字，内容落在 `2.` 项且再往返不丢，全程无 `pageerror`。

## Consequences

空列表项、空引用块等「schema 要求非空内容」的形状在进入编辑器时一律被补成合法节点，挂载、`setContent` 与后续编辑路径统一；`getMarkdown()` 不再因损坏形状崩溃，自动保存链路恢复正常。代价是每次 `docChanged` 事务后多一次整树扫描（仅扫描空内容节点，常规笔记开销可忽略）。若上游在后续版本补齐 `parseListItems` 的空段落兜底，本扩展成为无害空操作，届时可评估移除；若新增自定义容器节点（要求非空子内容），无需再为其单独处理解析缺口。
