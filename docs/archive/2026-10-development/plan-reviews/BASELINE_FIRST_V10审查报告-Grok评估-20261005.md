# BASELINE_FIRST_V10 执行计划审查报告 — Grok 评估（2026-10-05）

> 评估者：Grok（xAI Grok 4.7，本会话独立审查）
> 评估对象：`docs/development-plan/component-platform-refactor/BASELINE_FIRST_V10_EXECUTION_PLAN.md`
> 承载仓库：`D:/果铃恢复候选/20261005-authoring`
> 文档写出位置：`D:/果铃工作台/BASELINE_FIRST_V10审查报告-Grok评估-20261005.md`
> 对照材料：该仓 `AGENTS.md`、`docs/development-plan/README.md`、`ARCHITECTURE_CONTRACT.md`、`WORKING_PROTOCOL.md`、`EXECUTION_PLAN.md` 的 N/L 定义，以及直接源码、import 和 git 只读记录
> 状态：只审查方案。未改产品源码，未执行回退、安装、构建、测试、真实模型调用或发布。未重写计划。
> 方法：10 路只读子审查（基线保全、写域并发、Slide/App、Flow/Spatial、属性/教师/剪贴板、正式 writer 生命周期、运行与源码、内容与专业组件、导出与 N/L 覆盖、验证与切换）。汇总结论以本会话复核过的 git 与源码为准。已有 Astra 或其他评估不作为本判断的前提。

## 1. 结论

**修正后可实施。**

路线成立：在独立承载上恢复 `027d588a` 的 V9 成熟前端，再沿既有端口把正式写入换成 V10，同一文档只留一个 writer。第 4 节的动机评估规则也成立。

按现在的第 6、8、11、12 节直接派发则不可执行。那样会把已缩减的界面整文件盖回成熟前端，漏掉只存在于工作区的修复，并把首条用户链拖到编译器、Player 和导出之后。这些是计划缺陷。改提取边界、写域、退出名单和证据门之后可以开工。不需要改成另一条技术路线。

本轮亲自核对的基线：

| 事实 | 结果 |
|---|---|
| 候选仓 | `D:/果铃恢复候选/20261005-authoring`，分支 `codex/authoring-recovery-20261005` |
| HEAD | `b0076bc018643802119bdb6826aa883f00bb6bf4`。父提交是计划所写的保存前 `063f77e2`，该提交只改计划文档 |
| `027d588a` | 父提交 `5f6fa9d7d43acbb1042ed41aec6048c9d4ed0a2e`，2026-10-04 13:12 +08，只改 4 个文档。`src` 与 `5f6fa9d7` 相同。整棵 git tree 不同，只因为文档 |
| `6d93aca0` | `027d588a` 的直接子提交，说明为 deliver component platform engineering candidate |
| 工作区 | 仍是 25 个 tracked 修改加 2 个 untracked |
| 宿主 | `027d` 没有 `CourseV10Driver`。当前 `DocumentHostService.ts:61` 只注册 Markdown、Text 和 `createCourseV10Driver()` |
| Owner 仓 | `D:/果铃工作台` HEAD 为 `64d97fa2`，分支 `main`，`git status --porcelain` 920 条。它是更早参照，不是恢复分支 |

## 2. 必须修正项

修正前不派发产品实现。

1. 禁止用 `6d93` 或当前 HEAD 整文件覆盖 `027d` 的 UI。第 11 节按真实文件重分类 25+2，E1 切片包含全部 dirty 与两个 untracked。
2. B0 禁止对 `D:/果铃工作台` 做任何 git 写操作。实机参照通过之前，不得把 `027d` 或当前候选称为稳定原版。
3. 写明 `6d93` 起宿主已是 V10，`027d` 才是最后一版 V9 注册树。不要再注册第二个 V9 driver。
4. A0、S0、N0、F0、F1、Q0 改成 `027d` 挂载点上的端口适配。禁止把 `ComponentPlatformApp`、未挂载的 `SlideSurfaceView`、instance-only 源码面板、legacy Flow slice、Spatial `CommandPort` 当作接入点。
5. 第 8 节第一组改成文件级纯叶白名单。首条 Slide 用户链不等整份 R0、Q1、T0、R1 或导出。
6. K0 缩小到 Slide 实际端口。`editorStore.ts`、Host 构造、Gateway、`ipc.ts` 只做排队短 hunk。
7. Flow 的 `submit` 返回同一次 `editCaptured` Promise，资源进入同一次 batch。course-instance 粘贴必须克隆实例。
8. 路径字段只由 `DocumentSession.binding` 写入。文档关闭同一处销毁作者 world 和预览 player。
9. V2 捕获、`native.content`、HTML 导入、Phaser 主挂载有文件级退出 owner，不留到 N10 的一句话。
10. N01、L07、L18、L03、L14/L15、L26 补上实际 consumer 与最低证据。
11. 菜单、脏关闭、磁盘导入、Flow 图片、三表面试运行、新 `documentId`/`epoch` 重开、真实中文选词，写成切换条件。unit green 只释放接口。

