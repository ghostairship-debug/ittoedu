# 独立评审（Claude Opus 5.5）：稳定基线恢复与 V10 渐进替换计划

| 项 | 内容 |
|---|---|
| 评审者 | **Claude**（Anthropic Claude Opus 5.5，模型 ID `claude-opus-5-5`），受 Owner 委托做独立只读评审 |
| 与方案的关系 | 不是方案作者（Root）、方案审阅者（Astra），也不承担执行角色（Luna/Sol）；Astra 的已有结论没有作为前提 |
| 日期 | 2026-10-05 |
| 被审文档 | `docs/development-plan/component-platform-refactor/BASELINE_FIRST_V10_EXECUTION_PLAN.md`，承载 `D:/果铃恢复候选/20261005-authoring`，分支 `codex/authoring-recovery-20261005`，提交 `b0076bc0` |
| 结论 | **修正后可实施** |

本文只是评审意见，不是任务卡，不改变任务板状态。被审计划和产品源码均未修改。

## 评审范围与方法

- 只读：git 历史、diff、grep，对比冻结工作树、`027d588a`、`6d93aca0`、HEAD 与 Owner 工作区。参考了 AGENTS.md、架构合同、原执行计划的 N/L 定义、UI 补充方案（U0–U13）和创作管线补充方案。
- 没有构建、运行测试、调用模型、回退或新建 worktree，也没有派子智能体。
- Owner 提示限速后停止了逐文件深查；未逐一核实的条目标为“待确认”。
- 计数方法见附录 A，主要证据位置见附录 B，均可复核。
- 类型标注：
  - 【计划缺陷】计划本身需要修改；
  - 【产品缺陷】当前 V10 材料中已经存在的产品问题；
  - 【维护建议】不阻塞实施；
  - 【待确认】需要 Owner 决定或进一步核对。

## 结论：修正后可实施

路线方向成立，但按现有写域和依赖顺序执行，会重演 6d93 那次“硬切换 + 缩减 UI”。下面三处缺口需要先补，都能在现有路线内补清单、补 owner、改首链解决，不需要换路线或建新平台。

1. **driver 是整机硬切换，计划没有定义切换批次。** 027d 的 `DocumentHostService.ts:61` 只注册 V9 driver，V10 材料同一行只注册 V10 driver。K0 一旦切换，所有直接读写 V9 模型的模块会同时失去模型。计划说“先接 Slide，再加 Flow、Spatial”（§2.3 L51），但没有说明切换那一刻其余模块怎么办。
2. **owner 覆盖不全，而且比它取代的 U0–U13 方案还少。** 计划 L70 自己规定“直接 consumer 必须改，不能用 V9 虚拟工程”，但：
   - 027d 中直接依赖 V9 模型的源文件有 382 个，339 个不在任何写域；
   - 渲染层以外带 `'course-v9'` 判断的文件有 40 个，计划只覆盖 5 个；
   - V10 材料改动过的 467 个文件中，220 个不在任何写域。
3. **两处会造成数据错误的共享文件没有 owner，现有验证链也测不到：** DocumentSession 的 revision 初值，以及恢复日志的格式检查。

## 一、基线与保全

### 1.1 候选基线选择成立（无需修改）

- 027d 的父提交是 5f6fa9d7（合并 567b176b 与 96ef77bd）。从 5f6f 到 027d 只改了 4 个文档。6d93 的父提交就是 027d。027d 的 src 中没有出现 `course-v10`。A–G 七条子线和快照 7f075574 都已包含在 027d 中。
- Owner 工作区 `D:\果铃工作台` 的 HEAD 是 64d97fa2，但磁盘上的 src、tests、scripts 与 027d 完全一致：027d 的 2472 个文件都在且字节相同，没有多出的文件。另有 8 个文件在 64d97fa2 中被跟踪、工作树中已删除（旧 MCP 文档服务、S12 测试等），027d 同样没有。也就是说，“原版”就是 Owner 现在在用的代码。
- 已有一个干净承载正好停在 027d：`D:/果铃-restructure-worktrees/20261004/integration`（分支 `g20/restructure/integration`，无改动）。它属于仍为 active 的 creation-restructure 卡，复用前要先协调。
- 孤立提交 dadd3c33（只被 prunable worktree `component-platform-l02` 引用）的内容已被 6d93 吸收：5 个文件中 4 个完全相同，`browserCapture.ts` 已继续演进。不会丢失。
- 可复用来源中，3190e0e9、e3f0a018、05140b2e 已在 027d 中；§11 列出的其余提交都在 027d 之后，需要按文件和 hunk 提取。计划的处理方式正确。

### 1.2 “替换 Owner 使用版本”没有可执行方式【计划缺陷｜保全】

- **位置：** §2.2 第 6 步（L42）；L33、L44 规定不覆盖、不重置、不 stash。
- **证据：** Owner 工作区是 main@64d97fa2，加上以未提交形式存在的整份 027d 内容（src/tests/scripts 中有 231 个未跟踪文件），以及 10-05 更新的未跟踪计划文档。
- **失败链：**
  - 在该目录切换到候选分支时，git 会拒绝覆盖未跟踪文件，或者需要 clean/stash，而计划禁止这样做。结果是要么卡住，要么有人违规清理，丢掉 Owner 的未跟踪文档。
  - 替换后，Owner 现有的 V9 `.h5lesson` 原件打不开：V10 codec 会报“此入口仅支持独立 Project V10；旧工程原件未改变”。不兼容是 Owner 已接受的决定，但原版需要保留，用来打开旧原件。
