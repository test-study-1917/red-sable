---
kind: issue
title: '普通房间通话与聊天双布局'
type: feature
status: open
created: 2026-11-10
---

# 普通房间通话与聊天双布局

## 已确认目标与执行归属

用户确认：保留上下和左右两种布局；左右为左通话、右聊天；首次宽屏默认左右、窄屏上下，此后记住选择。用户要求由 GPT-6.1 Sol 执行，主代理随后验收。

本事项独立于 [Issue 001](001-o-native-call-end-for-everyone.md)。实现及验证完成后仍保持 open，不自动 commit、push、部署、关闭或毕业到 Project Spec。

范围为普通聊天房间中的原生通话视图。现有语音房、通话协议、Rust 核心、媒体连接、设备权限、全员结束协议、侧边栏紧凑通话条的语义不变。不修改相邻 element-call / element-web 仓库。不添加分栏依赖。

## 当前实现与问题

加入普通房间通话 → RoomView 的 callShown 生效 → RoomCallStage 在标题后、chat() 前挂载 → CallView 显示原有 CallSession，ResizeHandle 改变 stage 的 flex-basis。

- `src/lib/features/room/RoomView.svelte`：`.timeline` 是纵向 flex；callStageRatio 使用 `sable-call-stage-ratio`，初始宽屏 0.65、窄屏 0.4，范围 0.2–0.8；timelineHeight 目前包含标题区域。chat() 包括 TimelineList 和 composer-dock。
- `RoomCallStage.svelte`：docked 时固定占比，手柄 grow=down，按 timelineHeight 把像素转成比例。
- `src/lib/ui/panel-width.svelte.ts`：PanelWidth 已提供本地尺寸存储与范围约束。
- `src/lib/ui/primitives/ResizeHandle.svelte`：已有左右/上下拖动、方向键、Shift 步进和提交支持。
- `src/lib/features/call/CallView.svelte`：右上已有参与者网格/焦点与全屏按钮；session.layout 仅负责参与者呈现。控制栏绝对定位，媒体底部留白主要为固定计算。
- `CallControls.svelte`：窄于 34rem 时控制换行，因此左右分栏必须检查实际控制栏高度。
- `call-fullscreen.svelte.ts`：Web 请求浏览器全屏；原生视频路径把 DOM 暂移 body 再恢复。不能因布局切换销毁宿主。
- `RoomVoiceChat.svelte`：语音房已有右侧聊天面板，本次借鉴拖拽和样式，不改变其开关及呈现行为。

问题主要是通话占用消息的垂直空间，不应仅用 z-index 修补。新的变化轴属于房间内容布局，不属于媒体会话。需要把标题以下的通话/聊天整理为同一个布局边界，避免在庞大 RoomView 中复制两套内容或将分栏规则塞入 CallSession。既有代码的局部整理只服务这一边界，不做全仓重构。

## 目标界面与状态契约

### 左右（目标）

```text
┌─ 房间标题 ──────────────────────────────────────┐
│ 通话状态       [切换上下][全屏] │ 消息列表         │
│                                │                  │
│            通话画面            ┃                  │
│                                ┃                  │
│        通话控制与挂断          │ 输入框           │
└────────────────────────────────┴──────────────────┘
                                 左右拖动
```

### 上下（目标）

```text
┌─ 房间标题 ──────────────────────┐
│ 通话状态      [切换左右][全屏]   │
│            通话画面             │
│            通话控制             │
├────────── 上下拖动 ─────────────┤
│ 消息列表                        │
│ 输入框                          │
└─────────────────────────────────┘
```

标题跨通话与聊天两区；输入框只属于聊天列。尺寸为示意，以实际页面验证校准。

