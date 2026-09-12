# Agent Note: Nook UI Kit、设计 tokens 与硬编码色值双门禁

Status: implemented

## Problem

Nook 的 UI 此前散落四处且互相独立实现按钮/弹窗/菜单/提示：

- `ui-notes` 携带 ~2800 行组件加 1079 行手写 CSS，含 43 种硬编码色值、自制 modal / action-menu / export-toast / roving tabs，以及全局 `button` / `input` 重置；
- `ui-sidebar` / `ui-project` 用内联样式加硬编码 `oklch()` 与 `--dsw-alias-*` 别名；
- `ui-knowledge` 用原生 checkbox / select 加零散内联样式。

视觉与交互各处漂移、无障碍能力（焦点圈、Esc、键盘漫游）靠手写维护，且没有任何机制阻止新代码继续写死颜色。

色值门禁原先手写五个 UI 包的扫描名单，新增 `ui-tasks` 后遗漏覆盖，检查仍能通过；因此检查通过不能证明新包遵守约束。

## Decision

新建 `packages/ui-kit`（`@nook-dsh/ui-kit`），四个 ui 包全部迁移为唯一消费方：

- 交互组件基于已安装的 base-ui `@base-ui-components/react@1.0.0-rc.0` 公开部件：Button、Input、Field.Control（通过 render 组合 textarea）、Select / Combobox、Dialog / AlertDialog、Tabs、Menu、Switch、Toast。Select 对外采用值与选项契约，长列表提供搜索；Chip、Kbd 保持纯展示 HTML。图标由调用方传 lucide 节点，kit 不依赖 lucide。
- 设计规范收敛为 `--nook-*` tokens（Nook 纸感色卡）：值取自迁移前的调色板并做了归并——十余个只差一两档的灰绿近似色统一为 `ink` / `ink-muted` / `ink-faint`、`hover` / `sunken`、`accent` / `accent-strong` / `accent-soft` 等少量 token；色卡以 `tokens.css` 为唯一来源。主题扩展及设置入口见[外观与工具市集](2026-09-10-appearance-settings.md)，不引用 `--dsw-alias-*`，不随宿主主题变化。
- CSS 注入沿用包内 `import css from '*.css'`（字符串）加根部 `<style>` 的既有模式；`uiKitStyles` 在消费端自身 CSS 之前注入，重复注入同文本无副作用。kit 的 CSS 放包根 `styles/`：tsc 不复制资源进 `lib`，消费端 bundle 经 `lib` 解析 kit，`src` 内用 `../styles/*.css` 兄弟相对路径使 src 与 lib 解析到同一文件。
- 双门禁：根 `stylelint.config.mjs`（`color-no-hex` + `function-disallowed-list`，仅 `packages/ui-kit/styles/tokens.css` 豁免）与 [色值扫描脚本](../../../../scripts/verify/verify-ui-tokens.mjs)（从 `packages/` 自动发现全部 `ui-*` 目录，扫描 ts/tsx/css，仅同一色卡路径豁免；无匹配目录时失败），`pnpm lint:css` / `pnpm verify:ui-tokens` 已插入 `pnpm verify` 链的 `verify:boundaries` 之后。
- 迁移即清理：删除 ui-notes 本地 `button.tsx` / `action-menu.tsx` / `export-toast.tsx`，`index.css` 删除全部被 kit 覆盖的组件样式块（按钮/输入全局重置、`.nook-modal` 弹窗、`.nook-action-menu`、`.nook-export-toast`、`.nook-sync-tabs` 等），保留布局/响应式/tiptap 内容样式并把颜色全部换成 token。
- 消费端接线：ui-sidebar / ui-project / ui-knowledge 依赖 `workspace:*` 并补 `react-dom` peer（base-ui portal 需要它）；根 tsconfig `references` 与 `scripts/profile/profile-lib.mjs` 的 `LOCAL_PACKAGES` 登记 ui-kit。

参考 [UI 系统草稿](../../wip/UI-system.md)，交互时长、按钮层级与弹层定位由 kit 统一。按压不缩放；secondary 用浅灰绿填充建立可辨识的操作区域，不显示描边；删除页面全局按钮重置以保护主按钮对比度。同步弹窗布局决策见[同步设置](../simplification/2026-09-09-sync-settings-layout.md)。