## 3. 逐项问题

### 3.1 按文件提取会盖掉成熟界面，并丢掉未提交修复

- 影响维度：用户功能退化、数据错误。计划缺陷。
- 计划位置：第 41、305、311、313 行。第 41 行允许按文件和明确 hunk 提取。第 311 行把当前 25+2 写成 integration/backend/test。
- 证据：`git show --shortstat 6d93aca0` 为 654 个文件，+50078/−83574。`editorStore.ts`、`SlideLocationWorkspace.tsx`、`FlowLocationWorkspace.tsx`、`SpatialLocationWorkspace.tsx`、`ComponentPropertiesEditor.tsx` 在这一提交中从数千行收到数百行。当前 `ComponentPropertiesEditor.tsx` 约 75 行：标量走 schema，对象和数组进 `StructuredField` 的 JSON 文本框（第 14–27、67 行）。`027d` 的 `FlowWorkspace.tsx` 接有 clipboard context 与 prepared resources。当前该文件和脏工作区都没有这两处接线。`FlowProfessionalDraftEditor`、`flowDocumentBlock` 没有任何提交。未跟踪的 `src/main/workbench/projectFiles/componentSourceClosure.ts` 已被修改过的 `componentPlatformFileInput.ts` 引用。
- 失败链：执行者用 `6d93` 或 HEAD 整文件替换 `027d` 的 App、Store 和三个工作区，菜单、专业控件和 Flow 剪贴板回到缩减版。若再按第 311 行只保留 backend，工作区里的专业草稿、`documentClipboard.ts` 的身份表和源码闭包一起丢失，file input 随后无法编译。
- 最小修正与 owner：Root 改第 11 节。上述 UI 路径只许在 `027d` 版本上按行为移植。E1 的切片包含全部 dirty 和两个 untracked。I/A 列出只存在于工作区、必须重放的符号。`2acf6188`、`cf93bd70` 写明允许路径，排除 App 与 Store。`3190e0e9`、`e3f0a018`、`05140b2e` 改为「已含于 `027d` 的 store 解耦」。`c1b44439` 改为 slide 插入容器经验，Flow 全局插入标为未提交。

脏工作区里需要按模块评估、不能标成 backend 的用户可见文件包括：

- `src/renderer/ui/FlowWorkspace.tsx`
- `src/renderer/ui/workspaces/FlowWorkspaceConnector.tsx`
- `src/renderer/ui/workspaces/SlideLocationWorkspace.tsx`
- `src/renderer/ui/workspaces/SpatialLocationWorkspace.tsx`
- `src/renderer/document/SharedDocumentEditor.tsx`
- `src/renderer/document/editorSession.ts`
- `src/renderer/document/documentClipboard.ts`
- `src/renderer/store/editorStore.ts`
- `src/renderer/store/slices/flowAuthoringSlice.ts`
- `src/renderer/componentPlatform/surfaces/flow/documentProjection.ts`
- `src/renderer/components/CourseV10RuntimeView.tsx`
- `src/renderer/components/ComponentNavigationOwner.ts`
- `src/player/components/ComponentPlatformRuntime.ts`
- `src/shared/contracts/component-platform/teacherController.ts`

`editorStore.ts` 的未提交 diff 约 5 行，却把 Flow/Spatial 的内容提交接到 slide 的 `beginSlideDataEdit` / `commitSlideContentEdit`，并把跨表面命令的 spatial 写成 `{ ...slide, ...spatial }`（当前 `editorStore.ts:71-75`）。这是未验证接线，不能整段贴回 `027d`。

### 3.2 B0 可能写到正在使用的 Owner 仓库，且还没有可退回的稳定版

