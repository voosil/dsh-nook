# Agent Note: 任务清单 checkbox 与首行文字垂直居中

Status: implemented

## Problem

笔记正文的任务清单（TipTap TaskList）中，checkbox 明显高于首行文字的视觉中心：衬线主题（claude/night，Georgia + 宋体）下尤其扎眼。用户以 `- [ ] markdown的checkbox和文字不对齐` 复现。

实测（Electron Chromium 146，claude 主题）：`.nook-paper .tiptap` 的 `line-height: 1.95`（15px 字号 → 29.25px 行盒）下，TaskItem nodeView 的 `<label><input type="checkbox"></label>` 是 flex `li` 的普通子项，checkbox 保持原生 `display: inline-block; vertical-align: baseline` 的行内布局——13px 的方盒底边落在基线上（行盒顶部下移 6.5px），其中心比行盒中心高约 1.25px；宋体字形的视觉重心更低，观感偏差被放大（像素墨迹分析：checkbox 顶边高出文字顶边 1.5px）。该偏移还依赖浏览器对表单控件 baseline 的实现，跨引擎（如 Safari）差异更大。

## Decision

在 [index.css](../../../../packages/ui-notes/src/client/styles/index.css) 给 `ul[data-type='taskList'] li > label` 新增规则：`display: flex; align-items: center;` 让 checkbox 由 flexbox 在 label 内垂直居中（不再依赖 input 原生 baseline 行为）；`align-self: flex-start` + `height: 1.95em` 把 label 锚定到首行行盒高度（1.95em 与 `.nook-paper .tiptap` 的 `line-height: 1.95` 保持一致，规则处有注释提示同步）。多行/嵌套任务项下 checkbox 因此始终对齐第一行而不是整个条目的中心。

修复后实测：单行任务 checkbox 中心距 `li` 顶部 14.625px = 行盒中心；折行 3 行的任务项 checkbox 仍锚定首行；嵌套子任务同样居中；checkbox 与文字墨迹顶边齐平（原 1.5px 偏差归零）。

## Alternatives considered

`li` 上直接 `align-items: center`：多行任务项的 checkbox 会垂直居中于整个条目而非首行，与主流任务清单（Todoist/Notion/Apple Notes）交互不一致，否决。

保持行内布局、用 `vertical-align: <length>` 微调 checkbox：偏移量依赖原生 checkbox 尺寸与字体 strut，平台/主题差异大，等于把 baseline 实现差异换成魔法数，否决。

## Validation

开发实例（`pnpm dev:clean` 一次性 home，claude 主题）中用 DOM 几何测量验证修复前后（6.5px → 8.125px 首行顶距，中心 13px → 14.625px = 行盒中心），截图 + 像素墨迹分析确认视觉居中；嵌套/多行用与 nodeView DOM 结构一致的静态复现页验证。`pnpm lint:css` 通过；构建产物 `packages/ui-notes/lib/client.js` 已包含新规则（dev watcher 重建 + 官方 HMR 链路生效）。纯 CSS 变更，无类型/契约影响。

## Consequences

checkbox 与首行的对齐不再依赖浏览器表单控件 baseline 实现，所有主题字体一致居中；未来若调整 `.nook-paper .tiptap` 的 `line-height` 或字号，需同步修改 label 的 `height: 1.95em`（规则上方注释已提示）。
