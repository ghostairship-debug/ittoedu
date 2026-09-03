# 1.1 剩余实施拆卡蓝图（Gemini）

> 当前检查点：`ee1f87e`。本文件定义顺序和每卡边界，不保存 queued/active 状态。任务目录可以保存已经裁定且依赖明确的 blocked 卡，但任一时点只能有一张 queued 卡。执行规则见 [EXECUTION_GUIDE.md](EXECUTION_GUIDE.md)。

## 1. 总顺序

```text
036b 去重竞态返工（已完成）
→ 037a–037z Store / Owner 收口（已完成）
→ 052a 与 052b 无争议部分（已完成）
→ 052c 旧 token / 拒绝夹具迁移
→ 052e V2 视频播放动作与事件
→ 052f V2 视频 / 背景音乐会话
→ 052g V2 scene.open-picker
→ 052h V2 Slide scene-local Component hybrid
→ 收口 052b 旧渲染器测试
→ 052d 保全证据路径
→ 053 台账重算
→ 054a–054d 按精确清单删除
→ Codex 最终复查：055 → 060 → 061
→ Owner 062
```

实施卡不跑全量测试、保全门、Legacy zero、verify 或 Hash。当前已知的 `test:product` 单项结构失败留到 055；Gemini 不修改其白名单求绿。

## 2. 任务卡流转

- 当前任务目录只保留一张 `queued` 卡；已经裁定的后继实现卡可保持 `blocked`，但不得提前执行。
- 完成 052c 时删除本卡，把 052e 从 blocked 改为 queued；052e–052h 每卡完成时删除本卡并只解锁下一卡；052h 完成后把 052b 改为 queued。每次都在同一实质提交中重新生成任务板，不创建单独“关闭卡”提交。
- 如果卡的起始查询与预期不一致，保留本卡并停止，不创建下一卡。
- 下表中的“目标测试”是一条命令，可同时列多个直接相关文件；产品 TypeScript 有变化时再单独运行 `npm run typecheck`。

## 3. 036 返工

### r11-036b-media-dedupe-race

- 目标：堵住 `tryInjectCandidateMedia` 内 `await dedupeCourseMediaImports(...)` 与 `commitCandidateMedia(...)` 之间的最后竞态。
- 写入：`src/renderer/app/useMediaImport.ts`、`tests/unit/useMediaImport.test.tsx`。
- 实现：给 `tryInjectCandidateMedia` 传入操作开始时的 identity 和错误标题；哈希去重返回后立刻调用现有 `assertFreshIdentity`，通过后才允许 `commitCandidateMedia`。图片、音频、视频三个调用点都传同一个 `started`，不新增 Store 动作或第二 identity 类型。
- 测试：mock `dedupeCourseMediaImports` 为 deferred；解码完成并进入去重后改变 revision，释放 deferred，断言 `commitCandidateMedia`、`placeImageNodes`、`importAssetsAtTarget` 都是 0 次，并出现“工程已发生变化”。这一条覆盖共享 helper，不再为三种媒体复制同义测试。
- 目标测试：`npx vitest run tests/unit/useMediaImport.test.tsx`。
- 停止：修复需要改 Store、`v9AssetAdapter.ts` 或媒体命令签名。

## 4. r11-037：Store 与 Owner 收口

### r11-037a-dead-text-edit-mirror

- 目标：只删除从不保存非 null 值的根级 `textEditSession` 镜像。
- 写入：`src/renderer/store/editorStore.ts`、`src/renderer/store/slices/editorShellSlice.ts`、`src/renderer/store/slices/{slide,flow,spatial}AuthoringSlice.ts`、`src/renderer/App.tsx`、`tests/unit/editorStore.test.ts`。
- 实现：删除 `TextEditSnapshot`、`TextEditSession`、根字段、初始化、`commitTextEditSessionState`、`commitOpenTextEdits` port、三个 slice 的 `textEditSession: null`；`selectHasDirtyCourseContentDraft` 删除该兜底；App 删除对应 watch。不要触碰 `shouldIgnoreSlideLayerDeleteForFocus` 入参中的同名布尔字段。
- 验收：`editorStore.ts`、App 和三个 slice 不再包含根镜像；文字草稿仍由 Slide/Flow/Spatial 各自 draft 字段负责。
- 目标测试：`npx vitest run tests/unit/editorStore.test.ts tests/integration/draftSaveTransaction.test.tsx`。

### r11-037b-asset-mirror-and-root-forwards

