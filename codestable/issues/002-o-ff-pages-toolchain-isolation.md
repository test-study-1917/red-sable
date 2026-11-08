---
type: ff
status: open
---

# Pages 构建工具配置隔离

- 做了什么：修正 Pages 构建脚本，显式加载仓库 `.mise/config.toml`，不读取构建镜像的 `.tool-versions`，清除继承的 mise 环境选择。
- 改了哪些：`scripts/build/cloudflare-pages.sh`；保持项目工具版本、WASM 构建和 SPA 回退处理不变。
- 怎样验证：`bash -n` 通过。在临时 HOME 中设置包含 `dart-sass-embedded` 的 `.tool-versions` 并覆盖默认 TOML 文件名，复现同名工具不存在的报错；应用脚本配置后，`mise install --dry-run` 成功，仅解析仓库的 Node、pnpm、Rust、wasm-bindgen、Binaryen 等工具，未执行安装。
- 待验收：用户提交并推送修复后，由 Pages 完成真实工具安装、构建和部署；本地未执行远程部署。
- 对 `codestable/` 的影响：无稳定规格变化；此记录保留云端验收入口。