- 影响维度：实施阻断、用户原件丢失。计划缺陷。
- 计划位置：第 33、38–42、280、284 行。
- 证据：`D:/果铃工作台` HEAD 是 `64d97fa2`，分支 `main`，porcelain 920 条。计划写「路径以工具返回为准」，并在支持范围通过后「替换 Owner 使用版本」。第 30 行已承认 `027d` 本轮未经实机确认。
- 失败链：worktree、checkout、reset 或 clean 落到 `D:/果铃工作台`，920 条本地改动被清掉。B0 实机参照失败时，第 280 行要求回到「上一个已证候选接口」，而这个接口尚不存在。未观察的 `027d` 或当前 V10 候选会被当成日常版本。
- 最小修正与 owner：Root 写明 B0 禁止对 `D:/果铃工作台` 做任何 git 写操作。替换只许新目录，且须 Owner 另批。E1 先核对目标 realpath。实机参照通过之前，不得把 `027d` 或当前候选称为稳定原版。

### 3.3 恢复对象和当前宿主写反了

- 影响维度：实施阻断、双 writer。计划缺陷，叠加过时入口文档。
- 计划位置：第 68–70 行。对照 `EXECUTION_PLAN.md` 约第 147 行，以及 `AGENTS.md` 自动加载硬边界里「同步入口时源码仍使用 Course Project V9」一句。
- 证据：`027d` 的宿主注册 V9，没有 `CourseV10Driver`。当前 `DocumentHostService.ts:61` 只有 Markdown、Text 和 `createCourseV10Driver()`。`editorStore.ts:62` 只构造 `CourseV10DocumentBridge`。
- 失败链：执行者把当前 HEAD 当成要保全的成熟 V9，缩减界面被留下。或者按旧执行计划再注册一个 V9 driver，同一 `documentId` 出现两个 writer。
- 最小修正与 owner：Root 在本计划写明，`6d93` 起宿主已是 V10，`027d` 才是最后一版 V9 注册树。恢复从 `027d` 的界面出发，正式写入只换到一个 V10 driver。`AGENTS.md` 该句要改必须 Owner 确认。

### 3.4 多个 UI 包被预先判成整模块替换

- 影响维度：用户功能退化。计划缺陷。第 4 节的 A/B/C 规则本身是对的，第 6.1 节和第 7 节的预判越过了这套规则。
- 计划位置：第 146–151、163、194–203 行。

| 包 | 证据 | 失败链 | 最小修正 |
|---|---|---|---|
| A0 | 独占文件是接线壳。顶栏、页面栏、草稿 flush、媒体正式插入在未分配的 `TopToolbar.tsx`、`CourseLightToolbar.tsx`、`LessonWorkspaceHost`、`commitCourseMediaAuthoring.ts`。未挂载的 `ComponentPlatformApp.tsx` 只有裸按钮 | 用缩减壳替换 `App.tsx` 后，菜单、Ctrl+S 草稿和媒体导入消失 | A0 补这些文件，只改生命周期调用。禁止 `ComponentPlatformApp` |
| S0 / G1 | 当前产品源码没有 `SlidePhaserNode` 的生产挂载。`SlideSurfaceView.tsx` 自带选区、编组和快捷键，没有挂载点。`027d` 里 Phaser 仍是 slide 几何类型 | 用 `SlideSurfaceView` 替换 `SlideLocationWorkspace` 会丢掉直线端点、试运行和画布菜单。两套同时挂上则几何双 owner | S0 保持 `SlideLocationWorkspace`。Phaser 退出落在运行挂载文件，不作为重写作者 DOM 的理由 |
| N0 | 画布文字已是 inlines/math（`components/text/data.ts`）。`TextNode{text,runs}` 是 V9 类型。公式入口在 `components/text/editor.tsx`，表格和图表仍走 `CanvasPlainTextEditor` | 按 TextNode 重写后，行内公式被摊平，非 PM 输入被换成整篇正文 | N0 只适配 ACK。plain input 保持原生 |
| F0 | `editorSession.ts:27` 的 `DocumentCommitResult` 已含 Promise | 为接 ACK 重写 EditorView，打断现有焦点、IME 和本地草稿 | F0 只保留已有 Promise 分支 |
| F1 | `FlowWorkspace.tsx:136-138` 对 `editCaptured` 使用 `void` 后立刻 `return true`。`FlowOverlayAuthoringLayer.tsx` 不在活路径上 | 重写 Flow，或把未挂载浮层接回去，形成两套 UI | F1 接回两个 clipboard prop 和真实 ACK。禁止挂 legacy slice |
| Q0 | `ComponentSourceEditor.tsx:34-36` 在 owner 仍被共享时新造 `ownerId`，只写当前实例。`ComponentSourcesEditor.tsx` 的共享入口已无生产调用方 | 整文件持有现在的 `DeveloperTab` 后，共享 N 实例没有入口 | 只改 `027d` 的 `DeveloperTab` 挂载点。`ComponentSourceEditor` 只作 helper |
| W0 | `spatialAuthoringIntents.ts` 的 `CommandPort` 没有产品调用方。活路径是 `captureTarget` + `editCaptured` | 复活 CommandPort 后，同一世界有两个 writer | 沿现有 Spatial 工作区适配，不重写世界编辑器 |

