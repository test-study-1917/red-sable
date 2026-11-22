---
kind: issue
title: 输入框默认隐藏 GIF 和贴纸按钮
type: ff
status: closed
created: 2026-11-21
---

# 输入框默认隐藏 GIF 和贴纸按钮

默认不显示独立的 GIF 和贴纸按钮，保留表情按钮和 `/gif`。已有的「设置 → 输入框 → 按钮」选项仍可开启这两项，显式保存的偏好不被覆盖。

- 改动：在 `src/lib/settings/definitions.ts` 关闭两项默认值并重新生成设置参考与配置 schema；更新 `tests/e2e/composer-gif.spec.ts`。
- 验证：桌面 Chromium（849×756）和 Android 模拟验证默认布局、`/gif` 与显式开启后的触屏交互；配置与偏好测试通过。
- CodeStable：无已毕业规格变化。