## Alternatives considered

- **手工补入 `ui-tasks` 或复用 Profile 包名单**：前者保留新增包时再次漏检的入口，后者仍依赖运行时组装名单的人工登记；静态约束应覆盖磁盘上的全部同类包，因此直接按目录发现。
- **官方 dsw 主题别名（`--dsw-alias-*`）**：能跟随宿主主题，但 Nook 是固定纸感产品，别名层会引入第二套颜色事实；sidebar 按钮此前对深色宿主的适配也因固定配色而放弃。输在多一层抽象与失控的主题耦合。
- **手写 Toast 与原生 Select 封装**：代码较少，但交互行为与其余组件分散，选择器缺少可控弹层及搜索。统一采用 Base UI Provider / Viewport / Root 和 Select / Combobox，调用方仍负责业务 action 节点。
- **tokens 直接内嵌在 components.css 里**：单文件更少，但色卡与组件样式混在一起会稀释「唯一色值文件」的边界，双门禁的豁免粒度也不干净；拆成 `tokens.css` + `components.css`。
- **继续手写 roving tabs / Escape / 焦点恢复**：行为基准已经写好（`action-menu.tsx`），但 base-ui 原生覆盖同样的契约且更完整；手写版仅在 kit 出现前有意义，已随迁移删除。

- **增加 Motion 依赖**：本次需求是高频控件颜色反馈和浮层淡入淡出，CSS tokens 与 Base UI 的生命周期状态已覆盖。没有共享布局或手势动画需求，因此不增加另一套动画运行时。

- **默认按钮描边**：密集工具页面会出现过多独立框线，干扰内容阅读。默认次操作采用浅填充与深色文字，危险按钮采用浅红填充；仅键盘焦点显示轮廓，导航和工具栏继续使用 ghost。

输入框和多行文本框使用现有边框变色表达焦点，不叠加外圈；ui-notes 的全局焦点规则排除这些组件，避免重新覆盖 kit。双层边框会加重表单视觉，因此不用于文本输入焦点。

笔记元信息中的项目选择使用 Select 的 ghost 变体，置顶使用 ghost 按钮和 `aria-pressed`。常驻控件保持透明，置顶仅强调星标与文字，避免辅助操作抢占正文层级。

## Consequences

- 任何 UI 颜色改动只有一个入口（tokens.css），近似色继续归并；`pnpm verify` 中两道门禁拦截字面量回归。
- base-ui 固定在 `1.0.0-rc.0`；升级到 1.0.0 稳定版时以安装后 `node_modules` 的 parts 类型为准核对组合方式，kit 对外签名不变。
- 明暗外观使用相同语义 tokens，由 Nook 自己的主题选择器控制，不依赖宿主主题。
- kit 是纯库（无 `dsh.client.inject`、无 slot 贡献、无 Cordis 服务），不参与 Profile slot 组合，仅经 esbuild 打进各消费端 bundle。

## Validation

组件浏览器验收覆盖按压尺寸、键盘选择、禁用项、长列表搜索、弹窗嵌套选择、焦点返回、右键锚定与视口避让、Textarea、Switch、Toast 和 reduced-motion。真实 Profile 验收沿用笔记与同步操作路径，并增加 tab 切换尺寸稳定断言。

类型检查、完整构建、86 项契约与桌面测试（1 项跳过）、20 项集成测试（2 项跳过）、组件浏览器验收、颜色与边界门禁、文档检查通过。干净安装验收打包并安装 37 个 Nook 包，核对 25 个 Profile 行，完成真实 Host 的笔记、项目、导出、同步导入与停启流程。桌面与 390px 窄屏同步弹窗截图经检查，tab 切换外框尺寸断言通过。所有运行时验收使用隔离的开发或临时 DSH_HOME。

Base UI 契约依据安装版本的公开类型及对应实现核实。坐标菜单显式关闭箭头预留偏移，采用 fixed 定位；单条 Toast 的关闭按钮保持可访问；自定义弹窗名称显式覆盖标题关联，保留危险确认与总结、视频弹窗的可访问名称。