1. 切换按钮在通话右上、全屏按钮旁，独立于参与者网格/焦点按钮，使用项目图标、IconButton 与中英文文案，明确动作目标。
2. 仅普通房间 docked 通话提供切换；没有通话时聊天恢复完整空间；失败状态仍可布局，不需要新建或重连会话。
3. 只有一个通话组件实例和一个聊天组件实例。切换方向不重挂载；草稿、焦点、选中回复/编辑上下文保持，滚动保持可见消息锚点（变窄导致换行时无需承诺 scrollTop 数字不变）。读历史时不跳底，原在底部时继续跟随新消息。
4. 上下高度、左右宽度分别存储；保留原 `sable-call-stage-ratio` 的高度含义，不把旧值解释成宽度。左右初始通话占比建议 60%，按最小可用宽度夹紧。
5. 本机跨普通房间记忆用户主动选择。没有记录时依据可用宽度选择左右或上下；自动响应式回退不写入偏好，不污染另一个方向的尺寸。
6. 窄宽度暂时上下；足够宽后恢复左右偏好。显式选择上下后，扩大窗口不自动改左右。窄屏不能有效切左右时，按钮有可感知的不可用原因（例如 tooltip/可访问说明“空间不足，扩大窗口后可使用左右布局”）。采用既有无障碍模式，不只依赖不可聚焦 disabled 的 hover。
7. 以标题下内容区的实际剩余宽度判断，成员、搜索、线程等侧栏打开后的占用应计入。不能仅检查 window.innerWidth。测量外层可用容器而非被分栏规则反向撑大的子项，避免响应式循环。临界点必要时加入小幅滞回，不能频繁横竖跳变。
8. 最小栏宽由实现者在真实渲染中校准并记录：聊天输入和消息可读、通话控制可完整操作。建议以通话约 26rem、聊天约 22rem 为初始试验值，不将未经验证的值当产品硬阈值。拖拽范围必须同时满足两栏最小值。
9. 上下布局按标题以下的实际高度计算比例，检查短窗口时输入框与挂断仍可用。不能因 80% 比例或最小高度叠加把聊天推出可见范围。
10. 手柄在两区分隔线上有预留空间；hover/focus 命中区、焦点环不得覆盖消息/操作按钮或被裁切。鼠标与键盘方向跟随当前轴。
11. 通话控制可换行，但媒体保留实际控制栏所需空间；错误、加密连接提示、全员结束失败提示仍可读。设备、挂断菜单和确认框使用既有浮层机制，窄栏不裁切、不越界覆盖聊天正文的常驻内容。
12. 全屏时隐藏分栏按钮、退出恢复原布局与比例；全屏期间窗口尺寸变化后退出仍按可用空间布局。不得破坏原生 fullscreen DOM 恢复路径。

## 实现安排

### A. 布局状态与空间归属

RoomView 或其直接所属房间布局模块拥有 preferredLayout 与 effectiveLayout，类型明确区分 stacked / side-by-side。优先使用现有 local-json 和 PanelWidth；只在尺寸推导、偏好、上下两套尺寸规则确实需要集中时抽一个房间专属状态模块，不建立通用布局框架。

RoomView 中保留 RoomHeader，标题下建立稳定的通话/聊天内容容器。chat() 在单一稳定宿主渲染；现有 voiceView / voiceChatBeside 分支保持行为。需完整理解 thread-covered、inert、RoomSidePanels 和布局 CSS 的直接依赖，确保新包装不改变隐藏线程、滚动和侧栏最小宽度规则。

比较后选择：固定宿主 + 改 CSS grid/flex 轴；不使用左右/上下两套条件树、不重新渲染同一个 snippet 两次、不对方向加 key。CSS/DOM 排列应与键盘阅读顺序一致（通话在前、聊天在后）。

### B. 通话外壳与按钮

RoomCallStage 接收有效方向及对应尺寸/容器尺寸，统一渲染手柄与 stage。可调整原 props 以更准确表达宽高，但所有调用方必须完成；语音房非 docked 路径仍可用。

CallView 接收可选的房间布局动作/状态（或遵循项目惯例的同等接口），仅展示按钮并通知父级，不拥有本地存储、不修改 session.layout。既有直接挂载 CallView 的测试和调用方不必提供新参数。

调整控制栏空间，优先让布局自然为其保留空间；若保留绝对定位，则使用实际高度测量，覆盖换行和提示变化，不仅再增加一个固定 padding 猜值。

### C. 本地化与必要相邻修复

按当前语言资源结构增加英文、中文键和可访问标签。保留现有 design tokens、按钮大小、主题。新布局如果暴露原控制栏换行留白问题，在本次直接修复并回归现有窄屏。

## 风险优先顺序

1. 首先打通稳定宿主的左右/上下切换：用真实布局组件证明不重挂载，不触发通话 join/leave；聊天草稿与阅读锚点保持。
2. 然后完成实际容器测量、最小尺寸、侧栏缩放回退，证明临界宽度无循环/跳动。
3. 再完成拖拽持久化、按钮、全屏和控制栏动态高度；最后补齐交互与视觉验收。