- **修正（E1/Root）：**
  - 记录“Owner 工作区等于 027d”这一事实。
  - 把替换定义为：新版本在独立承载和独立 profile 中运行，不在该目录内 checkout。
  - 原 V9 应用保留可运行，何时退役由 Owner 决定。

### 1.3 E1 盘点范围偏窄【维护建议】

- 另有 5 个 `D:/果铃-followup-worktrees/20261003/*`，各有约 2.9k 条未提交项，看起来是同一份旧快照（是否有独有内容【待确认】）。
- 另有约 30 个 codex worktree 记录标为 prunable；仍存在的几个目录都没有未提交改动。
- E1 盘点时一并列入即可，不需要新流程。

## 二、前端保全与修改动机

### 2.1 大量直接 V9 consumer 没有 owner【计划缺陷｜阻断·退化】（最重要）

- **位置：** §5 写域（L122–134）、§6 全表。

**无 owner 的用户入口（均在 027d 中直接依赖 V9 模型）：**

- **App 壳层：**
  - TopToolbar；
  - ScenePanel：L45 直接用 `CourseProjectDocument`，L53 引用插入菜单 `AddCourseContentMenu`；
  - BottomSceneNavigator：L3–4 引用 V9 presentation 和 `SlideSceneDocument`；
  - SceneThumbnail、SceneStateStrip。
- **Store：**
  - `courseStructureSlice`：被 editorStore 和 crossSurfaceCommands 引用；
  - `slideOwnedCommands`：被 editorStore 和 slideAuthoringSlice 引用，内部调用 `commitV9SlideContentEdit`、`layerCommands`。
- **编辑功能：**
  - 互动与运行作者：InteractionEditor、CourseLogicAuthoringPanel、`interactions/*`、AutomationTab、`runtime/*Authoring*`（8 个）；
  - 媒体：`media/commitCourseMediaAuthoring`、`courseMediaLibraryImport`、ElementsTab；
  - Spatial：SpatialCameraPanel、SpatialPathEditor、`course/spatial{Camera,Path,Relation}Commands`；
  - 其他：TeacherControllerAuthoringChrome、WorkspaceRecoveryPanel、ProjectHealthPanel。
- **试运行：**
  - `coursePlayerTryRun` 仍走 V9 和 Published V2，在 027d 中同时被 S0（SlideLocationWorkspace、SlideWorkspaceConnector）、F1（FlowLocationWorkspace）、X1（useCourseDelivery）的文件引用；
  - 另有 `flowLocationTryRun`、`spatialLocationTryRun`。
- **导入：** `renderer/project/pptx*`，入口在 App、WorkspaceFilesTree、PptxImportForm。V10 已经移植过 `pptxCourseCreation` 和 `pptxImportTransaction`，但没有包负责把这部分提取过来。

**对照：** 被取代的 `UI_REINTEGRATION_EXECUTION_PLAN.md` L60–73 中，U0/U1/U2/U4/U6/U7/U8/U9/U10/U11/U12/U13 点名了上述大部分文件。新计划重新划包时把它们丢了。

**V10 材料对成熟模块的删减（027d→HEAD）：**

| 文件 | 删除行 / 新增行 | 本计划 owner |
|---|---|---|
| SlideLocationWorkspace | −4062 / +525 | S0 |
| slideOwnedCommands | −1120 / +28 | 无 |
| ScenePanel | −994 / +178 | 无 |
| commitCourseMediaAuthoring | −817 / +234 | 无 |
| commitInteractionAuthoring | −514 / +41 | 无 |
| AutomationTab | −309 / +82 | 无 |
| BottomSceneNavigator | −306 / +83 | 无 |
| SceneThumbnail | −301 / +109 | 无 |
| courseStructureSlice | −278 / +167 | 无 |

- **失败链：** K0 切换 driver 后，这些模块收到 V10 模型，出现编译错误或运行时 TypeError。为了让首链通过，执行者只能就地删减或做桩，于是页面管理、插入菜单、互动、试运行、PPTX 导入再次退化。这正是本计划要纠正的问题。
- **修正（Root 做一次，A 裁定退役项）：**
  - K0 切换前，用软件生成一份 consumer 清单：查 V9 类型、`'course-v9'` 判断、V9 Bridge 和 Store 的引用方。
  - 每个文件落到唯一的包，或标明“由谁在哪一批退役”。
  - 把 U0–U13 中点名的 owner 接回来：并入 A0/S0/F1/W0/P0/R0/X1/H1，或增设 3–4 个包（壳层与课程结构、互动与运行作者、媒体与导入、AI 执行）。
  - §5–6 中“原 X 直接 consumer”这类兜底说法只覆盖各表面内部，替代不了这份清单。

### 2.2 S0 写“保 DOM、事件、选区、手柄”，与 027d 实情不符【计划缺陷｜阻断·退化】【产品缺陷】

