---
type: ff
status: open
---

# 固定 SDK 源码，恢复 Pages 构建

- 做了什么：将上游原提交 `f609388c27bd03ad0234c266bde8f778faacc600` 保存到公开仓库 `test-study-1917/matrix-rust-sdk`，以 `red-sable-pinned` 分支及 `red-sable-sdk-f609388c` 标签保留；不改变 SDK 代码或版本。上游分支和标签已无法到达该提交，Cargo 全新缓存拉取失败，切换 Git CLI 也无效。
- 改了哪些：`Cargo.toml`、`Cargo.lock`、`.cargo/deny.toml` 的 SDK 来源地址。
- 怎样验证：空 `CARGO_HOME` 下 `cargo fetch --locked --target wasm32-unknown-unknown` 成功；继续使用该缓存，设置 `CARGO_BUILD_JOBS=2 SABLE_FOSS=1` 执行 `mise exec -- pnpm build`，Rust/WASM release、优化和 Vite 静态构建均成功，输出 `dist/`。格式与 diff 检查通过。
- 待验收：推送 production 后检查 Cloudflare Pages 构建及站点；不要删除镜像的固定引用。回滚此次地址修改会恢复原先的冷缓存依赖获取故障。
- 对 `codestable/` 的影响：无既有稳定规格需要调整；此记录保留依赖镜像的用途与恢复依据。