- 目标：删除根级 `assetFiles` 镜像、无用局部函数和 root re-export，不碰历史事务中的 `HistoryResourceState.assetFiles`。
- 写入：`src/renderer/store/editorStore.ts`、`src/renderer/store/editorStoreKernel.ts`、`src/renderer/store/courseResourceState.ts`、三个 Surface slice，以及仍直接 import root re-export 的编译错误 consumer。
- 实现：`CourseResourceState` 只保存 sidecar/component packages；`selectMediaAssetFiles` 从活动会话 sidecar 派生，无会话返回既有空常量；删除 `activeCourseDocument`、无用教师控制器 import 和 root `export {...} from`，consumer 直接指向 Owner。
- 目标测试：`npx vitest run tests/unit/assetTransactions.test.ts tests/unit/crossSurfaceResourceHistory.test.ts`。
- 停止：发现某 consumer 把根 `assetFiles` 当独立真相写入。

### r11-037c-history-unit-consumers-1

- 目标：只迁移下列 8 个测试对 `useEditorStore.getState().history` 的读取，产品代码不动。
- 写入：`batchMediaAndInsertion.test.ts`、`componentCatalogReplacement.test.ts`、`componentPackageManagement.test.tsx`、`componentPropertiesEditor.test.tsx`、`courseLogicAuthoringStore.test.ts`、`editorFormattingUi.test.tsx`、`formulaNode.test.ts`、`formulaNodeUi.test.tsx`。
- 实现：按测试当前活动 Surface 改读 `slideBackend.getSession().history`、`flowSession.history` 或 `spatialSession.history`；保持原来的 past/future 数值和引用相等断言。
- 目标测试：`npx vitest run tests/unit/batchMediaAndInsertion.test.ts tests/unit/componentCatalogReplacement.test.ts tests/unit/componentPackageManagement.test.tsx tests/unit/componentPropertiesEditor.test.tsx tests/unit/courseLogicAuthoringStore.test.ts tests/unit/editorFormattingUi.test.tsx tests/unit/formulaNode.test.ts tests/unit/formulaNodeUi.test.tsx`。

### r11-037d-history-unit-consumers-2

- 目标：迁移余下 7 个单元测试的根级 history 读取，产品代码不动。
- 写入：`courseDraftPersistence.test.ts`、`editorStore.test.ts`、`globalEditorStore.test.ts`、`scenePanelReorder.test.tsx`、`simpleEditorMode.test.tsx`、`textEmphasis.test.ts`、`unifiedDeleteTransaction.test.ts`。
- 实现与验收同 037c；不得删除历史深度、撤销分支或 no-op 不新增历史的断言。
- 目标测试：`npx vitest run tests/unit/courseDraftPersistence.test.ts tests/unit/editorStore.test.ts tests/unit/globalEditorStore.test.ts tests/unit/scenePanelReorder.test.tsx tests/unit/simpleEditorMode.test.tsx tests/unit/textEmphasis.test.ts tests/unit/unifiedDeleteTransaction.test.ts`。

### r11-037e-history-integration-consumers

- 目标：迁移 9 个集成测试的根级 history 读取，产品代码不动。
- 写入：`courseComponentPackageReplacementVerticalSlice.test.ts`、`componentTextEditSession.test.ts`、`courseInteractionAuthoringVerticalSlice.test.ts`、`courseMediaLibraryImportVerticalSlice.test.ts`、`courseRuntimeAssetReplacementVerticalSlice.test.ts`、`courseRuntimeSourceAuthoringVerticalSlice.test.tsx`、`interactionAuthoringUiIntegration.test.tsx`、`runtimePropertyAuthoringVerticalSlice.test.tsx`、`runtimeContentTextAuthoringVerticalSlice.test.tsx`。
- 实现：优先复用各文件已有 `activeHistory()`；没有时加文件内局部 helper，返回当前唯一 Surface session history。断言不减少。
- 目标测试：`npx vitest run tests/integration/courseComponentPackageReplacementVerticalSlice.test.ts tests/integration/componentTextEditSession.test.ts tests/integration/courseInteractionAuthoringVerticalSlice.test.ts tests/integration/courseMediaLibraryImportVerticalSlice.test.ts tests/integration/courseRuntimeAssetReplacementVerticalSlice.test.ts tests/integration/courseRuntimeSourceAuthoringVerticalSlice.test.tsx tests/integration/interactionAuthoringUiIntegration.test.tsx tests/integration/runtimePropertyAuthoringVerticalSlice.test.tsx tests/integration/runtimeContentTextAuthoringVerticalSlice.test.tsx`。

