# <img src="src/lib/assets/res/svg/logo.svg" alt="Sable" width="32" height="32"> Sable

[English](README.md) | [简体中文](README_zh.md)

一个近乎稳定的 Matrix 客户端，使用 Rust 和 Svelte 从零编写。  
在力求功能完备的同时，通过贴心的体验优化、个性化外观、实用工具以及纯粹的易用性来提升用户体验。

欢迎加入 Matrix 空间 [#sable:sable.moe](https://matrix.to/#/#sable:sable.moe) 参与项目与功能讨论、获取问题帮助，或者一起“喵喵叫” 🐱。

**Web 版本**已部署至 [app.sable.moe](https://app.sable.moe/)，Nightly 测试版位于 [dev.sable.moe](https://dev.sable.moe/)。请继续阅读安装说明。

# 安装

<a href="https://git.sable.moe/SableClient/sable-next/releases/latest"><img alt="Windows" src="https://img.shields.io/badge/Windows-0078D6?style=for-the-badge"></a>
&nbsp;
<a href="https://play.google.com/store/apps/details?id=moe.sable.client"><img alt="Google Play" src="https://img.shields.io/badge/Google_Play-3DDC84?style=for-the-badge&logo=googleplay&logoColor=white"></a>
&nbsp;
<a href="https://flathub.org/apps/moe.sable.client"><img alt="Flathub" src="https://img.shields.io/badge/Flathub-4A86CF?style=for-the-badge&logo=flathub&logoColor=white"></a>
&nbsp;
<a href="https://apt.izzysoft.de/packages/moe.sable.client"><img alt="IzzyOnDroid" src="https://img.shields.io/badge/IzzyOnDroid-1A73E8?style=for-the-badge&logo=fdroid&logoColor=white"></a>
&nbsp;
<a href="https://apps.obtainium.imranr.dev/redirect?r=obtainium://app/%7B%22id%22%3A%22moe.sable.client%22%2C%22url%22%3A%22https%3A%2F%2Fgit.sable.moe%2FSableClient%2Fsable-next%22%2C%22author%22%3A%22SableClient%22%2C%22name%22%3A%22Sable%22%2C%22preferredApkIndex%22%3A0%2C%22additionalSettings%22%3A%22%7B%5C%22about%5C%22%3A%5C%22The%20next%20Sable%20Matrix%20client%5C%22%2C%5C%22apkFilterRegEx%5C%22%3A%5C%22android-universal%5C%5C%5C%5C.apk%24%5C%22%2C%5C%22fallbackToOlderReleases%5C%22%3Atrue%7D%22%2C%22overrideSource%22%3A%22Codeberg%22%7D"><img alt="Add to Obtainium" src="https://img.shields.io/badge/Add_to_Obtainium-6750A3?style=for-the-badge"></a>

## Android

### Google Play

<a href="https://play.google.com/store/apps/details?id=moe.sable.client"><img alt="Google Play" src="https://img.shields.io/badge/Google_Play-3DDC84?style=for-the-badge&logo=googleplay&logoColor=white"></a>

点击上方按钮或[此链接](https://play.google.com/store/apps/details?id=moe.sable.client)从 Google Play 下载 Sable。

### IzzyOnDroid

<a href="https://apt.izzysoft.de/packages/moe.sable.client"><img alt="IzzyOnDroid" src="https://img.shields.io/badge/IzzyOnDroid-1A73E8?style=for-the-badge&logo=fdroid&logoColor=white"></a>

使用诸如 [Neo Store](https://github.com/NeoApplications/Neo-Store) 或 [Droid-ify](https://droidify.app/) 等 F-Droid 客户端，从 [IzzyOnDroid 软件源](https://apt.izzysoft.de/packages/moe.sable.client) 下载 Sable。

### Obtainium

每次构建均提供 APK，且可以通过 [Obtainium](https://obtainium.imranr.dev) 直接从 Forgejo 获取更新。每次构建还会发布对应的 `obtainium.json` 应用配置文件。

#### 稳定版 (Stable)

<a href="https://apps.obtainium.imranr.dev/redirect?r=obtainium://app/%7B%22id%22%3A%22moe.sable.client%22%2C%22url%22%3A%22https%3A%2F%2Fgit.sable.moe%2FSableClient%2Fsable-next%22%2C%22author%22%3A%22SableClient%22%2C%22name%22%3A%22Sable%22%2C%22preferredApkIndex%22%3A0%2C%22additionalSettings%22%3A%22%7B%5C%22about%5C%22%3A%5C%22The%20next%20Sable%20Matrix%20client%5C%22%2C%5C%22apkFilterRegEx%5C%22%3A%5C%22android-universal%5C%5C%5C%5C.apk%24%5C%22%2C%5C%22fallbackToOlderReleases%5C%22%3Atrue%7D%22%2C%22overrideSource%22%3A%22Codeberg%22%7D"><img alt="Add to Obtainium" src="https://img.shields.io/badge/Add_to_Obtainium-6750A3?style=for-the-badge"></a>
&nbsp;
<a href="https://git.sable.moe/SableClient/sable-next/releases/download/latest/obtainium.json"><img alt="App config" src="https://img.shields.io/badge/App_config-6B7280?style=for-the-badge"></a>

```
moe.sable.client
BC:9F:83:A1:AC:9C:33:2D:F7:39:75:96:2E:78:B5:57:24:D0:6A:EE:E7:3E:FF:8B:7B:78:52:61:AD:48:62:8B
```

#### 每夜构建版 (Nightly)

<a href="https://apps.obtainium.imranr.dev/redirect?r=obtainium://app/%7B%22id%22%3A%22moe.sable.next.nightly%22%2C%22url%22%3A%22https%3A%2F%2Fgit.sable.moe%2FSableClient%2Fsable-next%22%2C%22author%22%3A%22SableClient%22%2C%22name%22%3A%22Sable%20Next%20Nightly%22%2C%22preferredApkIndex%22%3A0%2C%22additionalSettings%22%3A%22%7B%5C%22about%5C%22%3A%5C%22The%20next%20Sable%20Matrix%20client%20(nightly)%5C%22%2C%5C%22apkFilterRegEx%5C%22%3A%5C%22android-universal%5C%5C%5C%5C.apk%24%5C%22%2C%5C%22includePrereleases%5C%22%3Atrue%2C%5C%22filterReleaseTitlesByRegEx%5C%22%3A%5C%22%5ENightly%20build%20%5C%22%7D%22%2C%22overrideSource%22%3A%22Codeberg%22%7D"><img alt="Add to Obtainium" src="https://img.shields.io/badge/Add_to_Obtainium-6750A3?style=for-the-badge"></a>
&nbsp;
<a href="https://git.sable.moe/SableClient/sable-next/releases/download/nightly/obtainium.json"><img alt="App config" src="https://img.shields.io/badge/App_config-6B7280?style=for-the-badge"></a>
```
moe.sable.next.nightly
BC:9F:83:A1:AC:9C:33:2D:F7:39:75:96:2E:78:B5:57:24:D0:6A:EE:E7:3E:FF:8B:7B:78:52:61:AD:48:62:8B
```

#### 配置与安装

1. 安装 [Obtainium](https://obtainium.imranr.dev)。
2. 点击上方的 **Add to Obtainium** 按钮。如果希望接收预发布版本，请选择 Nightly 配置。或者下载 `obtainium.json` 并通过 **导入/导出 (Import/Export) → 从文件导入 (Import from file)** 进行导入。
3. （可选）使用 [**AppVerifier**](https://github.com/soupslurpr/AppVerifier) 验证安装包是否真实未被篡改。

在迁移到按构建预发布版本之前添加的应用，需要先移除然后再重新添加。

## 桌面端

### Windows

<a href="https://git.sable.moe/SableClient/sable-next/releases/latest"><img alt="Windows" src="https://img.shields.io/badge/Windows-0078D6?style=for-the-badge"></a>

Windows 版本支持自动检查更新。下载并运行 [安装程序 (Setup)](https://git.sable.moe/SableClient/sable-next/releases/latest)。

### Linux

#### Flatpak

<a href="https://flathub.org/apps/moe.sable.client"><img alt="Flathub" src="https://img.shields.io/badge/Flathub-4A86CF?style=for-the-badge&logo=flathub&logoColor=white"></a>

稳定版已上架 [Flathub](https://flathub.org/apps/moe.sable.client)。Nightly 版本有独立的 Flatpak 远程源，每次推送到 `main` 分支时都会自动重新构建：

```bash
flatpak remote-add --if-not-exists sable-next-nightly https://sableclient.github.io/sable-next/sable-next-nightly.flatpakrepo
flatpak install sable-next-nightly moe.sable.next.electron.Nightly
```

#### Arch Linux

<a href="https://aur.archlinux.org/packages/sable-bin"><img alt="AUR" src="https://img.shields.io/badge/AUR-1793D1?style=for-the-badge&logo=archlinux&logoColor=white"></a>

使用你习惯的 AUR 助手进行安装和更新：

```bash
yay -S sable-bin
paru -S sable-bin
```

Nightly 构建请使用 `sable-nightly-bin`。从旧版本包升级时，请参阅 [AUR 升级说明](packaging/aur/README.md)。

#### Nix

```bash
nix run git+https://git.sable.moe/SableClient/sable-next#sable-desktop
```

#### 使用 Forgejo 软件源

软件包已发布至 `git.sable.moe` 上的 Forgejo 仓库中。如需 Nightly 版本，请将命令中的 `stable` 替换为 `nightly`；此时包名为 `sable-nightly`。

##### Debian, Ubuntu

```bash
sudo curl https://git.sable.moe/api/packages/SableClient/debian/repository.key -o /etc/apt/keyrings/forgejo-SableClient.asc
echo "deb [signed-by=/etc/apt/keyrings/forgejo-SableClient.asc] https://git.sable.moe/api/packages/SableClient/debian stable main" | sudo tee /etc/apt/sources.list.d/sable.list
sudo apt update && sudo apt install sable
```

##### Fedora, RHEL, openSUSE
```bash
sudo dnf config-manager addrepo --from-repofile=https://git.sable.moe/api/packages/SableClient/rpm/stable.repo
sudo dnf install sable
```

### macOS (Homebrew)

<a href="https://git.sable.moe/SableClient/homebrew-sable"><img alt="Homebrew" src="https://img.shields.io/badge/Homebrew-FBB040?style=for-the-badge&logo=homebrew&logoColor=black"></a>

使用 Homebrew 安装：

```bash
brew install --cask SableClient/sable/sable
```

该 Cask 已发布到 GitHub tap（`brew install` 默认拉取该仓库），同时提供 Forgejo 镜像源：`brew tap SableClient/sable https://git.sable.moe/SableClient/homebrew-sable.git`。

## iOS

### App Store

应用审核期间，你可以加入 [TestFlight](https://testflight.apple.com/join/PT2DSC3f) 进行体验。不久后将在 App Store 正式上架™。

### AltStore / SideStore

iOS 构建为未签名的 IPA 包，通过 [AltStore](https://altstore.io) 和 [SideStore](https://sidestore.io) 进行分发。每个发布版本都会附带列出该 IPA 的 `altstore-source.json`。

#### 稳定版源 (Stable)

<a href="https://intradeus.github.io/http-protocol-redirector?r=altstore://source?url=https://git.sable.moe/SableClient/sable-next/releases/download/latest/altstore-source.json"><img alt="Add to AltStore" src="https://img.shields.io/badge/Add_to_AltStore-7C3AED?style=for-the-badge"></a>
&nbsp;
<a href="https://intradeus.github.io/http-protocol-redirector?r=sidestore://source?url=https://git.sable.moe/SableClient/sable-next/releases/download/latest/altstore-source.json"><img alt="Add to SideStore" src="https://img.shields.io/badge/Add_to_SideStore-2563EB?style=for-the-badge"></a>
&nbsp;
<a href="https://git.sable.moe/SableClient/sable-next/releases/download/latest/altstore-source.json"><img alt="Direct URL" src="https://img.shields.io/badge/Direct_URL-6B7280?style=for-the-badge"></a>

#### 每夜构建版源 (Nightly)

<a href="https://intradeus.github.io/http-protocol-redirector?r=altstore://source?url=https://git.sable.moe/SableClient/sable-next/releases/download/nightly/altstore-source.json"><img alt="Add to AltStore" src="https://img.shields.io/badge/Add_to_AltStore-7C3AED?style=for-the-badge"></a>
&nbsp;
<a href="https://intradeus.github.io/http-protocol-redirector?r=sidestore://source?url=https://git.sable.moe/SableClient/sable-next/releases/download/nightly/altstore-source.json"><img alt="Add to SideStore" src="https://img.shields.io/badge/Add_to_SideStore-2563EB?style=for-the-badge"></a>
&nbsp;
<a href="https://git.sable.moe/SableClient/sable-next/releases/download/nightly/altstore-source.json"><img alt="Direct URL" src="https://img.shields.io/badge/Direct_URL-6B7280?style=for-the-badge"></a>

#### 配置与安装

1. 在设备上配置 [AltStore Classic](https://faq.altstore.io/altstore-classic/altserver) 或 [SideStore](https://docs.sidestore.io)。
2. 点击上方按钮，或者手动添加源（Nightly 频道只需将 URL 中的 `latest` 替换为 `nightly`）：
   - AltStore: `altstore://source?url=https://git.sable.moe/SableClient/sable-next/releases/download/latest/altstore-source.json`
   - SideStore: `sidestore://source?url=https://git.sable.moe/SableClient/sable-next/releases/download/latest/altstore-source.json`
3. 从该源安装 Sable v2。安装时，AltStore/SideStore 会使用你的个人开发者证书对未签名的 IPA 重新签名，免费账户需要每 7 天刷新一次应用。

这两个配置均由 [`tauri-build.yml`](.forgejo/workflows/tauri-build.yml) 中的 `obtainium` 和 `altstore` 作业生成。

## 其他发布版本
<a href="https://git.sable.moe/SableClient/sable-next/releases/latest"><img alt="Latest Releases" src="https://img.shields.io/badge/Download-181717?style=for-the-badge&logo=forgejo"></a>
&nbsp;
<a href="https://git.sable.moe/SableClient/sable-next/releases/latest"><img alt="Download APK" src="https://img.shields.io/badge/Download_APK-6B7280?style=for-the-badge&logo=android&logoColor=white"></a>

如果你的平台未在上方列出，或者你希望直接下载安装包，请查看 [最新发布版本](https://git.sable.moe/SableClient/sable-next/releases/latest)。

# 开发入门

> 你可以在 [开发者 Wiki](https://git.sable.moe/SableClient/sable-next/wiki/Getting-started) 上了解更多起步指南。

克隆仓库：  
`git clone https://git.sable.moe/SableClient/sable-next.git`

Node、pnpm、Rust 及其他工具链均由 [mise](https://mise.jdx.dev) 进行管理。在[系统中安装 mise](https://mise.jdx.dev/installing-mise.html) 之后，进入项目目录并运行以下命令来配置项目：

```bash
mise install
mise run setup    # pnpm install + git hooks
mise run dev      # 在 http://localhost:3000 启动 SvelteKit
```

`mise run dev` 会先构建开发环境的 WASM 包。在另一个终端中编辑 Rust 代码时，运行 `mise run wasm:watch`；每次重新生成包后 Vite 会自动重新加载。生产构建会自动生成优化后的 WASM 包。

`pnpm test:e2e` 会在 `src/generated/wasm-e2e/` 中生成其专用的 WASM 包，因此可以在开发服务器正在使用 `src/generated/wasm/` 的同时并行运行。

运行 `mise tasks` 可以查看完整的任务列表。

## 不使用 mise 构建

将 Node、pnpm、Rust（需包含 `wasm32-unknown-unknown` 目标平台）以及 `wasm-bindgen-cli`（版本需与 `Cargo.lock` 中一致）添加到系统的 `PATH` 中，然后运行 `pnpm install` 和 `pnpm build`。

## 自建托管 (Self-hosting)

Docker 与客户端配置请参阅 [Web 客户端指南](docs/web.md)；若要在服务器上运行 Sable 及其 Matrix 存储后端，请参阅 [服务器模式指南](docs/server.md)。

## 应用端 (Apps)

桌面端构建（**Windows**、**macOS**、**Linux**）使用 [Electron](https://www.electronjs.org)；详情请参阅 [`electron/README.md`](electron/README.md)。**Android** 与 **iOS** 使用 [Tauri](https://v2.tauri.app)。

```bash
mise run tauri:setup          # 共享的 Rust/系统依赖，包括 Linux 系统包
mise run tauri:icons          # 修改 logo SVG 后重新生成原生应用图标
mise run tauri:setup:macos    # macOS: Xcode
mise run tauri:setup:android  # Android: SDK 包 + NDK
mise run tauri:setup:ios      # iOS: Xcode 工程 + CocoaPods (macOS)
```

每次推送到 `main` 分支都会为所有目标平台发布独立的 [Nightly 预发布版本](https://git.sable.moe/SableClient/sable-next/releases)。Linux x86_64、macOS、Android 和 iOS 在此处构建；Windows 和 Linux aarch64 在 GitHub 镜像仓库中构建，并将构建包及认证信息 (attestations) 附加到同一 Release 中。推送 `v*` 标签也会以同样方式发布稳定版。

Web 构建包会随每个发布版本以 `sable-<version>-web.tar.gz` 形式提供。解压到你的 Web 根目录即可自行托管该应用；有关示例配置请参阅 [`Caddyfile`](Caddyfile)。

## 参与贡献

请参阅 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

## 开源许可

本项目采用 AGPL-3.0-or-later 许可协议，并附带针对 App Store 可执行文件的 MPL 2.0 附加许可权限（详见 [`LICENSE`](LICENSE)）。Sable 的名称与徽标受 [`TRADEMARKS.md`](TRADEMARKS.md) 保护。
