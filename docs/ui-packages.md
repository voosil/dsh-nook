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