### r11-037f-history-mirror-removal

- 起始条件：`rg -l 'useEditorStore\.getState\(\)\.history' tests` 输出为空；不为空立即停止。
- 目标：删除根 `EditorState.history`、`writeHistoryMirror`、`storeHistoryFromSessionLengths` 和三个 slice 的同步写。
- 写入：`editorStore.ts`、`editorStoreKernel.ts`、三个 Surface slice、`store/history.ts` 的直接 importers、`tests/unit/historyResourceChanges.test.ts`、`tests/unit/architectureDependencyRatchet.test.ts` 中只与 history 镜像存在性相关的断言。
- 实现：把 `store/history.ts` 中仍有效的资源 change 导出消费者直接改到 `courseResourceState.ts`；删除只验证旧 `HistoryState/pushHistory` 的测试和文件。当前需核对的 importers 为 `editorTransaction.ts`、`resourceAwareAuthoringHistory.ts`、`slideEditorCommands.ts`、`v9MediaAudioCommands.ts`、`courseComponentPackageTransactions.ts`、`courseMediaLibraryImport.ts`、`courseRuntimeTransactions.ts`、`crossSurfaceResourceHistory.test.ts`、`editorTransaction.test.ts`、`interactionAuthoringCommands.test.ts`。
- 目标测试：`npx vitest run tests/unit/crossSurfaceResourceHistory.test.ts tests/integration/mixedCrossSurfaceHistory.test.tsx tests/unit/editorStore.test.ts`。

### r11-037g-shell-slide-lifecycle-types

- 目标：把 shell、Slide 与 lifecycle 类型从 root 移到已有 Owner，只有一个定义。
- 写入：`editorStore.ts`、`editorShellSlice.ts`、`slideOwnedCommands.ts`、`v9SlideContentCommands.ts`、`courseLifecycleSlice.ts` 及 TypeScript 报出的直接 type importers。
- 类型：`SidebarTab`、`EditorMode`、`EditingScope`、`CanvasMode`、`TextEditSource` → shell；`AlignmentMode` → slideOwnedCommands；`SimpleEntranceAnimationConfig` → v9SlideContentCommands；四个 persistence snapshot/token/result 类型 → lifecycle。
- 验证：`npm run typecheck`；不另跑行为测试。

### r11-037h-feature-result-types

- 目标：把媒体、组件、Runtime、Interaction 结果类型从 root 移到各 Feature 文件。
- 写入：`editorStore.ts`、`courseAuthoringSession.ts`、`commitCourseMediaAuthoring.ts`、`commitComponentPackageAuthoring.ts`、`commitRuntimeAuthoring.ts`、`commitInteractionAuthoring.ts` 及 TypeScript 报出的直接 type importers。
- 类型：严格按旧 037 规格中的 Owner 表迁移；root 只 type-import 以合成 Store，不 re-export。
- 验证：`npm run typecheck`；不另跑行为测试。

### r11-037i-slide-persist-owner

- 目标：把 `applyV9Backend`、`persistCandidateResult`、`persistLayerCommand`、`persistMediaResult` 的实现迁入 `slideAuthoringSlice.ts`，root 只接返回成员。
- 写入：`editorStore.ts`、`slideAuthoringSlice.ts`、`crossSurfaceCommands.ts`、`courseLifecycleSlice.ts`。
- 目标测试：`npx vitest run tests/unit/v9SlideProductIntegration.test.tsx tests/integration/imageReplacementVerticalSlice.test.ts`。

### r11-037j-flow-persist-owner

- 目标：把 `applyFlowBackend`、`persistFlowResult`、`persistFlowLayerCommand` 迁入 Flow slice。
- 写入：`editorStore.ts`、`flowAuthoringSlice.ts`、`crossSurfaceCommands.ts`、`courseLifecycleSlice.ts`。
- 目标测试：`npx vitest run tests/unit/flowProductIntegration.test.tsx tests/integration/courseMediaLibraryImportVerticalSlice.test.ts`。

### r11-037k-spatial-persist-owner

- 目标：把 `applySpatialBackend`、`persistSpatialResult`、`persistSpatialLayerCommand` 迁入 Spatial slice，并保留 037-W0 的资源 Undo/Redo generation 行为。
- 写入：`editorStore.ts`、`spatialAuthoringSlice.ts`、`crossSurfaceCommands.ts`、`courseLifecycleSlice.ts`。
- 目标测试：`npx vitest run tests/unit/spatialProductIntegration.test.tsx tests/integration/mixedCrossSurfaceHistory.test.tsx`。

