# UI 包代码组织规范

适用于 `packages/ui-*` 的新增代码和重构。组件、TS 逻辑和 CSS 按文件职责分类存放，目录只在有对应文件时创建。运行时边界遵循[仓库规则](../AGENTS.md)，DSH 接入依据[已核实契约](discovery.md#product-rpc-and-client-contracts)。

## 目录约定

| 位置                     | 放什么                                                         |
| ------------------------ | -------------------------------------------------------------- |
| `src/index.ts`           | Host 插件入口。                                                |
| `src/client/index.tsx`   | Client 装配入口：依赖声明、RPC 接入、Slot 注册与生命周期管理。 |
| `src/client/components/` | React 组件（`.tsx`），包括根组件、编辑器和各面板。             |
| `src/client/lib/`        | 非 React 的 TS 逻辑（`.ts`）：API 封装、保存队列、格式化等。   |
| `src/client/hooks/`      | 提取出来的 React hook（通常为 `.ts`），按需创建。              |
| `src/client/styles/`     | CSS 文件及 CSS 导入的类型声明。                                |

## 规则

- Client 根目录只放装配入口；独立组件、TS 逻辑和 CSS 放入对应目录。简单 Slot 展示可内联在入口，不强制每个小组件单独建文件。
- 先在分类目录内平铺，文件较多时再按业务增加子目录。不在组件目录混放独立逻辑文件和 CSS。
- 文件和目录用 `kebab-case`；组件用 `PascalCase`；hook 文件用 `use-xxx.ts`，导出用 `useXxx`。内部文件直接导入，不为每个目录增加转导出的 `index.ts`。
- 组件的 props 类型和短小辅助函数可留在组件文件；独立保存流程、RPC 封装等提取到 `lib/`，复用的 React 状态逻辑提取到 `hooks/`。不设文件行数门禁，不要求每个组件配一个 hook 或 CSS。
- 样式集中在 `styles/`，小包只需一个 `index.css`。

## `@nook-dsh/ui-kit` 组件库与设计 tokens

页面 UI 优先用 `@nook-dsh/ui-kit` 组件构建：`Button` / `Input` / `Textarea`（Field.Control 渲染 textarea）/ `Select`（Select / Combobox）/ `Dialog` / `Tabs` + `TabPanel` / `Menu`（坐标锚定受控菜单）/ `Switch` / `Toast` 均组合 Base UI 公开部件；`Chip` / `Kbd` 为纯展示 HTML，以及 `uiKitStyles` 字符串（tokens + 组件样式，消费端根部 `<style>{uiKitStyles}</style>` 注入一次，位于自身 CSS 之前）。

设计规范收敛为 `--nook-*` CSS tokens，不引用宿主的 `--dsw-alias-*`。完整色值以 [tokens.css](../packages/ui-kit/styles/tokens.css) 为唯一来源。工作区通过 `data-nook-theme` 选择主题，后代浮层继承同一组语义变量。

| 主题              | 属性值   | 视觉                                           |
| ----------------- | -------- | ---------------------------------------------- |
| Nook 纸感（默认） | `paper`  | 纸白、灰绿与自然绿强调色，系统字体             |
| Claude 暖纸       | `claude` | 暖米白、陶土强调色，衬线阅读字体               |
| 夜晚              | `night`  | 炭灰表面、暖白文字、浅陶土强调色，深色原生控件 |

三套主题覆盖背景、表面、导航、交互状态、文字、语义色、焦点和阴影。共用间距、动效与层级；`--nook-font-editor` 表达阅读字体，`--nook-font-sans` 表达界面字体。主题选择即时生效，保存在浏览器当前源的本地存储，并响应同源标签页的偏好变更；存储不可用时保留会话内选择。外观偏好不参与笔记同步。

规则（有门禁强制执行）：

- 新增颜色必须先在 `packages/ui-kit/styles/tokens.css` 加 token；**该文件是仓库中唯一允许出现原始色值的文件**（近似色先并入现有 token，保持色卡小而稳定）。
- 页面侧 CSS 与 tsx 内联样式一律写 `var(--nook-color-*)`，禁止 hex / rgb / hsl / oklch 等字面量。
- 门禁：`pnpm lint:css`（stylelint，`packages/ui-*/src/**/*.css` 与 `packages/ui-kit/styles/**`）和 `pnpm verify:ui-tokens`（tsx/内联扫描，`scripts/verify/verify-ui-tokens.mjs`），已挂进 `pnpm verify` 链（`verify:boundaries` 之后）。
- kit 的 CSS 文件放在包根 `styles/`（不是 `src/`）：tsc 不复制资源进 `lib`，而消费端 bundle 通过 `lib` 解析 kit；`src` 里的导入用 `../styles/*.css` 兄弟相对路径，在 src 与 lib 下解析到同一文件。

## 交互与动效

按钮默认为无可见描边、浅灰绿填充的 secondary，主操作用 `accent`，导航、卡片和编辑器工具用 `ghost`，危险操作用 `danger`。页面样式只调整布局，不以全局 `button` 规则覆盖组件配色。禁用态保留填充层级；悬停和按压通过填充深浅反馈，键盘焦点态显示 outline。危险操作使用浅红填充与危险色文字。

输入框与多行文本框聚焦时不显示额外 outline，仅将现有边框柔和变色，边框宽度和控件尺寸保持不变。工作区全局焦点样式排除这两类组件，搜索选择器内的输入框也遵循相同规则；错误态保留错误边框。

Select 使用 `options`、`value`、`onValueChange`，通过 `variant="ghost"` 提供无常驻底色和描边的辅助选择器，支持禁用项、空态和键盘操作。选项超过七项时使用带搜索输入的 Combobox，也可显式传 `searchable`；弹层宽度至少与触发器一致并限制在视口内。菜单以点击坐标的左上角为锚点，在视口边缘自动避让，危险操作前显示分隔线。

动效统一由 `tokens.css` 的 fast（120ms）、base（200ms）、slow（300ms）与 enter / exit 缓动控制。悬停、按压只改变颜色和描边；菜单、选择器、弹窗和通知使用透明度过渡。导航与卡片不缩放、不弹跳，减少动态效果偏好将时长归零。当前交互使用 CSS 与 Base UI 过渡状态，无需额外动效运行时。

工作区左下角的“设置”打开全屏弹窗。左栏列出“外观”“数据同步”，右侧展示对应内容；窄屏保留左右结构。外观页提供主题预览卡片。数据同步保留状态与配置 tab，活动面板独立滚动，底部操作固定；关闭设置不停止后台同步状态轮询。配置指南往返保留表单草稿。

“工具市集”统一承载“视频转文稿”“日 / 周总结”，通过工具卡片进入各自流程。工作区导航不单列这两个工具。

笔记标题下的项目选择与置顶操作采用紧凑 ghost 控件，与时间信息同层级。置顶状态通过填充星标、文字与 `aria-pressed` 表达，悬停时显示轻量底色。