- **位置：** §6.1 S0（L148）、§7（L195）；合同 §0.2（L25）。
- **证据：**
  - 027d 的 Slide 编辑器里，选中、变换预览、移动/缩放/旋转结束、文字双击、公式双击，全部来自 Phaser：SlideLocationWorkspace L51 引入 `createEditorGame`；L2811–2878 注册 `onNodeSelected`、`onNodesTransformPreview`、`onTextDoubleClick`、`onFormulaDoubleClick`；L2984 调用 `loadScene`；L53 用 `hitTestV9SlideLayerItems` 做命中检测。
  - 动画预览也由它订阅执行（L1438 订阅 `onElementAnimationPreviewRequested`）。
  - DOM 只承担选择框和组合内容。
- **已发生的退化：** V10 材料删掉了动画预览的订阅者，但 InteractionEditor 和 SimpleEntranceAnimationEditor 还在调用 `requestNodeMotionPreview`。现在“预览动画”点了没有任何反应，违反合同 §2 第 20 条“禁止静默 no-op”。
- **失败链：** S0 名义上是“原位适配”，实际要替换 Slide 编辑器的指针、选择和变换事件来源，却没有 §4 要求的整模块改写论证。动画预览、公式双击入口、Spatial 的 V9 命中检测（`v9SpatialHitAdapter`）都没人接，结果是静默失效。
- **修正（S0，A 裁定；预览交 V0 或 S0）：**
  - S0 卡逐项列出 Phaser 的职责（渲染、命中、选择、变换预览与结束、文字和公式双击入口、动画预览、Spatial 命中）及各自的新 owner。
  - 同一批移除 Phaser 编辑挂载。
  - UI1/UI5 加“动画预览实际播放”。

### 2.3 “PM 原生 Undo 可保留”与成熟实现相反【计划缺陷｜可能产生第二 History】

- **位置：** §3.2 L82。
- **证据：**
  - `SharedDocumentEditor` 在 027d L128 和当前工作树 L165 都写明“the caller owns persistence and undo; neither editor installs a history extension”，Ctrl+Z 走正式 History。
  - 只有组件源码编辑器在 Apply 前有本地草稿撤销（工作树 `ComponentSourceEditor.tsx:68`），这一点是对的。
- **失败链：** F0 改成异步 ACK 后，执行者依据这句话给 PM 装上 history 插件。之后在 PM 内撤销会生成一条新的正向编辑，焦点离开后再撤销又作用于正式 History，形成双重撤销；AI 的修改也可能被 PM 本地撤销覆盖。
- **修正（K0/F0）：** 改成一句话——“PM 不装 history；PM 内撤销也走正式 History；未 ACK 的输入由草稿和回滚处理；只有源码草稿在 Apply 前有本地撤销。”

### 2.4 AI 创作用的工程文件布局无人负责，V10 已换成另一套【计划缺陷｜退化·阻断】

- **位置：** Q2（L165）“保外部文件体验”；§12 中 L20 的映射（L341）。原 EXECUTION_PLAN L423 曾把 `ProjectFileCoordinator.ts`、`projectFileServices.ts` 分给 L20。
- **证据：**
  - 027d 的工程文件布局是 Owner 10-04 批准、Skill 正在教 AI 使用的：`theme.css`、`slides/NN-名.html`、`docs/*.html`、`spaces/*.html`（impress.js `.step` 写法）、`components/*.html`、`assets/`、`controller/教师控制台.js`。见 027d `.agents/skills/orchestrate-courseware/references/project-files.md`。
  - 合同 §1.2 L73 写明“源文读写归工程内文件 owner”。
  - 这套布局由 13 个 `core/projectFiles/*` 模块和 `projectFileServices` 实现，全部没有 owner。
  - V10 的 `core/projectFiles/componentPlatform/projection.ts` L99–173 改成了 `pages` 索引 JSON、表面级 `.json`/`.html`，以及实例级的 `.content.html`、`.data.json`、`.style.json`、`.source/`。
- **失败链：** 切换后，Skill 指定的路径不存在或映射不同，内置 AI 和外部 MCP 的框架与装配写不进去或写错目标，创作主路径中断。Z0 只能“按实际接口写说明”，等于默默改了 Owner 批准的创作接口。
- **修正：** A 裁定；若改变布局，需要 Owner 确认。建议保留 027d 布局作为投影合同，在 V10 上重新实现读写，由 Q2 持有 `ProjectFileCoordinator`、`core/projectFiles/*`、`projectFileServices`。Skill 在入口真实可用后再同步。

### 2.5 各 UI 包的必要性判定

分类沿用计划 §4：A 为新合同必需，B 为已证问题，C 为仅重构。

| 包 | 判定 | 补充 |
|---|---|---|
| A0 | A，成立 | App 直接引用的 V9 壳层不在写域，见 2.1 |
| G1、N0、F1、P0、C0、L0、Q0–Q2、R0、R1、X 系列 | A 或 A+B，成立 | — |
| F0 | A+B，成立 | 同步改异步 ACK 是成熟编辑器行为合同的变化，需要用 F1 的实际输入和 IME 证明；Max-depth 根因未明时不猜修，处理正确 |
| S0 | 名义是 A，实为整模块替换事件源 | 需按 §4 补论证，见 2.2 |
| W0 | A，成立 | 写域缺相机、路径、关系的面板和命令，见 2.1 |
| T0 | A，但写域全是 027d 不存在的 V10 新文件 | 027d 原有的 `teacherControllerComponent`、`TeacherControllerAuthoringChrome`、`player/teacherControllerComponentGeometry`、`shared/teacherController*` 没有 owner；行为参照应取自 027d 实测，而不是只有 2/2 DOM case 的 3b702fb6 |
| G0 | 只在能改变选型时做 | 不阻塞，处理正确 |
| 后端提取 | §4 只约束 UI | V10 中 DocumentToolGateway（−1252/+456）、ExecutionEngine（约 ±2300）、ToolTargets（−309/+220）、editorStore（−1567/+161）同时混有合同改动和简化。生成的 AI 工具定义里，`asset.media.import`、`asset.font.import`、`asset.image.transform` 被删除，新增 `asset.save`/`asset.search`/`asset.use`/`batch` 等，等价性没有评估。提取前也应写一句必要性说明 |