### r11-037l-kernel-persistence-dispatch

- 目标：在 kernel 建立 `persistDocument`、`persistTransaction` 两个窄入口；三 Surface slice 各实现自己的分支，root 只用 `dispatchActiveSurface` 接线。
- 写入：`editorStoreKernel.ts`、`editorStore.ts`、三个 Surface slice、`surfaceRouter.ts`。
- 禁止：kernel import UI、Feature 或 root Store；root 内保留具体 Surface mutation。
- 目标测试：`npx vitest run tests/integration/courseInteractionAuthoringVerticalSlice.test.ts tests/integration/courseRuntimeSourceAuthoringVerticalSlice.test.tsx`。

### r11-037m-runtime-interaction-ports

- 目标：Runtime 与 Interaction 各声明自己实际使用的窄 ports，不再 import `FeatureAuthoringPorts`。
- 写入：`commitRuntimeAuthoring.ts`、`commitInteractionAuthoring.ts`、`editorStore.ts`、必要的直接测试类型。
- 实现：ports 成员只覆盖文件中真实 `ports.*` 调用；root 分别传对象，不创建共享汇总对象。
- 目标测试：`npx vitest run tests/integration/courseRuntimeSourceAuthoringVerticalSlice.test.tsx tests/integration/courseInteractionAuthoringVerticalSlice.test.ts`。

### r11-037n-component-ports

- 目标：组件 Authoring 使用自己的窄 ports。
- 写入：`commitComponentPackageAuthoring.ts`、`editorStore.ts`、必要的直接测试类型。
- 目标测试：`npx vitest run tests/integration/courseComponentPackageReplacementVerticalSlice.test.ts tests/integration/componentPackageReplacementRace.test.tsx`。

### r11-037o-media-ports-and-facade-removal

- 目标：媒体 Authoring 使用自己的窄 ports；四个 Feature 都完成后删除 `featureAuthoringPorts.ts` 和 root 的 `featurePorts` 汇总对象、`persistProjectResourceTransaction` 旧实现。
- 写入：`commitCourseMediaAuthoring.ts`、`editorStore.ts`、`featureAuthoringPorts.ts`（删除）、直接 importers。
- 起始条件：`FeatureAuthoringPorts` 只剩媒体与 root 使用；否则停止。
- 目标测试：`npx vitest run tests/integration/courseMediaLibraryImportVerticalSlice.test.ts tests/integration/imageReplacementVerticalSlice.test.ts`。

### r11-037p-course-structure-owner

- 目标：新建 `courseStructureSlice.ts`，持有 `persistCourseProjectCommand`、新增内容/场景、Surface 重排/删除、Slide 场景移动和位置删除。
- 写入：新文件、`editorStore.ts`、`crossSurfaceCommands.ts`、三个 Surface slice 中只与结构结果接线相关的位置。
- 实现：结构 slice 返回 `{ok, activatedLocationId?}`；router 只在成功后分派激活位置，不复制 mutation。
- 目标测试：`npx vitest run tests/unit/courseLocationCommands.test.ts tests/unit/courseTreeView.test.ts`。

### r11-037q-lifecycle-command-owner

- 目标：把 archive 重开、草稿物化、保存准备、Recovery snapshot 与保存 ACK 从 `crossSurfaceCommands.ts` 迁到 `courseLifecycleSlice.ts`。
- 写入：`crossSurfaceCommands.ts`、`courseLifecycleSlice.ts`、三个 Surface slice、`editorStore.ts`。
- 实现：各 Surface 只提供 `commitDraftForPersistence` 与 `materializeDraft`；lifecycle 组合，router 不处理 archive 字节。
- 目标测试：`npx vitest run tests/unit/courseDraftPersistence.test.ts tests/integration/draftSaveTransaction.test.tsx`。

### r11-037r-surface-navigation-owner

- 目标：把 `setSpatialGraphSelection`、Flow block 激活和 Surface 特有导航分支迁回对应 slice。
- 写入：`crossSurfaceCommands.ts`、`flowAuthoringSlice.ts`、`spatialAuthoringSlice.ts`、`editorStore.ts`。
- 目标测试：`npx vitest run tests/unit/spatialAuthoringTarget.test.ts tests/unit/flowProductIntegration.test.tsx`。

### r11-037s-layer-command-owners

