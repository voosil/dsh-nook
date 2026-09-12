# Agent Note: 待办正文取消中文输入时保留光标

Status: implemented

## Problem

在待办正文 `（这是一个shili）后续文字` 中，`shili` 尚处于输入法候选状态时，逐字删除或直接取消候选会使光标向后跳。浏览器回归在修改前重现逐字删除后的 DOM 选区偏移从 5 变为 6，正文没有变化却越过了右括号。

## Decision

[RichEditor](../../../../packages/ui-notes/src/client/components/rich-editor.tsx) 通过 TaskItem 的公开 `a11y.checkboxLabel` 配置使用固定中文说明。核实本地 `@tiptap/extension-list@3.31.3` 的 `src/task-item/task-item.ts`：默认 nodeView 将 `node.textContent` 放进正文之前的隐藏 label，并在每次节点更新时重写该说明。候选文本长度变化也改变了前置隐藏文本长度，干扰 Chromium 原生 composition 的位置计算。固定说明消除了这条位置变化来源，复用原生 checkbox 的 checked 状态和既有节点行为。

## Alternatives considered

忽略隐藏 label 的 DOM mutation：只能改变编辑器对 DOM 更新的处理，不能消除原生输入法所见的前置文本长度变化，因此不采用。

在 compositionend 后自行恢复选区：需要记录并映射候选输入期间的位置，还要区分取消与正常上屏；直接使用现有辅助说明配置即可修复，不增加选区补偿逻辑。

## Validation

[浏览器回归](../../../../tests/component/notes/notes-ime.test.ts) 挂载实际 RichEditor 并回传受控 Markdown，通过 Chromium CDP 的原生 composition 接口覆盖逐字清空候选和整段取消，断言 DOM 光标留在右括号前；之后继续候选输入并提交中文，检查文本、保存值以及勾选后的 Markdown。空候选调用模拟输入法处理 Esc 后的取消结果，不是 Windows 输入法候选窗口的人工验收。

已有[列表删除回归](../../../../tests/e2e/notes/notes-list-deletion.test.ts) 的准备步骤增加 End：实测比例字体下 ArrowUp 从 `ccc` 尾部落在 `bbb` 的偏移 2，三次退格会意外退出列表，无法构造测试所需的空项。显式移到行尾消除了字体差异带来的前置条件错误。

完整类型检查和构建、16 项笔记与列表契约测试、上述浏览器回归及空列表项切换回归均通过；文档、格式和包边界检查通过。ui-notes 打包成功，抽查 tarball 确认编译组件包含固定说明，manifest 没有残留 workspace 依赖。本次局部配置修复未运行全量干净 Profile 安装发布门禁。

## Consequences

辅助说明保持固定文字，屏幕阅读器仍能读取 checkbox 的原生勾选状态，但名称不再重复待办正文。未来更换 TaskItem 版本或辅助说明策略时，必须保留原生 composition 回归，不能重新引入随候选文本增长的前置隐藏文字。
