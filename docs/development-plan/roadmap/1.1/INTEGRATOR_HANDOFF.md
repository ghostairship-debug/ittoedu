# 1.1 Integrator handoff（接手审计修订：2026-09-03）

## 当前检查点（2026-09-03 Kimi 接力版，优先于下文一切旧节）

**进度**：HEAD=`03ae8aa`（r11-037y 完成）。036b、037a–037y 全部完成；剩余 `037z → 052a–052d → 053 → 054a–054d`，最终 055/060/061 归 Codex、062 归 Owner（规则见 [GEMINI_EXECUTION_PLAN.md](GEMINI_EXECUTION_PLAN.md) 与 [EXECUTION_GUIDE.md](EXECUTION_GUIDE.md)，不变）。

**中断现场**：037z 卡（`docs/development-plan/tasks/1.1/r11-037z-root-selection-tests-and-removal.md`）已 queued，一个执行代理刚开工即中断——工作树可能只有该卡文件的 Write scope 扩充（授权加入 `composition/crossSurfaceCommands.ts`），无实质产品改动。接手后先 `git status` 盘点，然后按本节的 037z 执行简报重新执行该卡。

### 037z 执行简报（预研已完成，以下事实可直接采信）

- 起始条件：五字段（activeSceneId、activePresentationStateId、selectedNodeId、selectedNodeIds、editingScope）在 src/renderer 除 root 声明/初始化/同步写与命名 selector 外应零直接 consumer；开工先 Grep 复扫，有遗漏真实 consumer 即停（phaser/** 全是类私有字段误报，勿动）。
- 删除清单：editorStore.ts 的 EditorRootOwnedState 五字段+初始化+readSelection/syncSelection host 实现+内部 4 处 `state.editingScope` 读（改 `selectEditingScope(...)`）；editorStoreKernel.ts 的 EditorUiSelection（26-32）、接口与透传（66-67、80-81、108-109）；slideAuthoringSlice.ts 206-217/258-262、flowAuthoringSlice.ts 425-429/458-462、spatialAuthoringSlice.ts 393-397/441-445 的同步写；五个命名 selector 的 root 回退分支。
- **协调者已授权扩写范围**：crossSurfaceCommands.ts 含 kernel readSelection/syncSelection 全部 10 个调用点（readSelection 307/344/354/400/498/854；syncSelection 319/362/459/497，四处均只清空 selectedNodeId/selectedNodeIds，改为各 Surface 自有 clear-selection 命令；读出点 418/861/871/883 随迁）。
- **sessionless 默认值已裁定**：selectedNodeIds→空常量、selectedNodeId→null、editingScope→'scene'、activePresentationStateId→null、activeSceneId→保留现有回退链中活动 location/document 推导部分。
- 测试迁移清单（均按 037x 风格改命名 selector 或读对应 session selection；除注明外均 Slide）：unit 侧 editorStore.test.ts（约 53 行，最大头，含 Spatial 段→spatialSession）、developerMode、globalEditorStore、batchMediaAndInsertion、v9SlideProductIntegration、v9SlideTextTransaction、spatialAuthoringTarget（Spatial）、spatialProductIntegration:1138、flowProductIntegration:1034,1038（Flow→flowSession.selection.authoringScope）、simpleEditorMode、continuousInsertionUi、courseDraftPersistence、imageSafeAreas:31、textEmphasis:148、formulaNode:202、sceneStateUi:129、unifiedDeleteTransaction、v9GlobalLayerUiAdapter:1162、runtimeTemplateLifecycleIntegration；integration 侧 componentCatalogV8Matrix:210、componentTextEditSession、courseRuntimeAssetReplacementVerticalSlice、courseComponentPackageReplacementVerticalSlice、courseMediaLibraryImportVerticalSlice（含三 surface 分支助手）、imageReplacementVerticalSlice、imageReplacementRaceCharacterization:255、runtimeContentTextAuthoringVerticalSlice、runtimePropertyAuthoringVerticalSlice:296、courseRuntimeSourceAuthoringVerticalSlice:412、draftSaveTransaction:159。假阳性勿动：interactionEditor.test.tsx（props）、v9SlideDomain、surfaceRouter、slidePreviewRebuildKey、三个 runtime*AuthoringView/Commands 测试。
- 验证：实际改动的测试合并为一条 `npx vitest run`（不得全量）+ `npm run typecheck`。收尾：删 037z 卡、实例化 052a 卡（只建卡不执行）、`npm run generate:task-board`、单提交 `r11-037z: ...`。

### 协调者已裁定事项（无需再问）

1. 037y 已授权扩充并落地：`selectSelectedNodeIds` 引用记忆化（修复 App.tsx:97 无限重渲染）、`globalLayerUi.test.tsx` 两段裸 setState 已迁走、`selectEditingScope` 已补 flowSession 派生分支（`authoringScope==='global'?'global':'scene'`）。
2. 052a 裁定：三文件测的 motion flush 排序/组件事件挂载缓冲/页面可见性缓存是 V1 Player 内部机制，实现代码本身是 LEG-002 删除目标 → 8 条用例按退役行为删除；2 条动画时长钳制用例迁往 `tests/unit/publishedDomInteractionSurfacePort.test.ts`（V2 有同款 `MAX_MOTION_DURATION_MS=10_000` 钳制但缺测试），承接名单扩充需记录在卡。三文件无 V8 拒绝用例需保留（`publishedCourseProtocol.test.ts:567` 已覆盖拒绝档）。PM map/matrix 对三文件零引用，052d 无需为 052a 更新。

### 待 Owner 裁定事项（052b/052c 执行前必须先问）

1. **052b 视频播放行为**：V2 slide 宿主只画 `<video controls>`，不支持播放动作路由、`video:started` 事件、背景音乐闪避 → `renderVideoNode.test.ts:312/:375/:396` 三例无 V2 宿主可迁。是 V2 合同有意收窄还是产品缺口（需补实现）？
2. **052b scene.open-picker 场景目录**：文档承诺的教师控制器默认能力（USER_GUIDE.md:62,414；合同 native-v1/schema.ts:327），但 V2 各宿主均不处理，点击"场景目录"无效 → `teacherControllerActions.test.ts` 唯一用例无处可迁。疑似产品缺口。
3. **052b hybrid renderMode**：组件双面渲染在 V2 无任何宿主/测试（publishedComponentMount.ts:580 硬编码 dom）。
4. **052c 孤儿模块**：`src/shared/presentation.ts`、`informationRelease.ts`、`projectDiagnostics.ts`、`componentPackageLifecycle.ts` import LEG-011 目标 projectTypes.ts，各自唯一产品 consumer 均为 LEG 删除目标，但四者自身不在 LEG 清单 → 052c 删测试后若 053/054 不补删这四模块，LEG-011 永远无法清零。需裁定：补入 LEG 删除清单，还是另立后续卡。

### 052b/052c 已预研的无争议处置（可直接执行部分）

- 052b 整删：componentEventMountBuffer、playerSceneAssets；nodeMotionDirector 16 例全有 V2/编辑器侧覆盖→删重复；playerComponentV4Render 约 12 例删重复，previewPageProp/editorState 与 capture waitUntil 顺序迁入 publishedComponentMount.test.ts；formulaCrossSurface :155 迁公式渲染器确定性用例（落点 formulaNode.test.ts 或 published 侧）、:275 迁 PPTX 公式静态化用例到 coursePptxExport.test.ts，:198/:229 删。
- 052c：删重复 4 文件（componentPackageLifecycle、informationRelease、projectDiagnostics、presentation 的测试，V9 覆盖均已存在，以上述孤儿模块裁定为前提）；迁移 2 文件（interactionEditor.test.tsx→InteractionSceneView/InteractionLayerTarget；slidePreviewRebuildKey.test.ts→SlidePreviewIdentityNode/裸字面量）；保留不动 21 个（15 个拒绝路径已合规、6 个守卫/标题、legacyInventoryChecker 字符串夹具）。词边界扫描真实命中 31 文件/85 次，排除 052a/b 后 27 个。
- 052d：PM 引用点为 `v1.1-preservation-map.json:143-151`（PM-07 引用 formulaCrossSurface/renderVideoNode）与 `PRESERVATION_MATRIX.md:23`；只更新路径不改行为文字；验证 `npx vitest run tests/unit/preservationChecker.test.ts tests/unit/developmentRoadmap.test.ts` + `npm run check:development-roadmap`，禁止跑 check:preservation。

### 053/054 机制预研结论

- 台账：`docs/development-plan/inventories/legacy-consumers.json`（schemaVersion=2，11 条 LEG：active-debt 7 / removed 3 / dead-candidate 1，confirmed relation 382）。scanner 实现 `scripts/check-legacy-consumers.ts`；`check:legacy-inventory`=ratchet（允许 digest 偏离），`check:legacy-ready`=ready（digest 一致+observed 全 0），`check:legacy-zero` 归 Codex 060。
- 053 操作序：跑 `check:legacy-inventory` 取 stdout JSON → `candidate.currentProductTreeDigest` 写入 `baseline.reconciledProductTreeDigest`、当前 HEAD 写入 `reconciledProductCommit`、按 records/summary 更新明细并重算 `reconciledCounts` 五字段 → 之后只跑 `check:legacy-ready` 验证。digest 覆盖工作树 src/tests/scripts/examples/artifacts+package.json；台账自身在 docs/ 不计入。
- 054 预分组：a) Shared contract=LEG-011（projectTypes/projectSchema/projectSchemaTypeContract/createProject[磁盘已不存在]+courseProjectModel 5 个 symbol）；b) Player/payload=LEG-002 player 侧 5 文件（注意 publishedComponentMount.ts 引用 publishedLesson.ts#decodePublishedCode，该 import 存在时不得删 publishedLesson.ts）；c) Export/diagnostics=LEG-002 export 侧+LEG-004/005/006/007（buildPptx.ts 被 buildCoursePrintArtifacts.ts import buildPdfPrintHtml，删前须迁移）；d) Archive/test helper=LEG-008/009/010。LEG-001 的 slideEditorProjection.ts 替代未建立，大概率不进删除表，053 实跑确认。空组不建卡。

---

## 当前执行覆盖（2026-09-03，Gemini 最小验证版）

本节覆盖下文所有旧恢复顺序、W1–W9、052 A–E、candidate digest、Hash 报告和旧 deletion list；下文仅作历史审计依据。

- 当前 HEAD 主体完成到 036，但复查发现 `useMediaImport.ts#tryInjectCandidateMedia` 在异步去重后仍可迟到写入，先执行任务板上的 `r11-036b-media-dedupe-race`。
- 后续按 [GEMINI_EXECUTION_PLAN.md](GEMINI_EXECUTION_PLAN.md) 顺序执行 037a–037z、052a–052d、053 与 054 分组卡；一次只有一张 queued 卡。
- Gemini 每卡只运行一条最近层测试命令，产品 TypeScript 变化时再运行 `typecheck`。不提前运行 `test:product`、`verify`、`check:preservation`、`check:legacy-zero` 或 Hash/字节比较。
- 全部实施完成后才由 Codex 执行 055 结构审查、060 一次 Legacy zero、061 一次 typecheck/full product/preservation；再交 Owner 062。
- 当前纯 Flow→DOCX、Slide/Spatial→PPTX 的产品边界保持不变。

本文件取代 2026-09-02 的 Grok handoff。旧 handoff 中“不要重开 r11-000–055”“剩余链只有 053 → 054 → 060 → 061”以及基于旧 scanner 得出的 deletion list 均已被源码和可复现检查推翻，不能作为继续开发或删除文件的授权。

当前裁决是：**保留已有实现成果，先修裁判与 Owner 边界，再重新进入 Legacy reconciliation；不整体回滚，也不直接继续 053/054。**

---

## 0. 2026-09-03 Codex 执行检查点

本节是当前恢复路线的权威检查点；与下文“接手审计时”的节点状态或恢复顺序冲突时，以本节和当前任务板为准。下文保留的旧统计与反例只是审计依据，不是新的完成声明或删除授权。

- 已闭合：`r11-026`、`r11-030`、`r11-031`、`r11-040`、`r11-041`、`r11-042`、`r11-043`、`r11-033`、`r11-029`。对应产品路径与直接门可保留，不再因下游待办重开它们。
- `r11-029` 已通过 10 个聚焦测试文件共 127 项测试、`typecheck`、scoped diff check 与精确负边界查询。根 `Workspace.tsx` 只消费 exactly-one discriminated route；Flow/Spatial connector 使用命名 selector 与 typed port；Slide leaf 只接收同一时点 projected snapshot 和分组 ports；module-global bind、live Store facade 与 Store→UI 反向依赖均为零。
- r11-029 任务卡已按协议删除，任务板重新生成后为 0 项；本次文档收口后的 `check:development-roadmap` 与文档 scoped diff check 通过。
- **1.1 未完成。** 按用户要求，当前检查点立即暂停；不创建下一任务卡，不 commit，不 tag，不 release。
- 2026-09-03 重基核实：检查点提交 `bb1f848` 上 `check:development-roadmap` 通过，但 `check:preservation` 因 PM-08 的 `globalLayerUi.test.tsx` 夹具失败，`check:legacy-inventory` 报 7 项未登记观察；三道门中两道为红。剩余节点已按 [执行者指南](EXECUTION_GUIDE.md) 改写为执行版，并在 `docs/development-plan/tasks/1.1/` 建首批卡。

本轮可复用的直接证据：`r11-042` 为 8 个文件 / 94 项测试并通过 `typecheck`，覆盖真实 Spatial host capture、Flow semantic print 与共享 producer facts；`r11-043` 为 6 个文件 / 104 项测试并通过 `typecheck`、capability check 与真实在线 E2E，完成 producer Owner 迁移；`r11-033` 为 8 个文件 / 81 项测试并通过 `typecheck`，闭合 Surface owner remount、精确 origin network lease 与 Slide authoring base/named-state 保留。证据只在相关实现、依赖、fixture 与验证定义未变化时复用。

恢复后的剩余 failure-owner 边界如下：

| Failure owner | 2026-09-03 重基后的状态 |
|---|---|
| `r11-029` 返工卡 | 修复 PM-08 夹具（`globalLayerUi.test.tsx` retained-spatial-path）与两处新增 LEG-011 import（`spatialAuthoringIntents.ts`、`SlideWorkspaceConnector.tsx`）。 |
| `r11-025` | 以证据闭合；history 镜像残留归 `r11-037` W1。 |
| `r11-032` | 只剩 `playerCapture.ts` 的 PlayerApp 旧捕获函数与类型引用；Flow-only 项待 Integrator 给出失败测试，否则作废。 |
| `r11-034` | `sameProjectIdentity` 改为比较 `projectId` 与 hook 自有的 `epoch`；两条红→绿测试。 |
| `r11-035` | 四个 emit 使用预检时的 `pending.snapshot`；过期 finding 不导航；大文件改网页包走 `exportCourse('web-package')`；三条红→绿测试。 |
| `r11-036` | 解码后再核对 identity 且 identity 加入 `locationId`；两条红→绿测试。 |
| `r11-037` | 拆为 W1–W9，W1–W7 符号表已钉死。 |
| `r11-052` | 按当前测试树重算为 A–E；旧渲染器簇六个模块需由 `r11-053` 先登记为 targets。 |

**2026-09-03 基线红态定责（原 `r11-061-baseline-red-triage` 卡，已闭合）。** 检查点 `bb1f848` 上 `npm run test:product` 有 7 文件 / 10 项失败，逐组结论：① `architectureBaselineFixtures` / `architectureBaselineFlows` 报 `'invalid'`：产品缺陷，但出在校验器而不是预检项。PPTX 只映射 Slide 场景与 Spatial 镜头，Flow 的兼容格式是 DOCX，所以纯 Flow 课程的 PPTX 预检项保持 `error`（导出对话框继续拦截）；缺陷是 `scripts/validate-project.ts` 把所有格式的预检错误汇总成课程整体状态，令纯 Flow 课程被判为 `invalid`。修法：`exportPreflight.ts` 新增 `coursePptxTargetApplicable`，校验器整体状态只计入适用格式；`architectureBaselineFixtures` 改为断言 flow-heavy 的 PPTX 目标 `canExport` 为 false。（首版曾误把该项降为 info，已于同日纠正。）`architectureBaselineFlows` 的 warning 计数改为核对 `projectHealth.summary`，因检查点为 Spatial 浮层新增了有独立测试钉住的 PPTX warning。② `imageSafeAreas` 删除安全区后残留 1 项：测试缺陷。`undo()` 未包在 `act` 内，属性面板未重渲染即点击删除，绑定层按 revision 判定目标过期并拒写（产品行为正确）；测试改为 `act(() => undo())`。③ `runtimeAssetReplacementRace` 四项：测试缺陷。`canvas-runtime.h5lesson` 夹具在检查点新增 `network.connectOrigins`，而 `coursePlayerTryRun.ts#mountPublishedCourseTryRun` 自 f6d0cdd 起在宿主缺少 `desktopAPI.setPreviewNetworkPolicy/releasePreviewNetworkPolicy` 时 fail loud；测试按 `componentPackageReplacementRace` 同款补 desktopAPI 桩。④ `architectureDependencyRatchet` "keeps one Zustand store…"：预期红。029 规划的 4 个 Workspace connector 不在 `STORE_COMPOSITION_ADAPTERS` 白名单；按 055 规则不改白名单求绿，由 `r11-037` W1–W9 后的 055 复验收口。⑤ 原判"隔离污染"不成立，两者单文件运行同样失败：`editor10ForbiddenTokens` 与 `check:legacy-inventory` 同源，3 项负向正则 token 观察（`architectureDependencyRatchet.test.ts:596#SceneNode`、`coursePptxExport.test.ts:71#PlayerApp` 与 `#SceneNode`）按台账既有"Negative ratchet still names frozen tokens"惯例登记到 LEG-001/LEG-002，`reconciledCounts` 同步 +3；`flowMediaBlockEdit` "routes a stale Properties delete…"为测试缺陷，属性面板删除已由 r11-027 改走 `runFlowAuthoringIntent`，旧 `deleteFlowSelection` 缝不再在路径上，测试改钩新边界并以 `COURSE_AUTHORING_TARGET_REJECTION_REASONS['revision-conflict']` 断言。修后 `test:product` 为 276 files / 2242 tests，仅剩 ④ 一项预期红；`typecheck`、`check:preservation`、`check:legacy-inventory`、`check:development-roadmap` 全部通过。

暂停后恢复的唯一顺序是：`r11-029 返工卡 → r11-032 → r11-034 → r11-035 → r11-036 → r11-037（W1–W9）→ r11-052（A–E）→ r11-055 → r11-053 → r11-054 → post-delete r11-055 → r11-060 → r11-061 → Owner r11-062`。`r11-055` 的第一次执行是 pre-delete 结构门，第二次是 054 删除后在未改弱的同一门上复验；053/054 仍只能消费届时固定候选的新 reconciliation。

---

## 1. 接手审计时工作树快照（历史）

- 仓库：`C:\Users\74755\Documents\HTML课件编辑器`
- 分支 / HEAD：`main` / `018d3df56c0f0e26f0c00b9e2cc16da69be83a05`；HEAD ahead `origin/main` 1
- 工作树：307 个 tracked 文件有变化，另有 119 个 untracked 文件；tracked diff 约为 18,501 insertions / 37,898 deletions。本轮成果尚无可独立回退的 1.1 checkpoint
- `npm run typecheck`：通过
- `npm run test:product`：通过，275 files / 2147 tests
- r11-052 focused waves、现有 r11-055 focused tests：通过；这些结果只证明相应行为或现有断言通过，不证明规格退出条件成立
- `npm run check:legacy-inventory`：通过；当前 inventory 为 confirmed 208、unknown 0、tokenHits 404
- `npm run check:legacy-ready` / `check:legacy-zero`：以 `known-debt` 失败
- `npm run check:preservation`：失败，`malformed-map`
- `npm run check:development-roadmap`：接手审计时报告 25 个路径问题；本次计划纠偏后仍失败，当前为 13 项，r11-000 完成前该门继续视为红灯
- `git diff --check`：失败，5410 项，主要是四个源码文件整文件 CRLF 和一个测试文件尾部空行

这些红灯中的 architecture/preservation/scanner 属于 1.1 发布门，不是已经证实的当前用户可用性 P0/P1。产品回归全绿是保留已有实现、避免整体回滚的直接证据。

## 2. 审计后的节点裁决

| Node | 裁决 |
|---|---|
| r11-000 | 重新验收。路线 checker 当前把可执行证据、历史描述和删除目标混在一起；审计初始 25 项，本次计划修订后当前 13 项 |
| r11-001 | 重新验收 evidence mapping。PM 标准不变；PM-15、PM-21 及其他被迁测试必须绑定真实 replacement |
| r11-002 | 重新完成 scanner。现有 ready/zero 可在台账清空后遗漏 live token，candidate identity 也未成为强制门 |
| r11-026 | 重新打开。叶子属性面板保留，但 `PropertiesTab.tsx` 尚未成为纯 context router |
| r11-029 | 重新打开。Workspace 叶子保留，但 `Workspace.tsx` 尚未成为 exactly-one Surface router |
| r11-037 | 重新打开。现有 slices/kernel/owners 保留，但 root、宽 ports 与 `crossSurfaceCommands` 仍承载业务或镜像 |
| r11-052 | 重新打开。仍有 V8/旧 payload 成功测试，且删除测试到 PM/路线证据的映射未闭合 |
| r11-055 | 撤销既有 pass。现有词法测试在合同明显失败时仍为绿色，属于假阳性门 |
| r11-053 | 上次 reconciliation 作废。旧 digest 已过期，上游裁判和 owner gate 也未成立 |
| r11-054 / 060 / 061 | 未解锁 |
| r11-062 | r11-061 解锁后仅由 Owner 执行；未签署 `accepted` 不得 tag 或发布 |

## 3. 可直接保留的成果

- Course Project V9 / Published Course V2 的既有合同和已通过产品行为
- 已拆出的 Flow authoring 模块、App lifecycle/delivery/import hooks
- `publishedNativeRendering.ts` 及 Slide Published Native painter 迁移
- Course package analysis、preflight、emitter 的真实拆分
- 现有 Store kernel、resource helpers 与 Surface slices 中已经通过行为测试的实现
- PDF print HTML、Published executable decode、V9 health/preflight、native node factory 等已迁产品路径
- 已经删除且有 V9/V2 replacement 的旧测试与 helper；不得为了返工恢复 V8 成功路径

“可保留”不等于对应 r11 节点已经完成；完成仍以各规格的负边界、唯一 writer 和有效门为准。

## 4. 当前恢复顺序

1. **建立可恢复工作点。** 先区分无关 untracked 内容并按用户授权固定恢复点；未获授权时不得自行 commit/tag，也不得把变化中的 dirty tree 冒充 053/061 固定候选。换行与 EOF 噪声不在此步越权修改，分别随 026、029、037、052 的合法文件范围清理，最终由 `git diff --check` 证明。
2. **r11-000：修路线裁判。** 对 checker 报出的每个路径逐项分类为可执行 evidence、Read first、历史描述或删除目标；只要求真实可执行入口存在，禁止通过删除重要引用或放宽检查求绿。若最后只剩 preservation map/matrix 的真实 stale evidence，精确交给 r11-001。
3. **r11-001：先恢复当前 preservation 权威。** 不改 PM-01–PM-28 标准，修复当前 map/matrix、checker 输入闭包与失效条件，使 `check:preservation` 和 `check:development-roadmap` 在 002 前都通过。
4. **r11-002：修 Legacy scanner。** ratchet 必须按精确 `path#symbol` 阻止新增 endpoint；ready/zero 必须绑定当前候选 identity；zero 必须直接断言允许的元数据以外 live token、旧模块、Schema 8 作者样本、`.h5lesson` 与正式生成物全部为零。已登记旧目标自身的定义命中标为 `target-definition`：ready 允许 `file-absent` 目标尚在，zero 报 `legacy-module-present`。增加“inventory 已清空但 live token 仍在”等 false-pass fixture。
5. **分类并排队 scanner owner return。** 按精确 consumer 把 SceneStateStrip、PPTX shared、visual density、Course Project model 及其他命中排到 r11-013/020/033/040/041/037/052 等既有 Owner；这里只建立精确 failure queue，不提前执行节点。每个 Owner 仍须等待稳定 DAG 前置成立，037/052 的命中并入后续第 6/7 步，不能绕过 026 → 029 → 025 复核。
6. **r11-026 → r11-029 → 复核 r11-025 → r11-037：定向返工 Owner 边界。** 026/029 共用 `workspace-properties` 写锁，串行执行。029 后重验 r11-025，只有 evidence closure 失效才执行它；037 前再确认 r11-032/034–036 闭包未变。保留叶子与 slices，只删除 root 中仍在的业务、宽 Facade、镜像、万能服务和模块级 service locator。
7. **r11-052：闭合测试迁移与 evidence。** 所有保留成功行为只使用 V9/V2；V8 仅保留最小 fail-loud rejection。逐 case 记录被删测试与 replacement/PM 证据；只要本任务改变 evidence，就在同一任务同步 preservation map/matrix，并保持 preservation/roadmap 两门为绿，不再把正常交接退回 r11-001。
8. **r11-055：重做删除前结构门。** 使用 TypeScript import/AST/精确 symbol 与固定最小违规 fixture，同时证明 root-only wiring、UI roots only routing、无第二 writer/镜像/宽 Facade/运行时环。门只接受本次 pre-delete gate 的最终源码、测试、helper 与 ledger 状态；行为绿和结构绿必须同时成立。
9. **r11-053：在固定候选上重新 reconciliation。** 只更新唯一 inventory；ready 必须通过，zero 只允许 `file-absent` 待删除目标自身的 `target-definition` 导致明确 `legacy-module-present`。`symbol-absent` 可在宿主文件保留时闭合。旧 digest、旧 deletion list 和 LEG-008 的旧结论都必须重新证明。
10. **r11-054 → post-delete r11-055 revalidation → r11-060 → r11-061。** 054 只删除新 053 明确授权的精确路径；全部删除、generator 输出和测试清理稳定后，允许 ledger 仅按本次授权删除一一对应地单调减少 consumer，再在最终 post-delete closure 以未改变的 assertion/helper/fixture/baseline/白名单重跑完整 055 gate。只有需要改变 assertion、AST/import helper、fixture 语义，ledger 新增边/改 owner、放宽 baseline/白名单，或修产品/测试时，才回滚受影响删除并返回 055；这些变化都要求从 053 重做 reconciliation。通过后，060 用 scanner 的固定 `--report` 输出证明真实零遗留，061 在同一 clean candidate 上通过 contracts、路线、preservation、zero、verify 与 diff hygiene。
11. **r11-062。** r11-061 解锁后工程会话停止，交由 Owner 对固定课例签署；未签署不得 tag 或发布。

不新增 `r11-*` ID；失败返回现有 failure owner。跨会话真正开始执行时，按 `WORKING_PROTOCOL.md` 为当下首个节点建立任务卡并生成任务板；本 handoff 不伪造 queued/active/blocked 状态。

## 5. 各门必须补上的反例

### r11-002

- inventory confirmed/unknown 均为零，但扫描范围仍有旧 token：ready/zero 必须失败
- 已登记 path 中新增另一个旧 symbol：ratchet 必须失败，不能退化成 path allowlist
- current tree digest 与 reconciled identity 不同：ready/zero 必须失败为 stale candidate
- `.h5lesson` 的 `project.json.schemaVersion = 8` 或正式 HTML 含旧 bundle token：zero 必须失败
- inventory 汇总计数与 records 不一致：malformed inventory

### r11-055

- `Workspace.tsx` 直接调用 raw Store、构造 Surface command facade 或内联 connector：失败
- `PropertiesTab.tsx` 直接 mutation、解析 target 或 import Surface command：失败
- `editorStore.ts` 在 factory 内外实现 projection/persist/Feature planner，或 import `ui/**`：失败
- `crossSurfaceCommands` 实现 Surface command、save/recovery/persist，或 Feature port 汇总完整 document/session/writer：失败
- module-global mutable bind/service locator、第二 History/writer、Core→Feature 或 Store→UI 边：失败

不得用 LOC、文件数、字符串存在性、大白名单或“叶子 import 已存在”替代这些结构事实。

## 6. Legacy 清理边界

当前 208 confirmed / 404 tokenHits 只是审计快照，不是删除清单。旧 handoff 中列出的 Player、Export、Shared V8、Archive 路径只可作为调查线索；它遗漏了正式合同、V9 schema union、Audio/Flow host、旧成功测试和非 token import 等 consumer。

r11-053 之前禁止写 inventory 来伪装减少；r11-054 之前禁止删除旧模块。唯一删除授权必须来自修正 scanner 后、同一固定候选上的新 r11-053 handoff，格式仍为：`LEG ID / exact path / zero query / replacement / PM evidence`。

## 7. 硬边界

- Course Project V9、Published Course V2、Runtime API 2/3、Component API 4；不恢复 V8 导入，不创建 V10
- 不整体回滚 Grok 已有成果，不恢复 `tests/helpers/projectV8.ts` 或 V8 success suite
- 不通过改名 token、扩大排除、路径 allowlist、re-export、no-op、silent fallback 或弱化断言求绿
- 不新增第二 Store/Session/History、完整 Store Facade、兼容双写或万能 Surface service
- 不把自动化 `engineering candidate` 写成 Owner `accepted`
- 未经用户明确要求不 commit、tag 或发布 `v1.1.0`

## 8. 重新接手时的最小阅读顺序

1. `COURSEWARE_DEVELOPMENT_PLAN.md` 当前开发路线
2. `docs/development-plan/TASK_BOARD.md`
3. 本文件与将执行的 r11 规格
4. `docs/development-plan/ARCHITECTURE_CONTRACT.md` 对应 Owner/持久化/Published 条目
5. `docs/development-plan/WORKING_PROTOCOL.md`
6. 当前源码、直接 consumer 与目标测试

若文档自述与源码或可复现结果冲突，以源码和结果为准，先返回相应既有规格更新计划，不沿用旧完成状态。