owner：计划正文 Root。脏 diff 里哪些行为要重放，由 I/A 决定。各包只写自己的挂载点。

### 3.5 并发图会让叶子制造假接口，首条用户链被运行时拖住

- 影响维度：实施阻断。计划缺陷。
- 计划位置：第 161、212–217、220–236 行。
- 证据：编辑落笔是 `CourseV10RuntimeView` 里的 `bridge.edit`，保存走 Bridge 和 Host。`App.tsx:107-132` 已经按文档挂着这份 runtime，非当前文档用 `hidden` 留着。`compileComponent` 只在解析自定义源码时使用。第 215 行要求 A0 等整份 R0，第 161 行又让 R0 等 Q1、M1、T0 和 R1 导航片。
- 第 212 行把 N0、F0、X2/X3/X4 和 R1 整包放进第一组。`components/text/editor.tsx` 直接 import F0。`pptx/index.ts` import X3 的 `presentation.ts`，`reading.ts` 又绑着 K0 frame。`publishedPlayer.ts` import R0，R0 的 `ComponentNavigationOwner.ts` import R1 的 graph。接口未到时，这些包只能复制 DTO 或 stub。
- `editorStore.ts` 同时实例化 lifecycle、flow、spatial 和 `createCrossSurfaceCommands`。F1 的 `flowAuthoringSlice.ts` 又 import `FlowWorkspace.tsx`。K0 还独占 `DocumentToolGateway.ts`（约 1154 行），H1 却要改其中的内容叶。`ipc.ts`、`preload/index.ts`、`ipcTypes.ts` 没有 owner。`geometry/index.ts` 不导出 `flowObjectExtent.ts`，这两份纯算法可以并行。
- 失败链：Slide 的编辑、属性、复制、撤销和保存要等编译器、教师控件、Player 和导出。两人同时改 Store、Gateway 或 `ipc.ts`。格式包各自写一套 frame 类型。
- 最小修正与 owner：Root 改第 8 节。第一组只允许不改合同字段的纯文件：`geometry/index.ts`、`drawingMlRotation.ts`、`flowPageBox.ts`，以及 R1 的 `camera.ts`、`graph.ts`、`spatialTargets.ts`、`fragments.ts`、`componentSpatialAdapter.ts`。N0 整包、F0 的 ACK、三个格式包的 index、`publishedPlayer.ts` 移出第一组。I 先冻结 Slide 实际用到的 operations、Bridge 和 kernel。`editorStore.ts`、Host 构造和 Gateway 只做短 hunk，由 I 排队。H1 把 apply 留在已归自己的 `applyService.ts`。F1 把 slice 对 `FlowWorkspace.tsx` 的反向 import 移出组件文件。`ipc.ts`、preload 和 `ipcTypes.ts` 明确归 K0。

### 3.6 正式提交链是断的，owner 被拆开

- 影响维度：保存丢字、撤销对象错误、重开丢媒体。已知产品缺陷，计划把收口拆散，因而成为计划缺陷。
- 计划位置：第 75–82、150、290–293 行。同一条链被分给 F0、F1、C0、L0、N0、P0、A0、K0。
- 证据：`FlowWorkspace.tsx:128-138` 在 `void bridge.editCaptured(...)` 之后 `return true`。失败只进 `preserveRejectedDraft`。`editorSession.ts:375-378` 在 `change()` 不是会拒绝的 Promise 时不 `discard`，本地正文已经前进。`submit` 不读 `operation.preparedResources`。`flowDocumentEdits` 不产生 `asset.add`。`useMediaImport.ts` 在插入失败后仍单独提交 `asset.add`。`CourseV10DocumentBridge.edit()` 在发送时重新 `captureTarget()`。带 `activeStateId` 的操作会写到等待期间的当前状态。
- 失败链：用户看到新字，独立重开仍是旧字。撤销撤的是上一条已成功操作，屏幕留着被拒正文。带图粘贴后引用在、字节不在。失败提示出现时，素材已经进 History。异步编辑写到另一页。
- 最小修正与 owner：F0 持有「只有 applied 或 unchanged 才推进 ProseMirror baseline」。F1 让 `submit` 返回同一次 `editCaptured` 的 Promise，并把 prepared bytes 放进同一次 `captureComponentOperation`。组合输入在提交前用同一 `documentId` 重新捕获，文档已变则取消并留草稿。K0 的 `edit()` 不再作为异步入口。媒体失败不得再开第二条事务，owner 是那一次 apply。