## 三、并发是否可执行

### 3.1 共享注册文件和会话文件没有 owner【计划缺陷｜阻断】

- **位置：** §5 K0 独占清单（L122–130），只写了“必要公共 workbench document types、生成注册根、package/lock/config”。
- **证据：**
  - V10 在 `src/preload/index.ts` 新增了 `component:compile`（Q1 需要）、`component-catalog:install-entry`/`delete-package`（L0 需要）、`component-bootstrap:create`/`release`（R0 需要），并对应修改 `src/main/ipc.ts`。
  - `shared/workbench` 下的 `desktop`、`documentDelivery`、`execution`、`documentSave`、`viewObservation` 和 `sourceFileKind`（决定 `.h5lesson` 交给哪个 driver 的唯一开关）都有 V10 改动。
  - `core/documents/DocumentSession.ts` 也有必需改动，见 4.1。
  - 原计划 L147 中“必要 schema／Session 接线”归 I，新计划把 Session 丢了。
- **失败链：** Q1、L0、R0 要么等一个不存在的 writer，要么同时写 preload/ipc（违反单 writer），要么私造 DTO 绕开（计划禁止）。
- **修正（Root）：** 把 `ipc.ts`、preload、`shared/workbench/*`、`DocumentSession.ts`、`sourceFileKind.ts` 明确列入 K0，其他包以小补丁提交。

### 3.2 首条真实链被拖到编译器、教师控制台、导航和 F0 之后【计划缺陷｜关键路径】

- **位置：** §8 第 4–5 条（L214–215）、R0（L161）、UI1（L263）。
- **依赖关系（文档内逻辑）：**
  - A0 要等 R0；
  - R0 要等 Q1 编译、M1、T0 和 R1 的导航部分；
  - 建议的首链包含“复制”，复制要等 C0，C0 又要等 L0 闭包和 F0 的 prepared 协议；
  - Slide 文字（N0）也要等 F0。
  - 但 AGENTS 明确默认组件不逐实例编译，首链也用不到控制台和粘贴。
- **失败链：** 第一条真实 Main 链要等最难、根因还没查明的 F0，以及多个无关的包。宿主激活、保存、重开这类端到端问题暴露得最晚。
- **修正（Root 改依赖图）：**
  - R0 先交第一片：编辑器内默认组件的挂载、更新和销毁，不含编译、导航和教师控制台。
  - F0 先交与同步 ACK 兼容的窄字段 helper。
  - 复制粘贴、教师控制台、定制源码放到第 2–3 条链。

### 3.3 K0 仍是串行瓶颈，Slide slice 的归属与 Flow/Spatial 不对称【计划缺陷｜吞吐】

- **位置：** K0（L127）、S0“不写共享 slice”（L148）、L132（Flow slice 归 F1，Spatial slice 归 W0）。
- **证据：**
  - K0 已持有合同、driver、Bridge/Projection、Store 根和内核、`slideAuthoringSlice`、Host 注册、DocumentToolGateway、SelectionContextController、ToolTargets、生成根和配置；按 3.1 还要再加。
  - editorStore 引用的 `courseStructureSlice`、`slideOwnedCommands` 没有 owner，它们一改，必然连带 K0 的文件。
  - 首链恰好是 Slide，Slide 的每个 slice 改动都要排在 K0 的队列里。
- **修正：**
  - `slideAuthoringSlice` 和 `slideOwnedCommands` 交给 S0，与 F1/W0 对称。其中是否有跨表面部分【待确认】，有的话只把那部分留在 K0。
  - Gateway 和 ToolTargets 中内容工具相关的改动交给 H1，K0 只保留公共入口签名。

### 3.4 模型强度分级需要 Owner 确认【待确认】