- 目标：把全局图层设置、重排、owner 移动和位置可见性的 Flow/Spatial 实现迁到对应 slice；cross-surface 只分派。
- 写入：`crossSurfaceCommands.ts`、三个 Surface slice、`slideOwnedCommands.ts`、`editorStore.ts`。
- 目标测试：`npx vitest run tests/unit/effectiveLayerCommands.test.ts tests/unit/globalLayerUi.test.tsx`。

### r11-037t-routed-action-owners

- 目标：把 `routeEditorAction` 的三 Surface adapter、global delete 分支和 focus 推导迁到各 slice；router 只组装 snapshot 并分派。
- 写入：`crossSurfaceCommands.ts`、三个 Surface slice、`editorStore.ts`。
- 目标测试：`npx vitest run tests/unit/editorActionRouting.test.ts tests/unit/unifiedDeleteTransaction.test.ts`。

### r11-037u-teacher-controller-injection

- 目标：删除教师控制器的模块级 bind/service locator；两个工厂的 ports 改为必填。
- 写入：`v9TeacherControllerAuthoring.ts`、`editorStore.ts`、`SlideLocationWorkspace.tsx`、三个教师控制器直接测试。
- 目标测试：`npx vitest run tests/unit/teacherControllerAuthoringBounds.test.ts tests/unit/teacherControllerAuthoringOwnership.test.tsx tests/unit/teacherControllerRuntimeSession.test.ts`。

### r11-037v-canvas-projection-owner

- 目标：新建 `course/editorCanvasProjection.ts`，迁入 Slide/Flow/Spatial 画布投影 helper、缓存与 effective projection；root selector 只委托。
- 写入：新文件、`editorStore.ts`、`activeSurfaceProjection.ts`、结构测试中只允许修复因移动而失效的切片锚点。
- 禁止：新文件 import `useEditorStore` 或执行 mutation。
- 目标测试：`npx vitest run tests/unit/v9SlideViewportAdapter.test.ts tests/unit/spatialProductIntegration.test.tsx tests/unit/flowProductIntegration.test.tsx`。

### r11-037w-editor-state-composition

- 目标：`EditorState` 改为 owner state 与各工厂返回类型的交叉类型；root 工厂只剩 kernel host、slice/Feature 工厂调用、分派接线、初始值和展开返回。
- 写入：`editorStore.ts`、各 Owner 暴露的 state/action 类型，以及 TypeScript 报出的直接类型 consumer。
- 禁止：为了合成方便恢复手写完整 Facade、raw `get()` 注入或 root re-export。
- 目标测试：`npx vitest run tests/unit/editorStore.test.ts tests/unit/readModelBoundary.test.ts`。

### r11-037x-root-selection-core-consumers

- 目标：先提供按活动 Surface 派生的命名 selector/command，再迁移 App、composition、Runtime、Media、Component、Interaction 对五个根镜像字段的读取。
- 字段：`activeSceneId`、`activePresentationStateId`、`selectedNodeId`、`selectedNodeIds`、`editingScope`。
- 写入：`editorStoreKernel.ts`、三个 Surface slice、`editorStore.ts`、`App.tsx`、`composition/**`、四个 Feature owner 的直接 consumer。
- 本卡不删除根字段，给下一卡保留兼容读取；不得新增第二写入。
- 目标测试：`npx vitest run tests/integration/courseInteractionAuthoringVerticalSlice.test.ts tests/integration/runtimePropertyAuthoringVerticalSlice.test.tsx`。

### r11-037y-root-selection-ui-consumers

- 目标：迁移 `ui/**`、Phaser bridge 和三个 Workspace connector 对五个根镜像字段的读取，改用命名 selector或单一 Owner view。
- 写入：届时 `rg` 命中的 `src/renderer/ui/**`、`src/renderer/phaser/**`、`editorStore.ts` 的 selector 导出；不改 Feature 或测试。
- 目标测试：`npx vitest run tests/unit/v9SlideProductIntegration.test.tsx tests/unit/flowProductIntegration.test.tsx tests/unit/spatialProductIntegration.test.tsx tests/unit/globalLayerUi.test.tsx`。

### r11-037z-root-selection-tests-and-removal