以上是实现阶段连续步骤，不要求每步等待用户确认。遇到产品契约确实无法同时满足时，带具体渲染或失败证据向主代理提出取舍；不要自行删除已确认要求。

## 质量承诺与验收

| 目标     | 必须观察到的结果                                                         | 证据                                          |
| -------- | ------------------------------------------------------------------------ | --------------------------------------------- |
| 交互能力 | 两种布局可切换、可拖拽、可键盘操作，消息和输入不被遮挡，窄栏菜单可用     | 浏览器交互断言、实际截图人工检查              |
| 可靠性   | 切换和响应式回退不重新入会、不重置媒体状态，不丢草稿和阅读位置           | 挂载/调用次数与状态断言，实际房间布局集成用例 |
| 灵活性   | 按实际内容宽度回退/恢复，侧栏占用计入，偏好与比例正确恢复                | 宽窄容器、侧栏开关、本地存储恢复测试          |
| 可维护性 | 房间分栏与 session.layout 分离，复用手柄，现有 CallView 调用方无需新前提 | diff 检查、受影响类型和现有测试               |

验收场景：

- 无存储：宽容器左右，窄容器上下；已有旧高度存储继续只影响上下布局。
- 宽屏主动选择上下，刷新/换普通房间后保持；主动选择左右后窄化临时上下，再扩大恢复左右。
- 左右与上下各拖一次并刷新：两套尺寸独立恢复；鼠标、方向键、Shift 操作正确。
- 通话中切换多次：不调用 join/leave、不换会话、不重建视频宿主；麦克风、摄像头、共享选择、置顶保持。
- 聊天滚到历史、输入草稿、选回复，再切换：仍在对应消息附近，草稿和上下文保持。重新换行后保持锚点，不要求字节级像素一致。
- 房间内容宽度约 1000px、阈值两侧，以及整窗 1440×900、1024×768、390×844；这些是测试代表值，不是硬编码断点。增加约 900×500 短窗口检查。
- 成员/搜索/线程侧栏打开与关闭引起实际空间变化；不出现水平溢出、无限 ResizeObserver 循环、分栏抖动。
- 控制栏两行时，通话画面/等待邀请/错误提示可读；设备、全员结束菜单和确认框不裁切，普通挂断语义不变。
- Web 全屏进入/退出、全屏期间改变尺寸；语音房 lobby、主通话及右侧聊天仍保持原行为。

## 验证路径与运行边界

先读现有 `vitest.config.ts`、CallView/CallControls/CallEnd 与 fullscreen 测试、RoomView 相关 fixture，再复用最小适用入口。

- 新布局偏好/尺寸推导使用 node 定向测试；布局几何、拖拽、切换、锚点与浮层使用现有 Vitest browser 或隔离 Playwright。
- 必须让测试使用生产的房间布局组件及通话/聊天宿主；只在 fixture 中复制一个 CSS 双栏不能证明 RoomView 集成成立。核心/媒体不可控部分可替身。
- 运行受影响测试与必要 Svelte/TypeScript 检查；命令和结果写回本 Issue。没有类型或 Rust 变化，不运行 Rust 全套或重建 WASM。
- 不运行会清理真实测试 homeserver 的默认全局 E2E；现有 call-termination 隔离配置可参考，不要为此另造测试平台。
- 不重启或停止用户 3001 服务，不操作真实账号/结束真实通话。需要浏览器可视化时在不冲突的本地端口使用隔离 fixture；记录启动/停止归属，不留无关后台进程。
- 必须保存并亲自查看宽屏左右、上下、窄屏回退、控制栏换行/菜单场景截图。报告截图路径与实际看到的结论；明确 mock 与真实联调的区别。
- 验收者复用当前候选有效证据，只补差异和关键缺口。媒体真实联调若未做，明确缺口，不把 mock 等同真实连接测试。

## 交付与主代理验收

实现者在本 Issue 追加：具体修改、最终尺寸/响应规则、测试命令与结果、截图路径、遗留及运行入口。不要改写已确认契约来适配未完成实现。报告完成后由主代理阅读 diff、核对关键调用方与布局状态、查看截图并执行必要交互。问题回到同一实现者修正；验收通过后仍由用户决定关闭。

## 给 GPT-6.1 Sol 的执行提示词