当前活 store 只有 V10 Bridge，没有把 V9 Session writer 和 V10 Driver 同时挂在同一 Flow 文档上。再把 `legacyFlowAuthoringSlice`、`CourseDocumentBridge` 或 `prepareFlowDocumentResourceTransaction` 接回这份文档，才会双写。

### 3.7 复制 course-instance 会断引用，或两个名字指向同一对象

- 影响维度：数据错误。计划缺陷加上未闭合的产品路径。
- 计划位置：第 155、292 行。
- 证据：`documentAdapter.ts:130` 对 `course-instance` 不换 block id。`documentClipboard.ts` 的 `prepareDocumentClipboard` 给所有 block 换新 id，不克隆 `project.instances`。`documentProjection.ts` 在工程里找不到该实例时抛「正文引用的正式实例已不存在」。画布克隆在 `crossSurfaceCommands.ts`，粘贴路径没有把 course-instance 送进去。`identity === 'move'` 只有判断，没有调用方。跨文档若保留 asset id，会绑到目标里另一份同 id 字节。
- 失败链：跨文档粘贴后正文实例丢失，或两个块共用一个实例。移动跨文档后图片内容张冠李戴。
- 最小修正与 owner：C0 在准备阶段把 course-instance 交给已有的 `prepareCourseObjectPaste` 或 L0 collector，同一次 `editCaptured` 写入新实例。F0 保持豁免，直到这次克隆存在。跨文档 asset 一律新 id。move 在有调用方之前保持第 292 行的「尚未证明」。

### 3.8 改名后续作仍指向旧路径，关闭文档不收回预览

- 影响维度：重开失败、运行残留。已知失败，计划没有单一字段 owner。
- 计划位置：第 161、179、291 行。
- 证据：`DocumentSession.rebind` 只改 `state.binding` 并 `notify()`，不发 `saved` 事实。`ExecutionEngine` 的 `savedBindings` 只在 `status === 'saved'` 时更新，之后 `persistRecord` 用旧绑定覆盖记录。续作再 `documents.open` 旧路径，得到 ENOENT。`project.title.set` 只改标题。`CourseV10DocumentBridge.close` 只 `drain` 和 `projection.dispose()`。`App.tsx:107-132` 对非当前文档用 `hidden` 留着 runtime。`useCourseDelivery.ts` 的预览 world 只在预览关闭时 dispose。`setPlaying(false)` 只 pause。
- 失败链：另存或改名后，最近项目和续作打开已不存在的路径。关掉课件后预览仍挂在冻结快照上，旧实例还能响应。
- 最小修正与 owner：路径字段的单一写入者是 `DocumentSession.binding`。`rebind` 发出与保存相同的绑定事实，续作和最近项目只订阅它。标题只作显示名。文档 `close` 同一处销毁该文档的作者 world 和预览 player。试运行退出保持 pause，并保证 pause 后不能再 `dispatch`。

### 3.9 旧 V9/V2 写入还在正式路径上，N10 没有文件名单

- 影响维度：数据写入错误目标、两套导出。计划缺陷。
- 计划位置：第 217、349、363 行只写「旧 consumer 同切换退出」。
- 证据：菜单导出已走 V3 `buildComponentDelivery`。`precommitDynamicFallback.ts:62-72` 仍调用 `buildPublishedCourseTryRunPayload`，并要求 `course-v9`。`nativeAuthoringTool.ts:60` 的 `native.content` 仍走 `addSlideFormulaLayer` 等 V9 命令。`App.tsx` 的 HTML 导入仍进 `HtmlImportService.ts`，该服务不在 H0/H1 写域。`ExternalMcpService` 可挂 `course.createFromHtml`，未 attach 文档时这次写入没有 V10 undo。`player/RuntimeHost.ts` 和 `player/surfaces/slide/SlidePublishedAdapter.ts` 仍挂 Phaser。`src` 中没有 grapes 引用。`package.json` 有 phaser。
- 失败链：同一课菜单导出是 V3，动态预览和 AI `native.content` 仍写 V9。HTML 导入与 content apply 各提交一次。Player 继续用 Phaser mount，作者几何已经是 affine。
- 最小修正与 owner：K0 改 Bridge 的捕获调用。R1/X0 提供 V3 捕获。H1 改动态准入，并把 `native.content` 委托到同一个 apply。A0 只改 App 里导入的调用点。这些文件在切换当批退出。R0/R1 点名 `RuntimeHost.ts` 和 V2 slide Phaser mount，只保留明确的局部游戏或模拟。G0 不必作为三表面前置。计划写明薄投影就是 N00b 的决定即可。

