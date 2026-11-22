---
kind: issue
title: 鼠标选中消息后仅右键打开引用菜单
type: ff
status: closed
created: 2026-11-21
---

# 鼠标选中消息后仅右键打开引用菜单

左键拖选消息正文只保留文字选区；在选区上右键才显示「Markdown 引用」与「引用选中内容回复」。触屏长按选字后的菜单行为不变。

- 改动：`src/lib/features/room/timeline/timeline-row.svelte.ts` 只在触屏选字释放后自动打开菜单；`tests/e2e/selected-quotes.spec.ts` 覆盖真实鼠标拖选和右键、触屏模拟及两种引用操作；更新 `docs/message-quotes.md`。
- 验证：Chrome 桌面与 Android 模拟的 8 条浏览器场景通过（不含启动检查）；相关 38 项单元／组件测试、浏览器测试类型检查、ESLint 和格式检查通过。已查看桌面右键前后的界面；Firefox 因本机缺少对应的 Playwright 浏览器未运行。
- CodeStable：无已毕业规格变化；[Issue 004](004-o-ff-selected-message-quotes.md) 的实际房间验收继续保持开放。
