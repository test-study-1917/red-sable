---
kind: issue
title: 默认隐藏消息菜单的查看源代码和举报
type: ff
status: closed
created: 2026-11-21
---

# 默认隐藏消息菜单的查看源代码和举报

「设置 → 时间线 → 消息 → 显示额外消息菜单项」默认关闭，仅控制「查看源代码」和「举报」的显示。「已读回执」保留在菜单中。

- 改动：在 `src/lib/settings/registry/timeline.ts` 注册开关，在 `src/lib/features/room/messages/message-menu-items.ts` 统一控制右键菜单、工具栏菜单和触屏操作面板的显示。
- 验证：桌面 Chromium 验证默认隐藏、开启显示、关闭恢复，以及已读回执始终可见；Android 模拟回归触屏菜单。219 项相关单元／组件测试通过，类型、Lint 与格式检查通过。
- CodeStable：无已毕业规格变化。
