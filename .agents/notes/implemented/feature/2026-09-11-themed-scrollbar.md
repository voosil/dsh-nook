# Agent Note: 主题化细滚动条

Status: implemented

## Problem

Nook 工作区的滚动条一直沿用宿主 `dsh-client-ui-theme` 的全局样式：`body` 上的宿主灰、8px 布局宽度、悬停变深。四套主题只改了容器与控件的颜色，滚动条仍是宿主的冷灰——夜晚主题下偏亮的灰、暖纸主题下偏冷的灰都与所在表面冲突；侧栏笔记列表、编辑器、设置面板等滚动区域的滚动条也比 Nook 的视觉密度更重。

## Decision

`packages/ui-kit/styles/scrollbar.css` 把滚动条纳入 `--nook-*` 色卡，随 `uiKitStyles` 注入：

- `[data-nook-theme]` 作用域重新声明拖块与悬停色 token，并按宿主契约绑定 `--dsh-scrollbar-thumb`——标准属性路径（Firefox 一类不支持 `::-webkit-scrollbar` 的引擎）读它取色，否则会沿继承拿到 `body` 上的宿主取值。
- WebKit 路径用 `[data-nook-theme] ::-webkit-scrollbar` 声明 `--nook-scrollbar-width: 6px` 并只画拖块，轨道与角落保持透明，悬停用 `--nook-color-scrollbar-thumb-hover` 提亮一档。
- 四套主题各加 `--nook-color-scrollbar-thumb` 与 `--nook-color-scrollbar-thumb-hover` 两条 token：浅色主题用低透明度墨色或炭色，夜晚主题用低透明度暖白，随所在表面自然融合。

拖块颜色按主题取所在墨色的低透明度值，静置态足够轻、悬停态可辨认，不引入描边或阴影。宿主自身的滚动条（工作区之外）不变。

## Alternatives considered

- **只跟随主题、不改宽度**：宿主 8px 与 Nook 的视觉密度不匹配，「窄」这一半需求落空；6px 与 `--nook-space-*` 的节奏一致，且不改变行高与命中区域的可用性。
- **绑定宿主的 `--dsw-alias-*` 别名取色**：能让滚动条直接跟随宿主主题，但 Nook 是固定纸感产品，[UI Kit 决策](2026-09-10-nook-ui-kit.md)已明确不引用宿主别名层，滚动条不例外。
- **全局 `::-webkit-scrollbar` 收窄**：可少写一个作用域前缀，但会一并改掉宿主 AI 对话界面的滚动条，越过「只作用于 Nook 自有工作区及其 Portal 后代」的边界。
- **自绘滚动条组件**：能控制淡入淡出与圆角细节，但要接管滚动、命中与键盘行为，成本远超配色收益。
- **拖块常驻不透明度做悬停反馈**：省一条 token，但静置态会明显偏重，与「轻」相悖。

## Consequences

- 滚动条配色与宽度只由 `tokens.css` 的 token 与 `scrollbar.css` 的绑定决定；新增主题时补两条 token 即自动生效。
- WebKit 伪元素路径会关闭原生悬浮滚动条并占用布局宽度，滚动区域内容宽度因此比纯悬浮时窄 6px（与宿主既有行为同类，只是更窄）；标准属性路径仍是 `thin`。
- 主题作用域内的滚动条由 Nook 接管，作用域外的宿主滚动条保持宿主样式。

## Validation

[主题滚动条验收](../../../../tests/e2e/notes/theme-scrollbar.test.ts)在真实 Host 中逐套切换外观，断言每套主题解析出自己的拖块与悬停色、作用域内 `--dsh-scrollbar-thumb` 等于 Nook token 且不同于 `body` 的宿主取值、胜出的 `::-webkit-scrollbar` 宽度规则为 `var(--nook-scrollbar-width)`，并在引擎报出布局宽度时断言实际 gutter 等于 6px；[笔记本验收脚本](../../../../tests/helpers/scenarios/notebook.mjs)的外观切换循环复用同一组断言，并额外要求四套主题的拖块与悬停色互不相同。

Chrome（有头与无头）实测：作用域内 gutter 6px、`scrollbar-color` 解析为 Nook 色，作用域外宿主滚动条保持 8px 布局宽度与宿主色；四套主题切换时 token 即时跟随。类型检查、构建、样式与色值门禁通过。
