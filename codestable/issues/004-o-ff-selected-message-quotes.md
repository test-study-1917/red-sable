---
kind: issue
title: 消息选区的 Markdown 引用与引用回复
type: ff
status: open
created: 2026-11-12
---

# 消息选区的 Markdown 引用与引用回复

实现与本地验证已完成，保留开放状态供用户实际房间体验验收。

选中消息正文后，同一菜单提供「Markdown 引用」与「引用选中内容回复」。前者在当前编辑模式插入引用块，后者保留原消息关系、全文快照和精确选区；发送后可在回复中展开／收起原文，并跳转到原消息高亮相同片段。

## 实现范围

- 消息菜单、时间线选区与高亮、房间／线程输入框、回复草稿和完整发送链路。
- Rust 核心通过 `moe.sable.selected_quote` 保存并投射引用元数据，包括本地回显；标准 Matrix 回复关系保留。
- 附件、图片集、贴纸、GIF、位置回复保留同一选区。Web Worker、Tauri 与 WebSocket 服务器传输均转交引用信息。
- 正式生成 `src/generated/protocol.ts`，重新构建 `src/generated/wasm/`。中英文标签与用法见 `docs/message-quotes.md`。

## 验证结果

- 上轮前端组件／单元测试 492 项通过；桌面 Chromium 与 Android 模拟的选区菜单、两种编辑模式、发送、展开／收起、重复文本精确定位和虚拟化跳转共 8 项浏览器测试通过，已检查桌面与移动端截图。本轮保留这些仍适用的交互证据。
- 本轮补充附件、图片集经过客户端媒体入口、Web Worker、Tauri、WebSocket 的引用元数据断言，覆盖中文和 emoji；原来的无选区发送仍覆盖。相关 5 个文件的 182 项测试通过（与上轮测试范围有重叠，不相加）。
- `cargo test --locked -p sable-core --features typegen --lib selected_quote --jobs 1` 的 4 项测试全部通过：出站额外字段合并、发送队列快照、同步接收后投射、标准回复关系随附选区元数据。
- Rust `generate-types` 正式生成协议类型，生成器 `--check` 通过。
- `pnpm check` 通过：Svelte 无错误、无警告，Service Worker 和浏览器测试类型检查通过。
- 改动的 Svelte 样式检查、相关前端格式与 lint 检查通过。
- `node scripts/build/build-wasm.mjs` 完整通过，包含 wasm-bindgen 0.2.130 绑定生成和 WASM 指令验证。浏览器实际加载新 WASM，调用 `messages.markdown_to_content` 得到包含中文、emoji 的正确 `<blockquote>`，登录入口正常呈现。

## 用户体验验收与运行条件

- 本地预览入口：`http://127.0.0.1:4175/`。登录后选中消息正文，使用两种引用入口体验。
- 移动端自动化使用 DOM Range 建立选区并验证菜单、发送和展示；Linux Chromium 的触屏模拟在独立纯文本页面也不会建立原生长按选区，原生系统选区手势仍需真机体验确认。
- Web WASM 已本地更新。服务器连接模式需同时重新构建／部署更新后的服务端，原生客户端需重新构建；本次未执行远程部署。
- 无已毕业规格变化；不自动关闭、提交或推送。

## 中断续接与本机工具记录

重启清空了 `/tmp` 内临时 C 编译器包装。续接时恢复 `/tmp/sable-cc`，将 Rust 的 `--target=x86_64-unknown-linux-gnu` 转换成 Zig 接受的 `--target=x86_64-linux-gnu`；未修改仓库工具链配置。本机复用邻近工作区 `.build-tools` 中已安装的 Rust 1.99.0。锁定版本 wasm-bindgen 0.2.130 放在 `/tmp/red-sable-wasm-tools`，旧本地工具 0.2.129 不适用。

核心测试与 WASM 构建串行执行，避免核心测试编译约 5 GiB 的峰值内存与其他构建争抢；核心验证关闭 debug symbols、使用单任务编译。类型检查使用项目默认 4 GiB Node heap，2 GiB 不足以完成完整检查。

本轮日志（临时目录，重启可能清空）：`/tmp/red-sable-media-tests.log`、`/tmp/red-sable-core-tests.log`、`/tmp/red-sable-typegen.log`、`/tmp/red-sable-check.log`、`/tmp/red-sable-wasm-build.log`。

## 引用样式反馈：融入三种原生回复样式

用户反馈独立引用卡片外观突兀、展开原文显得疏松；改为沿用时间线「连接线／紧凑卡片／展开卡片」设置。

目标结构（当前实现）：

```text
连接线：   ┌ Alice · 引用片段                        [⌄]
           │ 原文上下文……【引用片段】……（展开时显示）
           └ [头像] 回复者
                    回复正文
紧凑卡片： ↪ Alice · 引用片段                        [⌄]
             原文上下文……【引用片段】……（展开时显示）
展开卡片： ▌↪ Alice                                [⌄]
          ▌  引用片段
          ▌  原文上下文……【引用片段】……（展开时显示）
```

