# Agent Note: 嵌套有序列表按层级换序号样式

Status: implemented

## Problem

笔记正文的多级有序列表在编辑器里每一层都渲染阿拉伯数字(`1.`),四层嵌套时肉眼无法区分层级,阅读和编辑都要靠缩进距离猜测归属。用户期望的层级序号是 `1.` → `α.` → `①` → `a)` 这套递进。

序号是浏览器对 `<ol>` 的渲染产物,不是笔记数据的一部分:markdown 里有序列表项不携带序号样式,`getMarkdown()` 往返也不受影响。因此这纯粹是展示层决策,落在编辑器 CSS 即可;笔记历史 diff 与 markdown 导出本来就不渲染 marker,无需改动。

## Decision

[editor 样式](../../../packages/ui-notes/src/client/styles/index.css)新增按嵌套深度的 `list-style-type` 规则,作用于 `.nook-paper .tiptap` 内的有序列表:

- 第 1 层 `decimal`(`1.`),维持原样;
- 第 2 层 `lower-greek`(`α.`,浏览器内建);
- 第 3 层自定义 `@counter-style nook-list-circled`(`①`–`⑳`,fixed 系统,超过 20 项停在同一符号);
- 第 4 层及更深自定义 `@counter-style nook-list-alpha-paren`(`extends lower-alpha`,后缀 `)`)。

选择器按 `ol ol` 祖先链计数深度,不依赖 Tiptap 节点属性,对粘贴进来的既有嵌套列表同样生效。两个 `@counter-style` 定义在 `.nook-paper` 规则旁,属于 ui-notes 自有样式,不进 ui-kit tokens。

## Alternatives considered

用 `::marker` 的 `content` 自绘序号:需要按 `counter()` 逐层拼前缀,且 Chromium 对 `::marker` 的 computed `content` 恒返回 `normal`,无法程序化断言实际字形;`list-style-type` + `@counter-style` 是标准路径,marker 前缀(`. ` 与 `) `)由 counter-style 的 `suffix` 表达,不引入额外 DOM。

把序号写进 ProseMirror 文档(自定义 listItem 属性或直接改文本):污染 markdown 数据,往返与导出都要特判,且编辑行为(回车续项、Tab 降级)全要重写,为展示需求改数据模型不成比例。

只改到第三层、第四层沿用数字:用户明确给了四层方案,`a)` 用 `extends lower-alpha` 一行即可表达,没有省略的理由。

## Validation

[端到端测试](../../../tests/e2e/notes-list-numbering.test.ts)驱动真实 UI:逐层输入并 Tab 下钻构造四层有序列表,断言四个 `<ol>` 的 computed `list-style-type` 依次为 `decimal` / `lower-greek` / `nook-list-circled` / `nook-list-alpha-paren`,截图人工核验 marker 字形为 `1.` / `α.` / `①` / `a)`,切走再切回经 markdown 往返后结构与样式不变,全程无 `pageerror`。Chromium 对 `::marker` 的 computed `content` 恒返回 `normal`,该探针不可用,故字形以截图为准。`pnpm lint:css` 与 typecheck 通过;既有列表 e2e(空项编辑、中间删除)不依赖 marker 样式,不受纯 CSS 变更影响。

## Consequences

编辑器内嵌套有序列表的层级一眼可辨,第 5 层起沿用 `a)` 风格;序号仍是渲染产物,markdown 源文与导出保持标准语法。`@counter-style` 在 Chromium/Firefox/Safari 均已支持,无兼容负担;若未来导出 HTML/PDF 需要,同一 counter-style 可随样式表复用。超过 20 项的第三层列表从第 21 项起停留在 `⑳`,极罕见,可接受。