- 起始条件：五个字段在 `src/renderer` 中除 root 声明/初始化/同步写和命名 selector 外零直接 consumer；否则停止并列出遗漏。
- 目标：迁移测试读取，然后删除五个根字段及 `kernel.readSelection/syncSelection` 镜像写入；不删除各 Surface 自有 selection。
- 写入：届时直接命中的测试、`editorStore.ts`、`editorStoreKernel.ts`、三个 Surface slice。
- 目标测试：把实际改动的测试文件合并为一条 `npx vitest run ...` 命令；不得运行全量。产品 TypeScript 改动后运行 `npm run typecheck`。
- 验收：四个 Workspace 连接器不再通过完整 project/root mirror 拼业务对象；已知结构测试可以在 055 被诚实修复，而不是靠白名单。

## 5. r11-052：旧成功测试迁移

### r11-052a-player-scene-tests

- 处理：`playerSceneMotionLifecycle.test.ts`、`playerSceneComponentEventBuffer.test.ts`、`playerSceneAnimationMode.test.ts`。
- 每个 `it` 只做三选一：已有 V2 同行为测试则删除旧重复；行为仍受支持但 V2 无覆盖则迁入 `publishedCourseState.test.ts` / `publishedCourseNavigation.test.ts`；明确 V8 输入拒绝则保留最小裸对象，不 import 旧类型。
- 验证：只运行上述被改文件及实际承接用例的 V2 文件。

### r11-052b-old-renderer-tests

- 处理：`componentEventMountBuffer.test.ts`、`formulaCrossSurface.test.tsx`、`nodeMotionDirector.test.ts`、`playerComponentV4Render.test.ts`、`renderVideoNode.test.ts`、`teacherControllerActions.test.ts`、`playerSceneAssets.test.ts`。
- 保留的用户行为迁到 Published V2 host 测试；不得通过删除公式、视频、组件、动画或教师控制器能力来清零。
- 验证：一条命令运行被改文件及实际新增用例所在的 V2 测试。

### r11-052c-old-token-and-rejection-tests

- 处理现存 `ProjectDocument`、`SceneDocument`、`SceneNode`、`ExportPayload` 与 `schemaVersion: 8` 测试命中。
- 成功路径必须迁移或删除重复；拒绝路径只保留构造拒绝所需的最小对象/字节，不 import 旧 Schema 类型。
- 禁止改产品代码、Legacy scanner 或排除项。
- 验证：只运行实际修改的测试文件。

### r11-052e-v2-video-playback

- 起始条件：052c 已完成；`paintPublishedNativeVideo` 的播放态仍只是裸 `<video controls>`，且 `PublishedInteractionController` 仍把视频触发器/动作诊断为 unsupported。任一事实已变化则停止并报告，不叠加第二实现。
- 目标：在 Published V2 Slide scene-local Native 宿主建立一份有生命周期的视频句柄，完整消费 Native Video 字段；把 Interaction V1 的 `video.play/pause/restart/stop/toggle/seek` 与 `video.started/paused/ended/time` 接到当前视频 generation。
- 写入：`src/player/surfaces/slide/publishedNativeRendering.ts`、允许新增 `src/player/surfaces/slide/publishedNativeVideoMount.ts` 与 `publishedSlideInteractionSurfacePort.ts`、`src/player/surfaces/slide/SlidePublishedAdapter.ts`、`src/player/interactions/PublishedInteractionSurfacePort.ts`、`src/player/interactions/PublishedInteractionController.ts`、`tests/unit/publishedInteractionController.test.ts`、`tests/integration/publishedInteractionSlideHostIntegration.test.ts`。
- 实现：播放态应用 `autoplay/loop/muted/volume/playbackRate/startTime/endTime/showControls/clickToToggle/fit`；事件只来自当前句柄并携带 nodeId，重复 rerender/navigation/suspend/destroy 后旧句柄不能再触发规则；capture 仍只取封面且所有播放动作返回未执行，不自动播放、不发 started。不得通过 DOM id 查询任意节点，视频注册表由 Slide 宿主持有。
- 验收：六类视频动作都路由到正确 node；四类视频触发器可启动 V2 规则；自然结束、暂停、隐藏、重挂载与销毁均清理监听/播放；原静态封面行为保持。
- 目标测试：`npx vitest run tests/unit/publishedInteractionController.test.ts tests/integration/publishedInteractionSlideHostIntegration.test.ts`；产品 TypeScript 变化后再跑 `npm run typecheck`。
- 停止：需要修改 V9/Published V2 wire、Flow/Spatial 视频 carrier、legacy `PlayerApp/renderVideoNode`，或需要建立第二 Interaction controller/event bus。

### r11-052f-v2-video-background-audio