你是本事项唯一代码实现者。工作目录 `/home/zhuji/code/element/red-sable`。请读取本 Issue 全文及直接引用的现有实现，按 `$cs` 受管理实现姿态完成，不止于计划。用户已确认双布局、左通话右聊天、宽屏默认左右/窄屏上下及本机记忆，并授权你执行，主代理随后验收。

先查看当前 git diff 和适用项目规则，保护其他改动；本 Issue 是需求与方案权威。只在本仓实现，禁止 commit/push/部署/关闭 Issue，不操作用户真实通话、不重启 3001。不要再委派子代理。遵守当前工具权限，必要文档查询用已配置工具。

先完成稳定宿主的真实布局路径，再做偏好、双向尺寸、响应式与控制栏。复用 PanelWidth/ResizeHandle 和现有测试基础。保持 CallSession、Rust、session.layout、普通挂断/结束所有人语义和语音房原有行为。方向切换不能重挂载通话/聊天。必要相邻修复和验证由你完成。

方案中的初始尺寸是可校准参数，你应根据实际渲染直接决定并记录；用户已确认的布局方向、双模式、默认/记忆策略不可自行缩减。真正阻塞时向主代理发送对象、影响、证据和所需决定，继续不受阻部分。

结束前核对全部验收场景，取得针对当前候选的关键测试和实际视觉证据。把实现记录追加到本 Issue，并向主代理返回修改摘要、完整可复现命令、通过/失败/未运行项、截图及使用入口、真实剩余问题。不要用“测试通过”替代实际视觉检查，也不要把部分完成标成全部完成。

## 主代理验收结论

本轮审核通过。对照确认方案检查了生产布局状态、RoomView/CallView 集成、既有调用方和测试断言；查看宽屏、上下、窄屏、短窗失败提示截图。独立浏览器交互确认左右→上下→左右保持同一 stage 节点及真实 composer 草稿，缩到 700px 回退、恢复 1440px 后恢复左右；语音房主通话仍占满剩余高度。截图 `/tmp/sable-dual-layout/review-wide.png`（包含既有离开通话区域后隐藏控制的状态）。

审核发现新增隔离测试误被默认 Chromium E2E 收录，已由新的 GPT-6.1 Sol / high 子代理修复并验证：默认列表精确移除 9 项，专属列表仍为 11 项。生产代码未因此改变，复用实现记录中当前候选有效的测试和视觉证据。未发现其他阻止本次 UI 交付的问题。

验收范围为本次双布局 UI 及其会话状态连续性；真实设备/远端媒体未联调，保留下文边界。偶发浮层拆卸开发告警仍记录为非阻断观察项。验收结束已停止代理专用 4195 Vite，后文启动记录保留供复现。Issue 保持 open，本结论不执行关闭或 Git 提交。

## 实现记录（2026-11-10，GPT-6.1 Sol / high）

### 已实现与校准

- `RoomCallLayout.svelte` 是 RoomView 标题下的唯一分栏边界。固定通话、聊天宿主，仅改变 flex 轴；普通房间的生产 `RoomCallStage`、`TimelineList`、`ConversationComposer` 均在这条路径上。语音房仍走原有 lobby / 主通话 / 右侧聊天分支。
- `room-call-layout.svelte.ts` 集中偏好、两轴尺寸和有效方向；复用 `local-json` 与两份 `PanelWidth`。`sable-call-chat-layout` 保存主动选择，`sable-call-stage-width-ratio` 保存左右比例；旧 `sable-call-stage-ratio` 继续只表示上下高度。初始左右 60%、上下 40%，恢复值按当前实际空间夹紧，自动夹紧和回退不覆盖存储。
- 实测采用通话最小 26rem、聊天最小 22rem，加 8px 独立手柄沟槽。在 16px 根字号下，进入左右需要实际内容宽度至少 792px，已在左右时低于 776px 才退出（16px 滞回）。测量标题下的外层剩余容器，成员、搜索、线程侧栏自然计入；测量写入合并到下一动画帧，避免同轮 ResizeObserver 改轴。
- 上下比例按标题下高度、扣除沟槽计算。普通短窗保留通话约 240px 和聊天约 180px；非常短时通话最小比例最多为 65%，不把两个无法同时满足的最小高度硬叠加。校准覆盖 900×500 与额外的 390×500，挂断和输入框仍在可见区域。鼠标拖动、当前轴方向键、Shift 15% 大步进均使用既有 ResizeHandle，沟槽内显示 hover / focus，不压到聊天内容。
- 通话右上新增上下/左右动作，位于全屏旁，独立于参与者网格/焦点切换。窄屏仍可聚焦，使用 aria-disabled、Tooltip 和完整动作/不可用原因标签；中英文资源已补齐。全屏时不显示分栏动作，退出按最新可用空间恢复。
- CallView 按实际顶部、提示和控制栏高度留媒体空间，覆盖两行控制与连接锁定提示；失败移除控制栏后底部留白清零。短窗提示区限制在顶部与控制栏之间，内容过长可滚动，不遮挡挂断。截图中的 390×500 失败提示展示滚到操作端的状态。
- 实际集成发现参与者网格的默认 flex 最小尺寸会在切轴后反向撑高网格，出现一次 ResizeObserver undelivered-notifications 错误；`CallTileGrid` 补齐 `min-height: 0; min-width: 0` 后，带编辑上下文的切轴/窄化复现与最终集成运行均不再出现该错误。未修改 TimelineWindow 或媒体协议。