### 3.10 内容应用会整次拒绝，或按视口重写人工 frame

- 影响维度：内容进不去、位置被覆盖、专业字段变默认值。计划缺陷。
- 计划位置：第 166–169 行。
- 证据：`applyService.ts` 对非 `guoling.web` / `guoling.html-program` 的 HTML `content` 直接抛错，整次 `not_committed`。局部 `content` 已有测试锁住不测量。redo 走另一条：`ElectronHtmlDesignMeasurement.ts` 在 `documentKind === 'document'` 时默认 `viewport`，`plan.ts` 对容器 redo 先删除全部子项再按测量结果插入。`html.ts` 在投影节点是 `body` 时把整份 HTML 送去测量。Flow 读回表格时新列宽默认 200、新行高默认 40。图表块的 `height` 不在 `chartDataSchema` 里，读回时没有 chart 分支。
- 失败链：局部改文字、表格或公式被整次拒绝。局部 redo 把邻居 frame 换成视口框。Flow 里改表格结构后再投影，列宽和图表高度变成默认值。计划里的「局部改字」样本走 `content`，证不到这条 redo。
- 最小修正与 owner：H0 让非 web 的 `content` 走已有专业 `data.set`。缺 adapter 时保留该对象并给出诊断，不要整次抛错。M0 让局部 redo 使用内容边界。证据改成一次真实的局部 redo。F1 独占 `documentProjection.ts` 的 table/chart 回写。schema 只许一处改 `content.ts`。`htmlText.ts` 继续只做正文抽取。

### 3.11 原目标里有几项没有实际 consumer

- 影响维度：做完计划仍不能完成对应的编辑、运行或比较。计划缺陷。
- 计划位置：第 12 节映射表，以及第 217、347、349 行。

