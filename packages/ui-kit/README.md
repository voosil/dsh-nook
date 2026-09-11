# Nook UI Kit

公共导出以[包 manifest](package.json)和[源码入口](src/index.ts)为准，接入版本依据见[全局基线](../../docs/discovery.md)。

## 宿主滚动条接入

固定版本的 `dsh-client-ui-theme` 在 `body` 上声明无回退值的 `--dsh-scrollbar-thumb`、`--dsh-scrollbar-thumb-hover` 和 `--dsh-scrollbar-width: 8px`。宿主 WebKit 伪元素使用 8px 布局宽度、透明轨道和 4px 拖块圆角；`@supports not selector(::-webkit-scrollbar)` 分支为 `body` 及后代设置标准 `thin` 和宿主拖块色。

[滚动条样式](styles/scrollbar.css)以主题作用域限定覆盖；后代伪元素选择器的优先级高于宿主裸选择器，未挂到实际滚动元素的选择器不能改变布局宽度。Chromium 的伪元素路径和标准属性路径不能互相替代。[主题验收](../../tests/e2e/theme-scrollbar.test.ts)记录运行时验证，取舍见[决策](../../.notes/implemented/feature/2026-09-11-themed-scrollbar.md)。

`UNKNOWN`：Firefox 与 Safari 的实际渲染尚未运行验证；非 Chromium 路径只核实了固定宿主样式中的条件分支。