### 验证结果与可复现命令

隔离 fixture 现在挂载**生产 RoomView**，使用真实 TimelineList、ConversationComposer、CallSession、RoomCallStage、CallView、RoomSidePanels；只替代 core RPC 与媒体 transport。新增 `call-dual-room.svelte` 提供离线数据与上下文，复用原 call-termination Vite / Playwright 配置，并接入项目已有 emoji 插件和 WASM 资产路径。未运行默认全局 E2E。

```bash
# 偏好、旧高度语义、两轴尺寸、短窗和滞回：4/4
pnpm exec vitest run --project node src/lib/features/room/room-call-layout.test.ts

# 既有通话视图、控制和参与者布局：33/33
pnpm exec vitest run --project node \
  src/lib/features/call/CallView.svelte.test.ts \
  src/lib/features/call/CallControls.svelte.test.ts \
  src/lib/features/call/call-layout.test.ts

# 控制、结束菜单键盘、原生视频 fullscreen DOM 恢复、语音 lobby：13/13
pnpm exec vitest run --project browser \
  src/lib/features/call/CallControls.browser.test.ts \
  src/lib/features/call/CallEnd.browser.test.ts \
  src/lib/features/call/call-fullscreen.browser.test.ts \
  src/lib/features/call/VoiceLobby.browser.test.ts

# 独立集成入口，不接 homeserver；现有结束语义测试一起回归
CHOKIDAR_USEPOLLING=1 SABLE_CALL_E2E_PORT=4196 \
  pnpm exec playwright test -c tests/e2e/playwright.call-termination.config.ts

pnpm check
```

- 集成主批次 **10/10**（8 个双布局场景 + 2 个既有结束测试），日志 `/tmp/call-layout-e2e-accepted.log`；随后新增的 connecting / failed 分栏场景单独 **1/1**，命令在上述 Playwright 命令后加 `--grep 'connecting and failed'`，日志 `/tmp/call-layout-phases.log`。当前配置完整运行将包括 11 个场景。
- 集成断言覆盖：5 个生产宿主节点身份不变；join / connect 各一次且 leave / disconnect 为零；相机、deafen、置顶和共享观看选择保持；历史消息锚点可见、不跳底；真实富文本草稿及回复、编辑上下文保持；原在底部时新消息继续跟随；自动窄化后编辑器焦点保留。
- 还覆盖：无存储宽/窄默认、主动上下刷新保持；实际成员侧栏拖宽触发回退，搜索与线程侧栏开关回退/恢复；775 / 780 / 790 / 800px 临界区；双轴鼠标、方向键、Shift 和各自刷新恢复；窄屏不可用说明；900×500 / 390×500、换行控制、结束菜单/确认框/失败提示；Web 全屏及期间改变可用尺寸；无通话恢复满幅聊天；语音房主通话、右侧聊天、退出后的 lobby。
- `pnpm check` 通过：Svelte 0 errors / 0 warnings，后续 service-worker 与 browser TypeScript 检查通过。日志 `/tmp/call-layout-check.log`。
- 受影响文件 ESLint、生产 Svelte 样式 Stylelint、`git diff --check` 通过。日志 `/tmp/call-layout-lint.log`、`/tmp/call-layout-lint-final.log`、`/tmp/call-layout-style.log`。定向单元/回归/浏览器日志分别为 `/tmp/call-layout-unit.log`、`/tmp/call-layout-regression.log`、`/tmp/call-layout-browser.log`；网格修复后再次通过原生 fullscreen 用例 `/tmp/call-layout-fullscreen-final.log`。