| 原目标 | 状态 | 缺口与失败链 | 最小修正 |
|---|---|---|---|
| N00a | 路径被收窄 | 合同、默认组件、编译和 V3 producer 有主。有效预览掉进 L03 | 见 L03 |
| N00b | 路径被收窄 | G1/S0 有薄投影。GJS 不在 `src` 中。Phaser 运行挂载没有同批退出文件 | 写明薄投影即决定。Phaser 退出见 3.9 |
| N01 | 无 consumer | 第 349 行只有「人AI局部共编」。AI 卡在 `ElementAiCard.tsx`，计划全文没有 `elementCards/` | 把 `elementCards/` 扩进 P0 或单列一包。证据为同一 captured target、一次 ACK、一次撤销同时还原人工与 AI |
| N02 | 有路径 | Q1 与 R0/D0 | 保持 |
| N03 | 路径被收窄 | 三表面作者包在。主 Phaser 几何退出无文件 | 见 3.9 |
| N04 | 路径被收窄 | Flow 会话在。填空、选择、条件显示不在已绑定叶里 | 见 L18 |
| N05 | 路径被收窄 | 文字、表格、图表有路径。图片派生和输入组合被叶名裁掉 | 见 L14、L18 |
| N06 | 路径被收窄 | 动效取消有 V0/R0。导航过渡和关闭控制台后的同一导航不在 L07 映射里 | 见 L07 |
| N07 | 路径被收窄 | 测量和文件工具有路径。HTML 导入与 apply 仍是两个 writer | 见 3.9、3.10 |
| N08 | 路径被收窄 | V3 导出与 Player 有路径。正式动态捕获仍生产 V2 | 见 3.9 |
| N09 | 路径被收窄 | L0/C0 能提炼并插入。混合比较样本没有 fixture owner | 见 L26 |
| N10 | 无 consumer | 只有最终切换一句，没有旧入口写域 | 每个切换包同批删除自己的旧 consumer，包括 `buildPublishedCourse.ts` 与已无调用方的 `buildCoursePptx.ts` |
| L01、L02、L04、L05 | 有路径 | 几何、测量、内存编译、运行核有文件和证据句 | 保持 |
| L03 | 路径被收窄 | `createContentPreviewResource` 在 `contentResources.ts`，产品代码没有调用点 | H1 接到资源准备。导入失败仍不整份拒绝 |
| L06 | 有路径，文件未点全 | `MotionScope` 在 V0 目录内。`NavigationTasks.ts`、`componentMotionAuthoring.ts`、`PublishedDomInteractionSurfacePort.ts` 的取消函数未点名 | V0 写明这些文件。切页调用 R0 已有的 `cancelMotions` |
| L07 | 路径被收窄 | 映射到 T0/R0/A0/C0。`player/behaviors/navigation/shortcuts.ts` 无主 | V0 独占 `player/behaviors/navigation/**`。L07 改为 T0/R0/V0 |
| L08 | 路径被收窄 | G0 可以不做。`src` 无 grapes，不存在 GJS 与 Phaser 双写作者投影 | 写明薄投影就是决定，G0 不作为三表面前置 |
| L09 | 路径被收窄 | 人工命令有 K0/S0/F1/W0/P0。AI 卡没有写域 | 同 N01 |
| L10–L13、L16、L17 | 有路径 | Slide、Spatial、Flow、文字公式、表格、图表有对应包 | 保持 |
| L14 | 路径被收窄 | D0 只点名 data/runtime/output。`components/image/edit.ts`、`transform.ts` 未绑定 | D0 绑定这些文件，并写明调用现有 `MediaFilesService` |
| L15 | 路径被收窄 | 形状数据和几何有主。一次定制后恢复默认且保住 frame，没有接到 Q0 | 定制证据归 Q0 |
| L18 | 路径被收窄 | `components/input/behaviors.ts`、`choice/index.ts` 未被 D0 叶名绑定 | 派发时绑定这些文件。Slide 与 Flow 各点一次 |
| L19 | 路径被收窄 | H0/H1 有 apply。`HtmlImportService.ts` 不在写域 | 同 3.9 |
| L20 | 有路径 | Q2 的文件协调器、H1/K0/A0 的保存在。交付半段在 X1，映射表上容易被 Q2 单独销账 | 第 12 节把 L20 的交付入口指到 X1 |
| L21 | 路径被收窄 | X0 有 V3 producer。V2 `buildPublishedCourse` 仍被正式后备捕获调用 | 同 3.9 |
| L22、L23a、L23b、L24、L25 | 有路径 | Player、PPTX、DOCX/PDF、库、Skill 有文件和「实际打开」或「能力交付后才写」的证据句 | 保持。PDF 页型、DOCX px→pt、PPTX style、source group 捕获是计划已承认的缺口，目录已经落到对应包 |
| L26 | 路径被收窄 | 原 fixture 与 journey 无写域。Z0 只写文档，且不自动做生成比较 | 指定一个包独占混合样本 fixture 和一条命令。E3 只执行该命令 |

### 3.12 现有证据门可以在行为未发生时放行切换

- 影响维度：未验证候选替换日常版本。计划缺陷。
- 计划位置：第 138、146、212、251、255、259、272、278 行。
- 证据：A0 的证据箭头是「新建、编辑、Ctrl+S、关闭」。菜单、脏关闭、磁盘导入、Flow 图片快捷栏、三种表面各自试运行都写在保全口号里，不在必做动作里。第 212 行把 G1、Q1、M1、D0、V0 放进可提前完成的纯叶，第 251 行不给纯叶 UI 矩阵。`DocumentRegistry` 在绑定还在时直接返回现有 Session，不重新 `load()`。第 272 行允许 IME 未观察，N0 仍可随 UI1 的 caret 输入完成。禁令只禁止 E 改断言。作者可以改断言，再把自测写成 UI 通过。
- 失败链：Ctrl+S 通过后，键盘路由、未保存关闭和媒体导入仍是坏的。unit green 放开 S0/F1。同进程 `file.open` 显示内存里的新内容，磁盘未被重读。ASCII 输入被当成中文输入法已保全。
- 最小修正与 owner：Root/Astra 把下列动作写成对应包的切换条件：原菜单点一次；一组会改正式数据的快捷键；脏关闭后独立重开；一次磁盘媒体导入；Flow 图片快捷栏写入正式资源；Slide、Flow、Spatial 各自试运行再回编辑。unit、类型和 build 只释放接口。G1、Q1、M1、D0、V0 在指定的真实 Main 共证前不得标完成。重开后必须是新的 `documentId`/`epoch`，或 E3 的新进程。未做真实中文选词，N0/F0 的输入法属性不得通过。UI 通过只认固定 cut 上的 E3 记录。

第 245 行已经把提交、类型、build、后端 unit 和 DOM case 限制为各自属性。历史 J1、四页 PDF 和 N09 也写了不能据此判整体通过。这次会假通过的是漏掉的动作和完成门，不是把旧证据再写成整体通过。