- **位置：** §5 角色表（L108–116），§6 各包 Sol 的 medium/high/xhigh。
- **依据：** Owner 2026-09-28 的指示（已写入 `D:\g20-work\specs\gpt-handoff\` 交接包）是：交给 Codex 时 6Luna 默认 max、6Sol/6Astra 默认 xhigh，派活必须显式设置、不得降档。我没有找到 Owner 改变这一默认的记录；EXECUTION_PLAN §1.2 的分级是方案自定的。
- **问题：** 即使维持分级，D0 用 medium 也偏低。它负责 11 类组件的 API5 wrapper 和专业字段，正是计划 §1 所说“专业控件曾被通用 JSON 替代”的区域。
- **修正：** 请 Owner 确认；确认之前按 09-28 的默认执行。21 槽的容量和滚动释放方式本身没有问题。

## 四、正式内容与生命周期

### 4.1 重开后无法继续编辑【计划缺陷｜数据·阻断】

- **位置：** §3.2 只写复用 DocumentSession；§5 K0 未列 `DocumentSession.ts`；A0 的证据链止于“新 Session 从落盘重开”（L146）。
- **证据：**
  - 027d `DocumentSession.ts:64`：`const revision = input.model.kind === 'course-v9' ? input.model.project.revision : 0`，即只对 V9 读取工程 revision，其他格式一律从 0 开始。
  - 提交时 L216 调用 `this.driver.withRevision(candidate, next.revision)`。
  - `CourseV10Driver.ts:42` 在 `revision < model.project.revision` 时抛出“工程版本必须单调递增”。
  - 6d93 修了 L64，但这个文件不在任何写域。
- **失败链：** 保存一份 revision ≥ 2 的 V10 工程，重开后 Session 从 0 开始，第一次编辑就抛错，之后任何编辑都失败。A0 的验证链在“重开”处就结束了，测不到这一步。
- **修正（K0）：** `DocumentSession.ts` 归 K0；首链加“重开后再编辑一次并撤销”。

### 4.2 V10 文档的恢复稿会丢失【计划缺陷｜数据丢失】

- **证据：** 027d 中以下位置都只接受 markdown/text/course-v9：
  - `documentJournal.ts:81`（恢复状态校验）、`:456`（保存意图校验）；
  - `JournalBindingIndex.ts:40`；
  - `WorkspaceFiles.ts:223` 中 `createFile` 的 format。

  V10 材料三处都已扩展（各 +1/−1），但都没有 owner。
- **失败链：** 在候选中编辑 V10 文档，关闭时选“保留恢复稿并关闭”，恢复日志校验报“恢复日志文档无效”，重启后草稿无法恢复，未保存的工作丢失。计划的六类链都只走正常保存。
- **修正（K0，与 driver 同批切换）：** 三处一起改；补一条恢复链：编辑，保留恢复稿关闭，新进程恢复，再保存。

### 4.3 内置 AI、外部 MCP 和导入在 V10 文档上不可用，且无 owner【计划缺陷｜阻断】【产品缺陷】

- **证据（027d）：**
  - `ExecutionEngine.ts:639`：续作时重新打开的文档必须是 V9，否则报“重新打开的文档格式与原图片任务不符”。
  - `ExecutionEngine.ts:1809`：判断观察截图是否新鲜时，要求文档是 V9 且存在 `project.locations`。
  - `ElementChangeTracker.ts` L42、L45、L96：只跟踪 V9 文档，否则直接失效。
  - `AgentFileTools.ts:16` 和 `AgentFileService.ts` L27、L263–266：`file.create` 只建 V9 空工程。而 Skill 创作的第一步就是 `file.create {"name":"<课名>.h5lesson"}`。
- **V10 材料的状态：**
  - 已移植：ExecutionEngine（约 ±2300）、ElementChangeTracker、continuationTargets、AgentFile*。
  - 至今仍只认 V9：`HtmlImportService.ts`（L127、L217、L235），`prepareHtmlCourseCandidate.ts:69`（报“HTML 页面只能导入 Course V9 文档”），`DynamicContentObservationStore.ts`。
  - 这些文件都不在任何写域。H1 只持有 ToolRegistration/ToolCatalog 和 contentApply。
- **失败链：** 候选切换到 V10 后：
  - AI 新建的课件是 V9 文件，V10 宿主拒绝打开，创作第一步就失败；
  - AI 修改跟踪失效，恢复稿、续作和变更回执出错；
  - 导入外来 HTML（build-courseware-project）直接报错。

  N01（人与 AI 局部共编）和 N07（内容应用与文件）都交付不了。
- **修正：** 新增一个“AI 执行与导入”owner，或并入 H1，持有：
  - `main/workbench/execution/*`：ExecutionEngine、ElementChangeTracker、CardTextEdits、DocumentSaveEvents、continuationTargets、AgentFile*；
  - `htmlImport/*`；
  - `observation/*`。

  用本地确定性工具调用验证（不调用付费模型）：经 Gateway 写入 Session，UI 可见，可撤销，可保存。

### 4.4 改名后续作 ENOENT 分给了四个 owner，相关文件却不在其中任何一个的写域【计划缺陷】

- **位置：** §10 L291。
- **证据：** 已保存事实与续作逻辑在 Main 的 `execution/DocumentSaveEvents.ts`（V10 改了 +167/−124）和 `continuationTargets.ts`；相关用例 `g20SavedCourseContinuation.test.ts` 在冻结的未提交改动中。K0、A0、H1、X1 的写域都不含这些文件。
- **失败链：** 四方都能“协同”，但没有一方能动手，已知的真实失败会长期挂起。
- **修正：**
  - 路径权威由 K0 主责；
  - 上述两个文件归 4.3 的 owner；
  - 补一条链：保存，在工作区改名，然后续作或重开，确认不再出现 ENOENT。

### 4.5 Phaser 退出没有落到具体动作【计划缺陷｜几何单 owner】

- **证据：** `src/renderer/phaser/*`（EditorPhaserBridge、EditorScene、SelectionOverlay、createEditorGame、v9SlideHitAdapter、v9SpatialHitAdapter）没有退出 owner。`v9SpatialHitAdapter` 还被 `authoring/spatialWorldAuthoring.ts`、`spatialWorldTargetAuthoring.ts` 引用，这两个文件也没有 owner。
- **失败链：** S0 接上 G1 后，Phaser 输入层仍然挂载，或者 Spatial 仍走 V9 命中，同一窗口出现两套坐标写入，违反合同 §0.2“新几何接管时同步移除其主编辑职责”。
- **修正：** S0 和 W0 卡各自列出本批移除的 Phaser 调用点；E3 确认编辑态没有挂载 Phaser 画布。

### 4.6 核实后没有问题的部分

- `CourseV10Driver.apply` 能在同一个命令里提交 `component.files.set`（带 `expectedFiles` 冲突检查）、`asset.add`/`asset.remove` 和实例编辑，§3.2 第 4 个端口有底层支撑。素材 ID 已存在时 `asset.add` 会被拒绝，所以复制时由软件重新分配 ID 是必需的，计划已经这样要求。
- 没有发现正在使用的 V9 影子 writer。V10 材料中的 `legacyEditorStoreKernel`、`legacyFlowAuthoringSlice`、`courseToolTransaction` 已经没有任何引用方，提取时不要带进来即可。
- 捕获目标（不能混用文档 A 的快照和文档 B 的状态）、ACK 不重复提交、失败保留草稿的规则正确。

## 五、验证与切换

### 5.1 缺少最基本的几条验证链【计划缺陷】

- **位置：** §9.2（L257–274）。六类链是“方法”，由各包从自己的模块里列出受影响动作。
- **问题：** 没有 owner 的模块不会有任何包去列动作，所以永远进不了任何一条链。目前缺：
  - 重开后继续编辑（4.1）；
  - 恢复稿（4.2）；
  - AI 或 MCP 写入后在 UI 可见并能撤销（4.3）；
  - 页面和场景的增删、改名、排序（2.1）；
  - 动画预览和互动编辑（2.2）；
  - PPTX 和 HTML 导入（2.1、4.3）；
  - Spatial 的相机、路径、停靠点编辑（W0 的链只覆盖创建、平移缩放、拖动）。
- **修正（E3 执行一次，Root 归属）：** B0 做原版参照时，同时由软件从 027d 实际的菜单、命令和快捷键注册中枚举出一份动作清单。每个动作对应一个 owner 和一条链，“完整支持范围”就以这份清单为准。这是一次性清单，不是新的检查门。

### 5.2 候选中间状态与合同冲突，计划没有说明【计划缺陷】

- **证据：** 合同 §2 L86 写明：“任一中间提交都必须可运行、可保存、可重开、可撤销、可预览并保持适用导出……迁移必须停止并回滚”。而计划 §2.3 L51 和 §8 第 5 条有意让候选先只支持 Slide。
- **失败链：** E 和评审若按合同执行，要么阻断每一个中间 cut，要么无视合同。两种都会出问题。
- **修正（Root/A；若改合同文字需 Owner 确认）：**
  - 写明候选分支在替换前不适用这一条，理由是原 V9 应用（独立 profile）一直是日常版本，替换前必须覆盖 5.1 的全部清单。
  - 候选中尚未接入的功能，显示明确的“尚未接入”，不删除、不隐藏、不静默无效，这与合同 §2 第 20 条一致。

### 5.3 区分后端证据与前端证据：正确（无需修改）

- §9.1 明确提交、类型、构建、后端用例和 DOM case 不能代替真实交互和独立重开。
- 独立重开的定义（旧 Session 已结束、确实重读落盘内容）、IME 不能伪造、停止条件和既有证据复用都合理。§10 如实列出了已知反例。
- 只需补一句：负责切换某条路径的包，同批迁移或退役受影响的旧测试。§9.3 已禁止 skip，但没有指定旧测试由谁处理。

## 六、完整目标覆盖

| 目标 | 计划映射 | 缺口 |
|---|---|---|
| L20/N07 工程文件 | Q2/K0/A0/H1 | 13 个 `core/projectFiles` 模块、`ProjectFileCoordinator`、`projectFileServices` 没有 owner；布局决定缺失（见 2.4） |
| L22/N08 Player | R1/R0 | V9 Player 的退出没有 owner：`player/surfaces/*` 中 15 个直接依赖 V9 的文件，以及 `CoursePlayer.ts`（原计划 L441 和 U11 都点名过）。Flow 的 Player adapter（原 L12 的 `player/surfaces/flow/componentFlowAdapter.ts`）不在 R1 名下，是否已由 V10 的 `modelProjection` 承担【待确认】 |
| L21 Published | X0/Q1 | 旧的 `buildPublishedCourse`（Published V2）在当前 V10 材料中仍被 10 个模块引用，包括三个试运行模块、FlowCourseComponentBlockView、CompositionFragmentPreview、v9AssetAdapter、dynamicFallbackWorker 等。这些模块的切换或退役没有 owner（原计划 L432 归 I） |
| L25 Skill | Z0/H1 | `scripts/generate-ai-capabilities.ts`（V10 改了 +372/−1977）和 `artifacts/ai-capabilities/**` 没有 owner。V10 删除了 51 个产物：V9 schema 和 protocol、6 个 recipes、组件示例，以及 3 个工具定义。合同 §2 第 22 条要求同源生成。不处理的话，内置 AI 要么拿到 V9 schema、写入被拒，要么在重新生成时静默丢能力。建议生成脚本和产物归 K0，新旧工具清单的差异逐项说明 |
| L24 库与素材库 | L0/C0 | 组件库有 owner；素材插入链（`commitCourseMediaAuthoring`、`courseMediaLibraryImport`、ElementsTab、MaterialLibraryDialog、`main/workbench/assetSources/*`）没有 owner（原 U8/U9 有） |
| L26/N09 混合样本 | Z0＋E2/E3 | Z0 只写文档，E 不能写测试，混合样本没有作者；R1/X1 “共用一份混合样本”没有来源。建议样本和贯通用例归 X1 或 R1（原 L26 写域见原计划 L477） |
| L11/N03 Spatial | W0/V0/R1 | 相机、路径、关系的编辑 UI 和命令没有 owner（见 2.1）；10-04 批准的停靠点与站内逐条出现是否在范围内【待确认】 |
| L07/N06 导航与快捷键 | T0/R0/A0/C0 | 编辑器键盘有 C0；Player 端的翻页键位（10-04 的键位决定）由谁接【待确认】 |
| N10 旧 consumer 退出 | 各包 | 没有 owner 的模块也没人负责退出；V9 driver、codec、schema 的最终删除没有 owner。随 2.1 的清单一并解决 |
| 三表面、专业内容、源码、MCP、各格式输出 | 主体映射存在 | MCP 的 `ExternalMcpService` 和项目文件工具随 4.3、2.4 补 owner；X2–X4 的格式分工合理 |

## 必须修正项（按优先级）

1. **定义 driver 切换批次：**
   - 哪些模块与 K0 同批迁移：首链所需模块、App 直接渲染的壳层，以及 Session、恢复日志、工作区文件、`sourceFileKind` 中的格式判断；
   - 其余功能在候选中显示明确的“尚未接入”；
   - 原 V9 应用作为日常版本保留到替换（对应 5.2）。
2. **生成一次 consumer 和动作清单：** 每个文件、每个动作落到唯一 owner 或明确的退役批次，接回 U0–U13 中丢失的 owner（对应 2.1、5.1）。
3. **K0 显式持有：** `DocumentSession.ts`；`documentJournal`/`JournalBindingIndex`/`WorkspaceFiles` 的格式列表；`sourceFileKind`；`shared/workbench/*`；ipc/preload；AI 能力生成脚本（对应 3.1、4.1、4.2、L25）。
4. **设立“AI 执行与导入”owner：** 持有 `execution/*`、`htmlImport/*`、`observation/*`，同时负责 ENOENT 问题（对应 4.3、4.4）。
5. **S0 拆解 Phaser 职责并指定新 owner：** 包括动画预览和文字/公式双击入口（对应 2.2、4.5）。
6. **工程文件布局：** A 裁定，改变布局需 Owner 确认；Q2 持有 `projectFiles/*`（对应 2.4）。
7. **重新定义首链和 R0 第一片：**
   - 去掉对 Q1、T0、R1、C0、L0 的依赖；
   - 首链加“重开后继续编辑”；
   - 另补恢复稿链和 AI 本地写入链（对应 3.2、4.1、4.2、4.3）。
8. **其他：** 修正 PM 撤销的措辞（2.3）；给混合样本指定作者（L26）；模型强度请 Owner 确认（3.4）。

1.2 的替换方式在最终替换前补上即可，不影响起跑。

## 修正后首条真实用户链的依赖顺序

1. **B0：**
   - E1 记录承载情况，以及“Owner 工作区等于 027d”；
   - 建立独立的 027d 承载和 profile；
   - E3 在原版上做一次参照，同时产出动作清单。
2. **并行准备，互不等待：**
   - K0 第一片：V10 driver；Session、恢复日志、工作区文件、`sourceFileKind` 的格式改动；Host 注册；读取、捕获、提交、ACK 端口；ipc/preload。
   - G1 纯几何。
   - F0 窄字段 helper。
   - D0 的文字、形状、图片定义。
   - R0 第一片：编辑器内默认组件的挂载、更新和销毁。
3. **同一个切换批次：**
   - S0：用 G1 手势取代 Phaser 的选择和变换，文字双击进入 N0；
   - N0；
   - P0 最小集：几何和文字属性；
   - 清单中的壳层：插入菜单、ScenePanel、底部导航、缩略图、`courseStructureSlice`、`slideOwnedCommands`；
   - A0 生命周期：新建、打开、保存、关闭、恢复。

   其余功能显示明确的“尚未接入”。
4. **E3 跑首链：**
   1. 新建课件，插入文字、形状、图片。
   2. 选中，拖动、缩放、旋转，修改文字。
   3. 撤销和重做，Ctrl+S，正常关闭。
   4. 用新进程重开，再编辑一次并撤销。
   5. 选“保留恢复稿并关闭”，重启后恢复，再保存。
5. **之后按清单滚动推进：**
   1. 带素材的复制粘贴（C0、L0、F0 prepared 协议）；
   2. Flow（F0 异步 ACK、F1）；
   3. Spatial（W0 相机和路径）；
   4. 教师控制台与运行（T0、R0 全量、R1 Player）；
   5. 源码（Q0–Q2）；
   6. AI 本地写入（K0、H1、AI 执行 owner）；
   7. 各格式输出（X0–X4）；
   8. 退出旧 consumer，Z0 同步 Skill。

## 附录 A：计数与核对方法

| 数字 | 方法 |
|---|---|
| 382 / 339 | `git grep -l -E 'CourseProjectDocument\|LayerItem\|history\.present\|course-v9\|CourseV9' 027d588a -- src` 得到 382 个文件。排除计划 §5–6 的 144 个精确路径和目录级写域（`src/shared/contracts/component-platform/`、`src/renderer/ui/properties/`、`src/player/components/runtime/`、`src/core/contentApply/planning/`、`src/components/{text,media,image,shape,table,chart,input,choice,disclosure,popover,document-block,builtin-source,teacher-controller}/`、`src/player/behaviors/`、`src/core/publish/componentPlatform/`、`src/renderer/export/componentPlatform/`）后剩 339 个。这是上限，其中包含可随 V9 driver 一起退役的内部文件；正文点名的都是用户入口 |
| 40 / 5 | 在 027d 的 `src/main`、`src/shared`、`src/core`、`src/preload`、`src/player` 中查 `'course-v9'` 字面量，得到 40 个文件。计划精确覆盖 5 个：DocumentToolGateway、ToolCatalog、ToolTargets、DocumentHostService、DocumentDeliveryService。其余 35 个中，24 个已有 V10 改动，11 个在 V10 材料中未改（含 CourseV9Driver 本身，以及至今仍只认 V9 的 HTML 导入、动态内容观察、ProjectFileCoordinator 等）。`shared/workbench/document.ts` 可算作 K0 的“公共 workbench document types” |
| 467 / 220 | `git diff --name-only 027d588a -- src` 加上未跟踪的 src 文件，共 467 个；不在任何写域的有 220 个 |
| 写域路径 | 计划列出的 144 个路径在 HEAD 或冻结工作树中全部存在；其中 `componentSourceClosure.ts` 只存在于未跟踪的冻结材料中 |
| Owner 工作区一致性 | 027d 的 src/tests/scripts 共 2472 个文件，逐一检查在磁盘上存在且哈希相同；磁盘上没有多出的文件。有一个中文文件名 fixture 因 quotepath 转义被误报为缺失，实际存在。64d97fa2 索引中另有 8 个已在工作树删除的文件 |
| dadd3c33 | 其 5 个文件与 6d93 对比：4 个 blob 相同，`browserCapture.ts` 不同（已演进） |

## 附录 B：主要证据位置

| 主题 | 位置 |
|---|---|
| driver 注册 | 027d `src/main/workbench/DocumentHostService.ts:61`（只有 V9）；当前材料同一行（只有 V10） |
| Session revision 与提交 | 027d `src/core/documents/DocumentSession.ts:64`、`:216`；`src/core/drivers/CourseV10Driver.ts:42` |
| 恢复日志格式判断 | 027d `src/main/workbench/documentJournal.ts:81`、`:456`；`JournalBindingIndex.ts:40`；`WorkspaceFiles.ts:223` |
| AI 执行 | 027d `src/main/workbench/execution/ExecutionEngine.ts:335`、`:639`、`:1809`；`ElementChangeTracker.ts:42`、`:45`、`:96`；`AgentFileService.ts:27`、`:263–266`；`src/core/tools/AgentFileTools.ts:16` |
| HTML 导入仍只认 V9 | 当前材料 `src/main/workbench/htmlImport/prepareHtmlCourseCandidate.ts:69`；`HtmlImportService.ts:127`、`:217`、`:235` |
| Phaser 是 Slide 的事件源 | 027d `src/renderer/ui/workspaces/SlideLocationWorkspace.tsx:51–53`、`:1438`、`:2811–2878`、`:2984` |
| 动画预览没有订阅者 | 当前材料 `src/renderer/phaser/elementAnimationPreviewBus.ts`；调用方 `InteractionEditor.tsx:31`、`SimpleEntranceAnimationEditor.tsx:3` |
| PM 不装 history | 027d `src/renderer/document/SharedDocumentEditor.tsx:128`；当前材料 `:165`；`src/renderer/components/ComponentSourceEditor.tsx:68` |
| 工程文件布局 | 027d `.agents/skills/orchestrate-courseware/references/project-files.md`；当前材料 `src/core/projectFiles/componentPlatform/projection.ts:99–173`；合同 §1.2 L73 |
| 壳层直接依赖 V9 | 027d `src/renderer/ui/ScenePanel.tsx:45`、`:53`；`BottomSceneNavigator.tsx:3–4`；`store/slices/courseStructureSlice.ts:2–3`；`store/slices/slideOwnedCommands.ts:14–21` |
| 新增 IPC | 当前材料 `src/preload/index.ts`（`component:compile`、`component-catalog:*`、`component-bootstrap:*`） |
| V10 codec 拒绝旧件 | `src/core/drivers/codecs/courseProjectV10Archive.ts:45` |
| 前一版计划中的 owner | `UI_REINTEGRATION_EXECUTION_PLAN.md` L60–73；`EXECUTION_PLAN.md` L147、L423、L432、L441、L477 |
| 架构合同 | `ARCHITECTURE_CONTRACT.md` L25（§0.2 Phaser 退出）、L73（空间停靠与文件 owner）、L86（零功能降级）、L120（禁止静默 no-op）、L134（同源生成） |
