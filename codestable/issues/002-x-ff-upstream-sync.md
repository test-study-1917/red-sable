---
kind: issue
title: '同步 sable-next 上游并保留分叉功能'
type: ff
status: closed
created: 2026-11-10
---

# 同步 sable-next 上游并保留分叉功能

从共同基线 `3b015fc72` 合入 `upstream/main` 的 111 个提交，目标 `dc8ce50622ccdf69f9dc65637401b8edd03a2409`（上游版本 2.3.8）。保留分叉的两个提交及全员结束通话、定制 EC 协议兼容、3001 开发端口、中文 README 和 Serena 配置。上游地址为 `https://git.sable.moe/SableClient/sable-next.git`，已配置为 `upstream`；`origin` 仍指向用户分叉。

- 采用普通 merge，不 rebase 或覆盖分叉历史。同步前恢复点：`backup/pre-upstream-sync-2026-11-10`（`a3e76999d`）。冲突均已解决并完成验证；用户随后明确授权保存一个本地合并提交。不 push 或部署。
- `call-session.svelte.ts`：保留分叉 `#finish` 的单次清理、账号代次与结束通知，接入上游 `#cue` 的声音错误处理及原生音频清理。
- `src/generated/protocol.ts`：从合并后的 Rust 协议重新生成，保留全员结束 RPC/事件，并包含上游新接口。
- `calls/{mod,runtime,runtime_tests,termination_tests}.rs`：将分叉的时间函数调用迁到上游公共 `crate::now_ms`。
- 上游新增 `bridge` 字段但漏改 4 处浏览器 fixture；在 SearchView、RoomNav、RoomOptionsMenu、CommandPalette 的测试数据中补 `bridge: null`，不放宽产品类型。
- `pnpm install --frozen-lockfile` 成功，未手改锁文件。Web release WASM 与 `dist/` 已重新构建。

验证日志：`/tmp/red-sable-upstream-sync/`。

- Rust `cargo test --locked -p sable-core calls::`：173 项通过，包含全员结束的 15 项协议、SDK 接收/迟到解密、重试、并发清理及重入会测试。
- Rust `cargo test --locked -p sable-core timelines::tests::`：11 项通过，包含控制消息不进入隐藏聚合行。
- Node 通话测试：379 项通过；全员结束浏览器组件：8 项通过；隔离 Playwright：2 项通过；补齐 fixture 的 4 个浏览器文件：47 项通过。
- `pnpm check`（Svelte、service worker 和浏览器测试类型）、`pnpm lint`、`pnpm --dir electron check`、Rust 协议生成 `--check`、`cargo fmt --all -- --check` 均通过。
- 已查看本次 Playwright 生成的菜单、确认框、折叠条失败重试截图。`mise exec -- pnpm build` 成功；存在上游构建的 chunk 大小和 service worker sourcemap 警告。
- 本轮未进行真实账号/服务器的跨客户端联调；Electron 完整打包仍沿用 Issue 001 的延期决定，只检查 TypeScript，不扩写为平台验收。

codestable：现有功能契约未改变，Issue 001 保持原验收及 open 状态；无须修改 Project Spec 或 Vision。
