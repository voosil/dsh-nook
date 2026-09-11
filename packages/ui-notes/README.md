# Nook 笔记工作区 UI

包内组织遵循 [UI 规范](../../docs/ui-packages.md)，笔记行为见[笔记契约](../feature-notes/README.md)，共享 Slot 与 RPC 接入见[全局基线](../../docs/discovery.md#product-rpc-and-client-contracts)。

## 部署会话草稿

[部署入口](src/client/lib/sync-deployment.ts)使用公开 Workspace、Session 和 Conversation Controller。官方 Hero 输入区缺少工作区标签时不可用，因此先通过 Nook RPC 准备已存在的 Host 目录，再注册 Workspace、创建并打开绑定的 Session，最后调用 `conversation.input.for(scope).setDraft(text)`。`sessions.create()` 完成后绑定可寻址；`workspaces.create({ path })` 对已有目录幂等。输入仅填草稿，由用户发送。[浏览器验收](../../scripts/verify/notebook-smoke.mjs)覆盖此交接。