### 实际视觉检查与入口

本人已打开检查以下最终候选截图，稳定副本在 `/tmp/sable-dual-layout/accepted/`：

- `wide.png`：1440×900 左通话右聊天，标题跨两列，输入框仅在右列，控制不遮挡消息。
- `stacked.png`：上下布局、历史阅读锚点和回复草稿，置顶/相机/deafen 状态仍在；手柄在两区间。
- `narrow.png`：390×844 上下回退，双行控制和不可用原因 Tooltip 可见；输入框完整。
- `short.png`、`wrapped-menu.png`：900×500 短窗，以及约 26rem 通话栏的控制换行/结束菜单；菜单位于浮层且未被分栏裁切。
- `notice.png`、`short-notice.png`：结束失败仍可恢复；短窗提示可滚动，挂断、Retry 与输入框可用，提示不覆盖控制栏。
- `connecting.png`、`failed.png`：连接锁定提示留出真实空间，失败界面切换方向后无旧 dock 留白。

隔离浏览入口：`http://127.0.0.1:4195/tests/e2e/fixtures/call-termination.html?dual`；附加 `&voice` 可看语音房。当前 4195 保留给主代理验收（仅此隔离服务）：Vite PID **1785262**，启动父进程 PID **1785198**，exec session **12945**，日志 `/tmp/call-layout-vite.log`。启动命令：

```bash
CHOKIDAR_USEPOLLING=1 pnpm exec vite \
  --config tests/e2e/fixtures/call-termination.vite.config.ts \
  --host 127.0.0.1 --port 4195 --strictPort
```

验收结束后由主代理停止该隔离服务；不要停止用户 3001。临时测试 4196 已由 Playwright 自行退出。

### 剩余边界与关闭候选

- 真实账号、真实摄像头/共享轨道和远端媒体连接未联调；本次边界禁止操作真实通话。现有证据证明生产 UI 与真实 CallSession 在替身 transport 下的布局和会话状态连续性，不能替代真实媒体设备/网络验收。原生视频恢复由既有 browser mock native-video 用例覆盖，未启动 Electron 真机。
- 开发模式在浮层拆卸时仍偶发 Svelte `derived_inert` 告警；最终集成行为和页面错误断言通过，未见 ResizeObserver 循环或布局抖动。该告警尚未定位源头。
- 实现和本次授权范围内验证已完成，等待主代理验收；Issue 保持 open。关闭时可将双布局的用户策略、实际容器响应式、独立存储和稳定宿主契约毕业到 Project Spec，当前不做毕业。

## 审核修复（2026-11-10，GPT-6.1 Sol / high）

主代理审核发现，新增 `call-dual-layout.spec.ts` 依赖隔离 Vite fixture，但根 Playwright 配置未排除它，默认 Chromium 错误收录了 9 个无法由预览构建提供 fixture 的用例。

- 最小修复：仅扩展 `playwright.config.ts` 的 Chromium `testIgnore`，将原 `call-termination` 匹配改为 `call-(?:termination|dual-layout)`。专属配置继续收录两类测试，不改生产代码或其他项目的发现规则。
- `pnpm exec playwright test --list --project chromium`：退出码 0；修复前为 **571 tests / 118 files**，修复后为 **562 tests / 117 files**，不含两类隔离通话测试。逐项比较发现列表，修复后恰好等于修复前移除 9 个双布局用例，其他用例及顺序不变。日志：`/tmp/call-layout-review-default-before.log`、`/tmp/call-layout-review-default-after.log`。
- `pnpm exec playwright test -c tests/e2e/playwright.call-termination.config.ts --list`：退出码 0，仍为 **11 tests / 2 files**（9 个双布局 + 2 个结束语义用例）。日志：`/tmp/call-layout-review-isolated-list.log`。
- 本次仅验证测试发现，不启动全局 homeserver E2E，不重跑已有有效 UI 测试。生产 UI 继续由主代理验收，4195 隔离验收服务保持运行；Issue 保持 open。