- 三种样式各自保留原生位置、连接线／背景／强调色，移除片段引用专属外框；原消息跳转仍由引用摘要触发。
- 展开／收起改成带可访问名称、状态与提示的小箭头，移除底部重复的跳转操作栏。
- 展开正文行高 1.35，段落和换行内容原样保留，间隔缩为 4px，最长显示 12rem 后内部滚动。
- 连接线锚定引用摘要，展开时延长至回复者；头像根据预览实际高度对齐。紧凑聊天布局的悬浮工具栏移至引用区域上方，不遮挡展开按钮。手机保持同一行结构，按钮点击区增至 32px。
- 验证完成：50 项时间线组件测试通过；三种回复样式 × 三种聊天布局 × 桌面／Android 模拟的 18 个场景全部通过（测试运行含 warmup 共 19 项）。另以桌面和 Android 检查了自己发送的展开卡片，确保引用者姓名与预览正文末端对齐。已实际查看桌面和移动端折叠／展开截图。
- 本轮改动前半段的发送、折叠／展开、重复文本定位、虚拟化跳转及长原文首尾片段检查继续通过；修正了长原文测试中末尾场景误用开头位置的问题。
- `pnpm check` 无错误、无警告；相关 ESLint、Stylelint 和格式检查通过。本次只改前端与说明，不重新构建 Rust／WASM。
- 截图：`test-results/quote-style-{connected|compact|expanded}-{modern|compact|bubble}-{desktop|mobile}-{collapsed|expanded}.png`。日志：`/tmp/red-sable-reply-style-final-e2e.log`、`/tmp/red-sable-reply-style-alignment.log`、`/tmp/red-sable-reply-style-final-unit.log`、`/tmp/red-sable-reply-style-check.log`。

## 原消息片段高亮限时与淡出（2026-11-13）

- 点击片段引用后，从本次点击起计时 60 秒：前 55 秒保持高亮，最后 5 秒逐渐淡出背景、文字强调色与下划线，满一分钟移除标记并清空引用目标。
- 点击另一处片段引用立即转移高亮并重新计时；再次点击同一引用也重新计时。普通消息更新、滚动卸载／重新挂载不会刷新时限，重新挂载时续接原来的淡出进度，到期后不会再次出现。
- 计时与动画统一放在 `messages/quote-focus.svelte.ts`，引用摘要使用同一入口，时间线行负责挂载与清理。展开引用预览中的片段标记和原有整条消息跳转动画保持原行为。用法已同步 `docs/message-quotes.md`；不涉及已毕业 Project Spec 变化。
- 验证：相关 3 个文件的 62 项单元／组件测试通过；新增桌面 Chromium 与 Android 模拟浏览器场景均通过（加 warmup 共 3 项），检查了淡出动画实际插值、转移与重复点击刷新、旧定时器不误清除新目标、到期清除及展开预览仍保留标记。已查看桌面完整高亮／半淡出和移动端半淡出截图。
- `NODE_OPTIONS=--max-old-space-size=4096 pnpm check` 通过，Svelte 无错误、无警告；相关 ESLint 与格式检查通过，新增计时模块及其测试的 type-aware Oxlint 通过。对既有时间线／浏览器测试文件扩展 type-aware 检查时，仍有未改动行的既有诊断，本次未扩展处理范围。
- 本机浏览器缺少的 `libnspr4`、`libnss3`、`libasound2t64` 仅下载并解压至 `/tmp/red-sable-browser-deps/root`；浏览器测试需设置 `LD_LIBRARY_PATH=/tmp/red-sable-browser-deps/root/usr/lib/x86_64-linux-gnu`。未修改系统安装。
- 截图：`test-results/quote-highlight-{full|fading}-{1280|412}.png`；日志：`/tmp/red-sable-quote-highlight-{tests|focus-tests|browser|check}.log`。

## 合并前审核修复：代码块控件不进入引用快照（2026-11-13）

- `selected-quote.ts` 的共享文本投射排除 `.code-head`，不再将代码语言标签、复制和展开／收起按钮文字保存为原文；重复代码片段的定位不受控件状态或语言变化影响。
- 增补单元回归及 `selected-quotes.spec.ts` 浏览器场景：展开第二个重复代码块后选择并发送，断言快照只含正文，重新挂载恢复折叠后仍高亮第二处，展开引用不夹带控件文字。
- 相关 3 个文件的 65 项单元／组件测试通过；桌面 Chromium 与 Android 模拟的新增回归均通过（含 warmup 共 3 项）。浏览器测试类型检查、格式检查通过；前轮未受影响的发送与媒体传输检查继续适用。
- 无已毕业 Project Spec 变化；保留真机原生长按选区的验收边界。
- 提交钩子同时修正同文件两处既有 void 回调写法；对递归闭包更新换行标记的 type-aware 误报作单行说明与抑制，保留真实尾随换行的既有测试和行为。