- 起始条件：052e 已完成，V2 Slide 视频句柄已具有稳定 play/pause/end/destroy 生命周期；否则停止。
- 目标：由 Published 整课会话唯一持有 AudioManager，使用 Published V2 `media.audio` 与资产解析；视频按 `backgroundAudioMode` 在真实播放生命周期获取/释放 interruption，教师控制器静音与 Interaction V1 audio 动作/`audio.ended` 使用同一会话音频真相。
- 写入：`src/player/AudioManager.ts`、`src/player/surfaces/publishedDynamicHosts.ts`、`src/player/surfaces/slide/SlidePublishedAdapter.ts`、`src/player/surfaces/slide/publishedNativeRendering.ts`、052e 新增的视频 mount 文件、`src/player/interactions/PublishedInteractionSurfacePort.ts`、`src/player/interactions/PublishedInteractionController.ts`、`tests/unit/audioManager.test.ts`、`tests/unit/publishedInteractionController.test.ts`、`tests/integration/publishedInteractionSlideHostIntegration.test.ts`。
- 实现：先把 AudioManager 的 `ProjectDocument/VideoNode` 类型依赖改到正式 media-v1/native-v1 合同，不保留 V8 type import；一个非作者 Published session 恰好一个 manager，capture 使用其既有 inert 语义，destroy 恰好一次。`duck/pause` token 可重入且在 pause/end/error/隐藏/重挂载/destroy 时释放，`stop` 不恢复已停止音乐；视频音量/静音注册与全局/频道音量使用同一 manager。
- 验收：真实 V2 会话可用 Interaction 规则播放音乐，视频开始时应用四种 backgroundAudioMode，生命周期结束后恢复正确；`audio.toggle-mute` 在 Slide/Flow/Spatial 控制器都落到同一 session；迟到媒体事件不能复活已销毁音频状态。
- 目标测试：`npx vitest run tests/unit/audioManager.test.ts tests/unit/publishedInteractionController.test.ts tests/integration/publishedInteractionSlideHostIntegration.test.ts`；再跑 `npm run typecheck`。
- 停止：需要新增持久字段、复制 AudioManager、把音频状态放进 Surface 私有 Store，或修改 legacy Player 实现。

### r11-052g-v2-scene-picker

- 起始条件：052f 已完成；Published session 的 `executeTeacherControllerAction` 对 `scene.open-picker` 仍返回 undefined，且没有 session-owned picker。若已有唯一 V2 实现则停止。
- 目标：在非作者、非 capture 的 Published 整课会话只挂载一个 `ScenePickerOverlay`，让任一 Surface 的教师控制器 `scene.open-picker` 打开同一目录。
- 写入：`src/player/ScenePickerOverlay.ts`、`src/player/surfaces/publishedDynamicHosts.ts`、`tests/unit/scenePickerOverlay.test.ts`、`tests/unit/publishedCourseNavigation.test.ts`。不得修改三个 Surface 的本地导航实现，除非现有中央 `executeTeacherControllerAction` 类型无法编译；发生时停止报告。
- 实现：目录按 `MixedCourseNavigator.listCatalog()` 顺序列出 location label/id，打开时以当前 location 标亮；选择复用教师控制器强制导航路径并进入目标 location 自带的初始 state，不写 Published payload/作者工程；任意导航、Esc、遮罩点击、销毁都关闭并清理焦点/监听。作者宿主与静态 capture 不创建目录。
- 验收：Slide/Flow/Spatial/Mixed 上的全局控制器都能打开一个目录并跳到所选 location；选择可按教师控制器合同越过导航守卫；重复打开/切 Surface 不复制 overlay；destroy 后 DOM 与监听均为零。
- 目标测试：`npx vitest run tests/unit/scenePickerOverlay.test.ts tests/unit/publishedCourseNavigation.test.ts`；再跑 `npm run typecheck`。
- 停止：需要改变 `TeacherControllerAction`、Course Location 或 Published V2 wire，或要在每个 Surface 各建 picker。

### r11-052h-v2-component-hybrid

