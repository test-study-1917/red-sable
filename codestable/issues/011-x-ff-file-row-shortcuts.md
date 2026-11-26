---
kind: issue
title: 文件列表行内下载和跳转
type: ff
status: closed
created: 2026-11-24
---

# 文件列表行内下载和跳转

```text
[文件图标 · 文件名与详情（打开预览）]   [下载] [跳转到消息]
```

- `RoomFileAttachments.svelte` 保留预览，两个快捷按钮始终可见且触控区不重叠；手机跳转前关闭面板，桌面保留侧栏。`RoomAttachmentFeed.svelte` 为三个按钮保留吸顶月份标题所需的滚动留白。
- 文件列表与消息菜单通过 `src/lib/ui/download.ts` 保存原始字节，沿用下载位置偏好和原生保存反馈。
- 验证：`pnpm check` 与 223 项定向测试通过；桌面 Chromium、320px 的 Android Chromium 和 iOS WebKit 验证实际下载及跳转。文件列表回归用例纳入 `pnpm test:timeline` 的默认 Android／iOS 浏览器模拟和 `pnpm test:e2e` 的 iOS 项目，并已通过两种移动浏览器的定向运行。
- codestable：无 Project Spec 变更。