## 4. 修正后的首条真实用户链

1. E1 冻结当前全部 dirty 与 untracked，并确认目标目录不是 `D:/果铃工作台`。从 `027d588a` 建立独立工作树。E3 对这份原版做一次参照，至少覆盖菜单、输入、保存、Flow 剪贴板和专业控件。参照未通过时只记录原版缺陷，不称为稳定版。
2. I 只交付 Slide 编辑已经在用的端口：operations、Bridge、kernel、Driver 注册。不交付整份 Gateway、Published、motion 或教师合同。
3. 与之并行的只有不改这些签名的纯文件：几何数学、`flowPageBox.ts`、`drawingMlRotation.ts`、R1 导航 helper。D0/T0 里不改 K0 字段的算法可以同批。
4. S0、P0、C0、N0 沿 `027d` 的现有挂载点适配。I 用一次短 hunk 接上 `editorStore.ts` 的 flush 和命令构造。A0 只改生命周期调用，以及 `App.tsx` 里已有的键盘、保存和 runtime 挂载。
5. 首条链到此为止：Slide 插入、选中、文字输入、属性修改、复制、撤销、Ctrl+S、正常关闭、新进程从落盘重开。P0 和 C0 属于这条链。Q1、T0 完整控件、R1 Player、X0–X4、G0 和 Flow 都不在这条链上。
6. 下一条才是 Flow：F1 接回 clipboard 两端口和同批资源，`submit` 返回真实 ACK，组合输入按捕获目标提交。W0 沿现有 Spatial 工作区接入。自定义源码、测量 redo、三格式打开和旧 consumer 退出按各自直接调用者滚动，不回到首链前面。

## 5. 计划里已经写对、本次不另报的点

- `027d` 是 `6d93` 的直接父提交，代码与 `5f6fa9d7` 相同，计划没有把整棵 tree object 说成相同。
- 第 30 行没有把 `027d` 写成已验收稳定版本。实施时重取清单的要求，覆盖了「保存前 HEAD 是 `063f77e2`」与当前 `b0076bc0` 之间只增加计划文档的差别。
- 第 4 节要求先写 contract、失败证据和三种选择，禁止先全量改写再补理由，禁止删控件、隐藏动作或静默静态化。
- 同一文档一个正式 writer、不回灌 V9 History、不建转换器，与架构合同一致。当前活 store 已经只有 V10 Bridge。
- 21 槽只是容量观察，不设人为起跑门。App、World、Player、交付根从 I 拆开的方向是对的。缺的是首链仍把整份 R0 放在 A0 前面，以及 K0 文件面过大。
- Flow Max-depth 根因未证明，禁止用 memo 或 timeout 猜修。这个禁令应保留。
- 正式 History 在 Main `DocumentSession`。成功的媒体插入和替换可以是同一次 batch。store 里活的 undo 是 `crossSurfaceCommands.undo`。
- L02、L04、L05、L10–L13、L16、L17、L22、L23a、L23b、L24、L25 有交付路径。
- 内容 realm 复用现有 preview origin，计划没有要求新建通用 OS 沙箱。

## 6. 待确认

这些不影响第 1 节的结论。

- `027d` 启动后是否稳定。本次只核对了源码和 git，没有启动应用。
- 脏 diff 里 Flow 专业草稿，以及 `spatial: { ...slide, ...spatial }`，在运行中是修复还是写错表面。
- Flow Max-depth 的唯一因果。只读可以看到 `stateChanged`、`store.patch` 和投影回放形成环，不能证明哪一跳变成无限更新。
- NativeText 的 Vitest 退出码 1。源码里有 jsdom shim，本次没有复跑。
- `useEditorKeyboardRouter.ts` 对 Ctrl+C/X/V 直接 return，而 `App.tsx` 仍把该端口接到 `pasteNodes`。需要一次真实按键确认。不能为了单测再调一次 `execCommand('paste')`。
- MCP 的 `ExportFormat` 目前只有 HTML 三类。若原 L23 要求工具也交出办公文件，X1 还要补这一支。
- `D:/果铃工作台` 的 920 条 porcelain 里，用户课件与工具改动各占多少。未逐条分类。对该仓库做 git 写操作的风险已经成立。

## 7. 审查边界

本次提交的是这份审查报告，不是改写后的执行计划。产品代码、任务板和 `AGENTS.md` 都没有改。10 路子审查的路径和行号，凡写入第 3 节的，均经过本会话对 git 记录或所列源码的复核，或与至少一条直接读到的调用链一致。未复跑的测试和未启动的界面放在第 6 节。
