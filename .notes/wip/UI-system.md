# 工具类应用 Figma Design System 规范

**Version 1.0**
适用于 Web / Desktop / Mobile 工具类产品。目标：保证设计一致性、研发可复用性与高频操作效率。

## 1. Figma 文件结构

建议按以下层级组织：

**00 Cover** → **01 Foundations** → **02 Components** → **03 Patterns** → **04 Templates** → **05 Motion** → **99 Deprecated**

组件命名统一使用：

`Category / Component / Variant / State`

例如：

`Input / Text / Default / Focus`
`Button / Primary / Medium / Hover`

禁止使用 `Button 1、Button New、Final Button` 等临时命名。

---

## 2. Foundations / Design Tokens

### Color

颜色禁止直接填写 Hex，应使用 Semantic Token。

| Token            | 用途           |
| ---------------- | ------------ |
| `bg/base`        | 页面背景         |
| `bg/elevated`    | Card / Panel |
| `text/primary`   | 主文字          |
| `text/secondary` | 辅助文字         |
| `border/default` | 默认边框         |
| `action/primary` | 主操作          |
| `status/success` | 成功           |
| `status/warning` | 警告           |
| `status/error`   | 错误           |

同时维护 Light / Dark Mode Variables。

### Spacing

采用 **4px Grid**：

`space-1 = 4`
`space-2 = 8`
`space-3 = 12`
`space-4 = 16`
`space-6 = 24`
`space-8 = 32`
`space-12 = 48`

默认组件内部间距优先使用 **8 / 12 / 16 / 24px**。

### Radius

建议控制为：

`radius-sm = 6`
`radius-md = 10`
`radius-lg = 16`
`radius-full = 999`

同一层级组件禁止随意改变圆角。

### Typography

建议控制在 5 个核心 Style：

`Display`
`Heading`
`Body`
`Label`
`Caption`

工具类产品正文通常以 **14–16px** 为主，避免字号层级过多。

### Elevation

只建立必要层级：

`Elevation 0` 页面内容
`Elevation 1` Card
`Elevation 2` Dropdown / Popover
`Elevation 3` Modal / Floating Panel

优先利用背景差异与边框建立层级，减少重阴影。

---

## 3. Core Components

每个组件必须建立完整 Component Set，并通过 Properties 控制变体。

### Button

Properties：

`Type = Primary / Secondary / Ghost / Danger`
`Size = S / M / L`
`State = Default / Hover / Pressed / Focus / Disabled / Loading`
`Icon = None / Leading / Trailing / Icon-only`

按钮文字使用明确动作：

**Save / Export / Generate / Delete**

避免模糊表达：

**OK / Confirm / Yes**

### Input

必须包含：

`Default / Hover / Focus / Filled / Error / Disabled / Read-only`

结构统一：

`Label + Input + Prefix/Suffix + Helper/Error`

Error 状态必须同时有视觉提示与错误说明，不能只依赖颜色。

### Select / Dropdown

菜单宽度原则上 ≥ Trigger 宽度。

支持：

`Selected / Hover / Disabled / Search / Empty`

长列表应提供搜索或分组。

### Checkbox / Radio / Switch

选择型控件必须有：

`Default / Hover / Focus / Selected / Disabled`

Switch 仅用于**立即生效的状态切换**。

### Tooltip

用于解释图标或陌生概念。

推荐：

`Delay ≈ 300–500ms`

禁止用 Tooltip 承载关键操作信息。

### Toast

适用于轻量操作反馈：

`Success / Info / Warning / Error`

推荐显示时间：

普通反馈 **2–4s**；需要阅读或操作的 Toast 保留更久。

支持 Undo 的操作优先：

`Deleted · Undo`

### Modal

Modal 仅用于需要用户集中处理的任务。

结构：

`Title → Description → Content → Actions`

按钮排列：

`Secondary → Primary`

Danger Modal 必须明确说明操作后果。

### Popover / Context Menu

优先靠近触发对象。

菜单顺序建议：

高频操作 → 次级操作 → 分割线 → 危险操作。

---

## 4. 高频 Pattern

### Empty State

结构：

`状态说明 + 下一步建议 + Primary Action`

空状态不能只是“暂无数据”。

### Loading

<300ms 的请求通常无需展示 Loading。

较长加载：

局部内容 → Skeleton
明确任务 → Progress
不可预估任务 → Spinner

禁止整个页面频繁闪烁。

### Search

搜索框应支持：

`Clear / Keyboard Focus / Recent / Empty Result`

桌面端建议支持：

`Cmd / Ctrl + K`

### Side Panel

工具产品优先使用 Side Panel 处理轻量编辑和详情，减少页面跳转。

关闭后恢复：

滚动位置、选中项、筛选状态。

---

## 5. Motion Tokens

统一维护 Motion Variables / Dev Spec：

| Token         | 参数        |
| ------------- | --------- |
| `motion-fast` | 100–150ms |
| `motion-base` | 180–220ms |
| `motion-slow` | 250–350ms |
| `ease-enter`  | Ease Out  |
| `ease-exit`   | Ease In   |
| `spring-ui`   | 轻量 Spring |

使用规则：

Hover / Press → Fast
Popover / Dropdown → Base
Panel / Modal → Base
页面级 Transition → Slow

动效必须解释：

**来源、去向、状态变化。**

禁止纯装饰性的大幅位移。

---

## 6. Component QA

所有 Figma Component 发布前检查：

* Auto Layout 是否完整
* Hug / Fill / Fixed 是否正确
* 文本增长是否正常
* 极端长文本是否测试
* Light / Dark 是否测试
* 所有 State 是否完整
* Icon 是否统一
* Focus 是否可见
* Disabled 是否仍可阅读
* Loading / Error 是否覆盖
* Component Property 是否语义清晰

---

## 7. 页面设计原则

页面优先遵循：

**一个页面一个核心任务。**

信息层级：

`Page Title → Primary Content → Primary Action → Secondary Information`

复杂工具页面应保持稳定区域：

**Navigation / Toolbar / Workspace / Inspector / Status**

让熟练用户形成空间记忆。

最终验收标准：

**用户能快速理解当前状态、快速找到下一步操作，并且任何操作都有及时且可预测的反馈。**
