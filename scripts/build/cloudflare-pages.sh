#!/usr/bin/env bash
set -euo pipefail

# 安装项目使用的工具管理器
curl --fail --silent --show-error --location https://mise.run | sh
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"

# Pages 的构建镜像也使用 mise；只读取仓库的工具配置，
# 不继承镜像的 .tool-versions（其中可能声明 dart-sass-embedded）。
unset MISE_ENV
export MISE_CONFIG_FILE="$PWD/.mise/config.toml"
export MISE_GLOBAL_CONFIG_FILE="$MISE_CONFIG_FILE"
export MISE_OVERRIDE_CONFIG_FILENAMES='.mise/config.toml'
export MISE_OVERRIDE_TOOL_VERSIONS_FILENAMES='.pages-tool-versions'

# 按仓库配置安装 Node、pnpm、Rust 和 WASM 工具
mise trust "$PWD/.mise/config.toml"
mise install

mise exec -- pnpm install --frozen-lockfile

# 包含 Rust/WASM 的正式构建；不生成前端 source map
export CARGO_BUILD_JOBS=2
export SABLE_FOSS=1
mise exec -- pnpm build

# 启用 Pages 默认 SPA 路由回退
rm -f dist/404.html
