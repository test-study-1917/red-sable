#!/usr/bin/env bash
set -euo pipefail

# 安装项目使用的工具管理器
curl --fail --silent --show-error --location https://mise.run | sh
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"

# 按仓库配置安装 Node、pnpm、Rust 和 WASM 工具
mise trust
mise install

mise exec -- pnpm install --frozen-lockfile

# 包含 Rust/WASM 的正式构建；不生成前端 source map
export CARGO_BUILD_JOBS=2
export SABLE_FOSS=1
mise exec -- pnpm build

# 启用 Pages 默认 SPA 路由回退
rm -f dist/404.html