- 起始条件：052g 已完成；Component API 4 仍声明 `hybrid`，Slide 当前仍把它送入 DOM mount 并把 create context 硬编码为 `renderMode: 'dom'`。事实不符则停止。
- 目标：只为 Published V2 Slide scene-local Component 建立一个同时提供 `dom.root` 与 `phaser.{Phaser,scene,root}` 的 hybrid 实例；同一 instance 只有一个 create/lifecycle/capture/generation/destroy。
- 写入：`src/player/surfaces/publishedComponentMount.ts`、`src/player/surfaces/slide/publishedSlidePhaserComponentMount.ts`、`src/player/surfaces/slide/SlidePublishedAdapter.ts`、`tests/unit/publishedComponentMount.test.ts`、`tests/integration/publishedPhaserComponentSlideHostIntegration.test.ts`。
- 实现：Slide scene-local `hybrid` 与 `phaser` 走同一 Phaser boot owner，但 hybrid 在同一 wrapper 建 DOM surface 并传入真实 hybrid context；props、resize、visibility、suspend/resume、capture、authoring target invalidation、错误隔离和 destroy 同步作用于这一实例。通用 DOM mount 只接受 `dom`；Flow、Spatial、global hybrid 本卡不扩展，必须显式 fallback/diagnostic，不能静默按 DOM 运行。
- 验收：hybrid definition 的 create 恰好一次且同时拿到 DOM/Phaser 能力；更新、capture、重挂载和销毁不双生命周期、不泄漏 Canvas/DOM/事件；既有 dom 与 phaser 测试保持通过。
- 目标测试：`npx vitest run tests/unit/publishedComponentMount.test.ts tests/integration/publishedPhaserComponentSlideHostIntegration.test.ts`；再跑 `npm run typecheck`。
- 停止：需要支持 Flow/Spatial/global hybrid、修改 Component API 4/Published V2 schema，或建立两个 component instance 再同步状态。

### r11-052d-preservation-evidence-links

- 起始条件：052e–052h 已完成，052b 已用 V2 测试承接并删除剩余旧测试；否则不得开始。
- 目标：仅把因 052a–c 与四张 V2 补实现卡移动的 PM 测试路径更新到 `v1.1-preservation-map.json` 与 `PRESERVATION_MATRIX.md`，不改 PM 行为文字。
- 验证：`npx vitest run tests/unit/preservationChecker.test.ts tests/unit/developmentRoadmap.test.ts` 与 `npm run check:development-roadmap`。
- 禁止：运行 `check:preservation`；最终 061 才运行一次。

## 6. r11-053 与 r11-054：Legacy 清理

### r11-053-legacy-list

- 在 037z、052d 后先运行一次 `check:legacy-inventory`，按其 structured output 更新唯一 `legacy-consumers.json` 的明细、计数，以及 schema 强制要求的当前 commit/product digest；不另算文件 Hash。
- 输出一张精确删除表：`LEG ID / 文件路径 / 当前 consumer=0 / replacement 测试`。不写第二报告，不删除文件。
- 验证：更新前运行一次 `npm run check:legacy-inventory` 取得事实，更新后只运行 `npm run check:legacy-ready`。

### r11-054a–r11-054d-delete-groups

- 053 才能把实际路径填入四张卡；空组不建卡。
- 固定顺序：Shared contract → Player/payload → Export/diagnostics → Archive/test helper。
- 每卡只能删除 053 表中的本组路径及直接失效的 barrel/import/config 行；不能新增替代实现、alias、re-export 或 fallback。
- 每卡验证：`npm run typecheck`，再运行本组 replacement 的一条测试命令。实施阶段不运行 Legacy zero 或全量测试。
- 最后一组完成后运行一次 `check:legacy-inventory` 取得删除后 schema 强制的 product digest，连同 `removed` 状态一次更新 inventory；不生成文件 Hash或候选报告。

## 7. Codex 最终复查（Gemini 不执行）

### r11-055-final-architecture-review

- 审实际 diff 与 import graph，确认 root 只接线、无宽 Facade/镜像/service locator，Workspace/Properties 只路由。
- 只运行：`npx vitest run tests/unit/architectureDependencyRatchet.test.ts tests/unit/readModelBoundary.test.ts`。
- 若门定义本身不诚实，由 Codex按合同修门；不建设新的评分平台或大批违规 fixture。

### r11-060-final-legacy-zero

- 只运行一次 `npm run check:legacy-zero`；不额外生成候选 Hash 或重复扫描报告。

### r11-061-final-regression

- 在最终代码不再变化后各运行一次：`npm run typecheck`、`npm run test:product`、`npm run check:preservation`。
- 任一失败返回最小责任卡；修复后只重跑被改动影响的最终命令。

### r11-062-owner-release

- 自动化全部通过后停止，由 Owner 对固定 Slide、Flow/DOCX、Spatial/Mixed 与 Runtime/Component 课例实测并决定是否签署发布。
