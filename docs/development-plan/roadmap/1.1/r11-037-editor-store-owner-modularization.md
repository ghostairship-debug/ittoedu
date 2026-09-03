# r11-037-editor-store-owner-modularization｜按 Owner 拆 Store 并清除最后旧工程真相

- Release / Dependencies: 1.1 / r11-025-editor-store-v9-only, r11-032-player-v2-only-entry, r11-034-app-project-lifecycle-module, r11-035-app-delivery-module, r11-036-app-import-input-modules
- Write locks: `editor-store-history`, `workspace-properties`
- Inventory access: `read`
- Preservation: PM-01–PM-18, PM-25–PM-27

## 2026-09-03 执行版（基于 HEAD bb1f848）

通用规则、术语与交接模板见 [执行者指南](EXECUTION_GUIDE.md)。本节点不整体重写，按下面九波逐波迁移：每波一张执行卡、一个提交、一组结构事实。W1 到 W7 的符号表已按当前 HEAD 钉死；W8、W9 的范围固定，符号表由 Integrator 在前一波复查通过后按届时代码补齐再签卡。任何一波发现表中符号已不存在、consumer 与表不符或需要卡外新名字，立即停止交接。

## Outcome / current evidence

`src/renderer/store/editorStore.ts` 当前 2236 行：1–505 行是来自 9 个 owner 目录的 60 处 import；507–622 行是 Slide/Spatial/Flow 画布投影 helper；624–833 行是应归各 Feature 与 lifecycle 所有的结果类型；835–1160 行是手写的扁平 `EditorState`；1204–1878 行的工厂里仍实现 Surface apply/persist 包装、`featurePorts` 宽 Facade（1435–1530）、kernel/slice 接线与 `bindTeacherControllerAuthoringPorts`（1734）；1880–2237 行是带模块级缓存的投影 selector。`src/renderer/composition/crossSurfaceCommands.ts`（1767 行）除跨 Surface 分派外还实现项目结构命令、archive 重开、草稿物化、保存/恢复快照与 ACK。`src/renderer/authoring/featureAuthoringPorts.ts` 是被四个 Feature 工厂消费的宽 Facade。`src/renderer/authoring/v9TeacherControllerAuthoring.ts:105–120` 是模块级全局绑定。

## Read first

每波只读该波表中列出的文件与行号；开工前额外读 `src/renderer/store/editorStoreKernel.ts`（全文，218 行）与 `src/renderer/composition/surfaceRouter.ts`（全文，220 行）。

## Fixed module map

| Owner module | Own state/actions | Must not own |
|---|---|---|
| `src/renderer/store/editorStoreKernel.ts` | canonical document read、authoring identity、resource commit、feedback；`persistDocument` 与 `persistTransaction` 两个跨 Surface 分派入口（实现由根接线以分派表提供） | UI、Surface selection、Feature planner、Zustand hook |
| `src/renderer/store/courseResourceState.ts` | asset/component sidecar 与 resource delta/apply | Surface selection、V8 `assetFiles` 镜像 |
| `src/renderer/store/slices/slideAuthoringSlice.ts` | Slide session/selection/draft、`applyBackend`/`persist`、Slide 层命令、`deleteScene`、routed delete、草稿物化 | Flow/Spatial state、App lifecycle |
| `src/renderer/store/slices/flowAuthoringSlice.ts` | Flow 同上 | Slide/Spatial state |
| `src/renderer/store/slices/spatialAuthoringSlice.ts` | Spatial 同上，含 `setGraphSelection` | Slide/Flow state |
| `src/renderer/store/slices/courseLifecycleSlice.ts` | project identity、dirty/save/recovery 状态、persistence snapshot/token 类型、archive bytes 导入导出、`prepareCourseProjectPersistence` / `captureCourseProjectRecoverySnapshot` / `acknowledgeCourseProjectSaved` | archive IO effect（属 App hook）、Preview/Export |
| `src/renderer/store/slices/courseStructureSlice.ts`（新，W5 创建） | 新增页面/场景、重排 Surface、删除 Surface、移动 Slide 场景、删除位置等课程结构命令 | Surface 内容命令、lifecycle 状态 |
| `src/renderer/store/slices/editorShellSlice.ts` | tab/mode/canvasMode/status 等 App UI state 及其类型 | document/resource/Surface writer |
| `src/renderer/course/editorCanvasProjection.ts`（新，W7 创建） | Slide/Spatial/Flow 画布节点投影与其记忆化 | Store、mutation |
| `src/renderer/composition/surfaceRouter.ts` | exactly-one Surface 的纯选择/切换计划 | Store hook、命令实现 |
| `src/renderer/composition/crossSurfaceCommands.ts` | 只做跨 Surface 分派（W5 白名单） | 任何 Surface 命令实现、persist、lifecycle、archive |
| `editorStore.ts` | 唯一 Store 实例化、kernel host、slice/port 接线、`EditorState` 类型合成、窄 selector 导出 | 一切实现 |

合法窄 adapter 只消费命名 selector、单一 owner view 与 typed command port；不得读取完整 `State` / document、调用 raw `getState/setState`、组合跨 owner mutation/persist、持有 module-global mutable bind，或返回可替代 Store 的宽对象。

## Exact targets：九波

### W1 死镜像、V8 残留与 re-export 清除（承接 r11-025 移交）

| 符号 | 位置 | 动作 |
|---|---|---|
| `EditorState.textEditSession`、`TextEditSession`、`TextEditSnapshot` | `editorStore.ts:656–671`、`:851` | 删除。写方只有 `null`（slices `:259`、`:421`、`:451`；root `:1194`、`:1842`），没有非 null 写入 |
| `commitTextEditSessionState` | `:1189–1196` | 删除；`editorShellSlice.ts` 的 `commitOpenTextEdits` port 与 root `:1732` 的实现随之删除 |
| `selectHasDirtyCourseContentDraft` 末行 `return Boolean(state.textEditSession)` | `:1182` | 改为 `return false` |
| 注意 | `crossSurfaceCommands.ts:1382`、`slideOwnedCommands.ts:127`、`:363` 的 `textEditSession:` | 是 `shouldIgnoreSlideLayerDeleteForFocus` 的入参字段，**不得触碰** |
| `EditorState.history: HistoryState` 与初始化 `history: emptyHistory()` | `:845`、`:1836` | 删除 |
| `writeHistoryMirror`、`storeHistoryFromSessionLengths` 及三份 slice 的调用 | `editorStoreKernel.ts:68`、`:81`、`:117–126`；`slices/*.ts` | 删除 |
| `history.ts` 的 `HistoryEntry`、`HistoryState`、`emptyHistory`、`pushHistory` | `src/renderer/store/history.ts:29–73` | 若 `grep -rlE "\b(HistoryState|HistoryEntry|emptyHistory|pushHistory)\b" src tests` 除本波删除处外为 0 则删除；文件只剩 re-export 时，把四个 importer（`authoring/editorTransaction.ts`、`authoring/resourceAwareAuthoringHistory.ts`、`course/slideEditorCommands.ts`、`course/v9MediaAudioCommands.ts`）改为直接从 `courseResourceState.ts` import，并删除 `history.ts` |
| 读 `useEditorStore.getState().history` 的三份测试 | `tests/integration/componentPackageReplacementRace.test.tsx:319`、`tests/integration/courseComponentPackageReplacementVerticalSlice.test.ts:400`、`tests/integration/courseInteractionAuthoringVerticalSlice.test.ts:131`、`:336–354`、`:505–523` | 改为断言活动 Surface 会话 `history.past.length` 与 `history.future.length` 不变（或 `selectCanUndoActiveSurface` / `selectCanRedoActiveSurface`）；断言数量与语义不得减少 |
| `EditorState.assetFiles`、`CourseResourceState.assetFiles`（`courseResourceState.ts:40`、`:276`、`:382`、`:396`）、`kernel.commitResources` 的 Pick 项、`selectMediaAssetFiles` 的回退（`editorStore.ts:2222–2227`）、root 初始化 `:1837` | 见左 | 删除镜像；`selectMediaAssetFiles` 无会话时返回 `EMPTY_CANDIDATE_ASSET_FILES`。**保留** `HistoryResourceState.assetFiles`（`courseResourceState.ts:30`）与 `applyHistoryResourceChanges` 内的 `state.assetFiles`（`:202`），它们是事务结果，不是镜像 |
| root re-export | `editorStore.ts:1198–1202` | 删除；如出现 importer 则改从 owner import（当前 src/tests 为 0） |
| `activeCourseDocument` 局部函数 | `:1362–1367` | 删除，调用处改 `selectActiveCourseProjectDocument` |
| `commitTeacherControllerAuthoringFrame` import | `:149` | 删除（根内零使用） |
| ratchet 钉住 history 镜像的断言 | `tests/unit/architectureDependencyRatchet.test.ts:638–642` | 删除这五行；这是本波允许的唯一门测试改动 |

允许新建：无。结构事实：`grep -c "textEditSession" src/renderer/store/editorStore.ts` 为 0；`grep -cE "\bHistoryState\b" src/renderer/store/editorStore.ts src/renderer/store/editorStoreKernel.ts` 均为 0；`grep -c "assetFiles" src/renderer/store/editorStore.ts` 为 0；`grep -cE "^export \{[^}]*\} from" src/renderer/store/editorStore.ts` 为 0。Focused：`npx vitest run tests/unit/editorStore.test.ts tests/unit/crossSurfaceResourceHistory.test.ts tests/integration/mixedCrossSurfaceHistory.test.tsx tests/integration/componentPackageReplacementRace.test.tsx tests/integration/courseComponentPackageReplacementVerticalSlice.test.ts tests/integration/courseInteractionAuthoringVerticalSlice.test.ts tests/unit/architectureDependencyRatchet.test.ts tests/unit/readModelBoundary.test.ts` 与 `npm run typecheck`。

### W2 结果类型归位

每个类型只允许一个定义位置；root 以 type-only import 引用它们来合成 `EditorState`，不再定义，不 re-export。importer 用 `grep -rlE "\bTYPE\b" src tests --include="*.ts" --include="*.tsx"` 全部列出后逐个改指向 owner。

| 类型（当前均定义在 `editorStore.ts`） | 去向 | 已知 importer |
|---|---|---|
| `SpatialGraphSelection`（`:578–580`） | 删除 root 定义，改 import `./slices/spatialAuthoringSlice` 已有的同名导出 | `crossSurfaceCommands.ts` 已从 slice import |
| `AlignmentMode`（`:634`） | 删除 root 定义，改 import `./slices/slideOwnedCommands` 已有的同名导出 | — |
| `SidebarTab`、`EditorMode`、`EditingScope`、`CanvasMode`、`TextEditSource`（`:624–635`） | `src/renderer/store/slices/editorShellSlice.ts`（`SidebarTab` 与已有 `EditorShellTab` 若相同则合并为一个名字） | UI tabs |
| `SimpleEntranceAnimationConfig`（`:637–642`） | `src/renderer/course/v9SlideContentCommands.ts` | `SimpleEntranceAnimationEditor.tsx` |
| `ImportedAssetBatchItem`、`ProjectAudioSettingsPatch`、`ImageReplacementCommitResult`、`MediaLibraryImportCommitResult`（`:673–712`） | `src/renderer/media/commitCourseMediaAuthoring.ts` | `MediaTab.tsx` |
| `CourseProjectRevisionTarget`（`:697–700`） | `src/renderer/authoring/courseAuthoringSession.ts` | media、components |
| `ComponentPackageReplacementTarget`、`ComponentPackageReplacementCommitResult`（`:714–728`） | `src/renderer/components/commitComponentPackageAuthoring.ts` | `tests/integration/componentPackageReplacementRace.test.tsx` |
| `RuntimeAssetReplacementCommitResult`、`RuntimeSourceAuthoringCommitResult`、`RuntimeContentTextAuthoringCommitResult`、`RuntimePropertyAuthoringCommitResult`、`RuntimeTemplateCreationCommitResult`（`:730–788`） | `src/renderer/runtime/commitRuntimeAuthoring.ts` | `DeveloperTab.tsx` |
| `InteractionAuthoringCommitResult`（`:790–800`） | `src/renderer/interactions/commitInteractionAuthoring.ts` | — |
| `CourseProjectPersistenceSnapshot`、`CourseProjectPersistenceToken`、`PrepareCourseProjectPersistenceResult`、`CaptureCourseProjectRecoveryResult`（`:802–833`） | `src/renderer/store/slices/courseLifecycleSlice.ts` | `crossSurfaceCommands.ts`（type import）、`tests/unit/courseDraftPersistence.test.ts` |

允许新建：无。结构事实：`grep -cE "^export (type|interface) (SpatialGraphSelection|AlignmentMode|SidebarTab|EditorMode|EditingScope|CanvasMode|TextEditSource|SimpleEntranceAnimationConfig|ImportedAssetBatchItem|ProjectAudioSettingsPatch|ImageReplacementCommitResult|MediaLibraryImportCommitResult|CourseProjectRevisionTarget|ComponentPackageReplacementTarget|ComponentPackageReplacementCommitResult|RuntimeAssetReplacementCommitResult|RuntimeSourceAuthoringCommitResult|RuntimeContentTextAuthoringCommitResult|RuntimePropertyAuthoringCommitResult|RuntimeTemplateCreationCommitResult|InteractionAuthoringCommitResult|CourseProjectPersistenceSnapshot|CourseProjectPersistenceToken|PrepareCourseProjectPersistenceResult|CaptureCourseProjectRecoveryResult)\b" src/renderer/store/editorStore.ts` 为 0。Focused：`npx vitest run tests/unit/editorStore.test.ts tests/unit/architectureDependencyRatchet.test.ts tests/unit/readModelBoundary.test.ts tests/unit/developerMode.test.tsx tests/unit/mediaTab.test.tsx` 与 `npm run typecheck`。

### W3 Surface apply/persist 包装归 slice

root 工厂内的这些函数搬进对应 slice 工厂并成为其返回成员；slice 通过 `kernel.readResources`、`kernel.readDirty`、`kernel.readAuthoringSession`、`kernel.writeAuthoringSession` 取得原来从完整 `current` 读取的数据；slice port 类型删除 `persist` 与 `applyBackend` 成员；`*PersistSnapshotFrom(owned, current, dirty, session)` 的第二个参数改为 `CourseResourceState`。

| root 函数（`editorStore.ts`） | 去向 |
|---|---|
| `applyV9Backend`（`:1210–1235`）、`persistCandidateResult`（`:1237–1258`）、`persistLayerCommand`（`:1595–1608`）、`persistMediaResult`（`:1610–1634`） | `slideAuthoringSlice.ts` 的 `applyBackend`、`persist`、`persistLayerCommand`、`persistMediaResult` |
| `applySpatialBackend`（`:1319–1339`）、`persistSpatialResult`（`:1260–1282`）、`persistSpatialLayerCommand`（`:1284–1317`） | `spatialAuthoringSlice.ts` 的 `applyBackend`、`persist`、`persistLayerCommand` |
| `applyFlowBackend`（`:1573–1593`）、`persistFlowResult`（`:1341–1360`）、`persistFlowLayerCommand`（`:1536–1571`） | `flowAuthoringSlice.ts` 的 `applyBackend`、`persist`、`persistLayerCommand` |

`crossSurfaceCommands` 的 `slide/flow/spatial.persist`、`applyBackend` 与 `persistLayer.*` ports、`courseLifecycleSlice` 的 `applySlide/applyFlow/applySpatial` ports 改为引用 slice 返回的成员；root 只传 `{ read, patch }`。允许新建：无。结构事实：`grep -cE "const (applyV9Backend|applySpatialBackend|applyFlowBackend|persistCandidateResult|persistSpatialResult|persistFlowResult|persistLayerCommand|persistSpatialLayerCommand|persistFlowLayerCommand|persistMediaResult) =" src/renderer/store/editorStore.ts` 为 0。Focused：`npx vitest run tests/unit/editorStore.test.ts tests/unit/crossSurfaceResourceHistory.test.ts tests/integration/mixedCrossSurfaceHistory.test.tsx tests/integration/architectureBaselineFlows.test.tsx tests/unit/v9SlideProductIntegration.test.tsx tests/unit/flowProductIntegration.test.tsx tests/unit/spatialProductIntegration.test.tsx tests/unit/architectureDependencyRatchet.test.ts tests/unit/readModelBoundary.test.ts` 与 `npm run typecheck`。

### W4 拆除 FeatureAuthoringPorts

1. `EditorStoreKernel` 与 `EditorStoreKernelHost` 新增 `persistDocument(document, extra?)` 与 `persistTransaction(step, statusMessage): boolean`；root 在 kernel host 里用 `dispatchActiveSurface(detect(), { slide: slide.persistDocument, flow: flow.persistDocument, spatial: spatial.persistDocument, sessionless: ... })` 实现（分派表是接线）。三份 slice 各新增 `persistDocument`（体来自 `featurePorts.persistProject` `:1479–1508` 对应分支）与 `persistTransactionStep`（体来自 `persistProjectResourceTransaction` `:1369–1433` 对应分支）。
2. 四个 Feature 文件各自声明自己的 ports 类型，成员集合必须**恰好等于**该文件 `grep -oE "ports\.[a-zA-Z]+" FILE | sort -u` 的结果；`read()` 大包拆成单一职责读取：

| Feature 文件 | ports 成员（新类型名） |
|---|---|
| `src/renderer/runtime/commitRuntimeAuthoring.ts`（`RuntimeAuthoringPorts`） | `tryReadDocument`、`readAuthoringSession`、`readSlideAuthoringContext(): { editingScope; activeSceneId; projection; hasSlideSession; sidecar }`、`persistTransaction`、`persistDocument`、`persistSlideCommand`、`setFeedback` |
| `src/renderer/interactions/commitInteractionAuthoring.ts`（`InteractionAuthoringPorts`） | `tryReadDocument`、`readInteractionTarget(): { locationId; stateId }`、`persistSlideCommand`、`persistTransaction`、`persistDocument`、`setFeedback` |
| `src/renderer/components/commitComponentPackageAuthoring.ts`（`ComponentAuthoringPorts`） | `tryReadDocument`、`readComponentPackages`、`readSurfaceSessions(): { hasSlideSession; hasFlowSession; hasSpatialSession; editingScope; interactionStateId }`、`readSpatialSession`、`readFlowSession`、`persistDocument`、`persistTransaction`、`persistSlideCommand`、`persistSpatial`、`persistFlow`、`setFeedback`、`setActiveTab` |
| `src/renderer/media/commitCourseMediaAuthoring.ts`（`MediaAuthoringPorts`，替代 `ImageAuthoringPorts`） | `tryReadDocument`、`readAuthoringSession`、`readSidecar`、`readComponentPackages`、`readProjection`、`readSurfaceSessions`、`readSlideSession`、`readSpatialSession`、`readFlowSession`、`persistMedia`、`persistCandidateResult`、`persistSpatial`、`persistFlow`、`persistTransaction`、`setFeedback` |

3. 删除 `src/renderer/authoring/featureAuthoringPorts.ts`、root 的 `featurePorts`（`:1435–1530`）与 `persistProjectResourceTransaction`（`:1369–1433`）；root 用 kernel 与 slice 成员拼四个字面量对象传给四个 `create*AuthoringActions`。
4. `tests/unit/architectureDependencyRatchet.test.ts:196` 钉住 `persistCandidateResult({` 出现在 `commitCourseImageReplacement` 内，保留该成员名即无需改门。

允许新建：四个 ports 类型（在各自 Feature 文件内）。结构事实：`grep -rc "FeatureAuthoringPorts" src` 全部为 0；`grep -rc "FeatureAuthoringContext" src` 全部为 0；四个文件各自 `grep -oE "ports\.[a-zA-Z]+" FILE | sort -u` 的集合与类型成员一致（粘贴两者）。Focused：`npx vitest run tests/integration/courseMediaLibraryImportVerticalSlice.test.ts tests/integration/imageReplacementVerticalSlice.test.ts tests/integration/courseComponentPackageReplacementVerticalSlice.test.ts tests/integration/courseInteractionAuthoringVerticalSlice.test.ts tests/integration/courseRuntimeAssetReplacementVerticalSlice.test.ts tests/integration/runtimePropertyAuthoringVerticalSlice.test.tsx tests/integration/runtimeContentTextAuthoringVerticalSlice.test.tsx tests/integration/courseRuntimeSourceAuthoringVerticalSlice.test.tsx tests/unit/architectureDependencyRatchet.test.ts tests/unit/readModelBoundary.test.ts` 与 `npm run typecheck`。

### W5 crossSurfaceCommands 收窄与 courseStructureSlice

完成后 `crossSurfaceCommands.ts` 只剩 `createCrossSurfaceCommands`，其中每个方法只做分派，不超过十行，不含任何 Surface/lifecycle 实现。

| 当前方法或 helper（`crossSurfaceCommands.ts`） | 实现体去向 |
|---|---|
| `persistCourseProjectCommand`（`:426–469`）、`addCourseContent`（`:720–769`）、`addScene`（`:771–780`）、`reorderCourseSurfaces`（`:782–789`）、`deleteCourseSurface`（`:791–813`）、`moveCourseSlideScene`（`:815–829`） | 新建 `src/renderer/store/slices/courseStructureSlice.ts`；方法返回 `{ ok, activatedLocationId? }`，位置激活由 crossSurface 的同名分派方法调用 `activateCourseLocation` 完成；持久化经 `kernel.persistDocument` |
| `deleteScene`（`:1580–1657`） | `slideAuthoringSlice.ts` 的 `deleteScene(sceneId)`；其中"最后一个场景则删除位置"的分支调用 structure slice 的 `deleteLocation(locationId)` |
| `setSpatialGraphSelection`（`:573–598`） | `spatialAuthoringSlice.ts` 的 `setGraphSelection(selection)` |
| `setActiveScene` 的 flow 分支（`:834–847`） | `flowAuthoringSlice.ts` 的 `activateBlockLocation(locationId)` |
| `updateGlobalLayerSettings`（`:1018–1074`）、`reorderNodes`（`:1091–1122`）、`moveCandidateLayerOwner`（`:1171–1214`）、`setCandidateGlobalLayerLocationVisibility`（`:1216–1255`）、`setCandidateGlobalLayerVisibleAtLocation`（`:1257–1293`）的 spatial 与 flow 分支体 | `spatialAuthoringSlice.ts` 与 `flowAuthoringSlice.ts` 的同名方法（slide 已在 `slideOwnedCommands.ts`） |
| `routeEditorAction` 的 slide/flow/spatial adapter 体（`:1436–1522`）与 global 分支（`:1523–1569`） | 各 slice 的 `executeRoutedDelete(live)`；global 分支按活动会话分派到对应 slice |
| `createLiveEditorSelectionSnapshot` 中按 Surface 推导 `focusKind` 的分支（`:1366–1392`） | 各 slice 的 `readActionFocus(focus)`；router 只组装 snapshot |
| `exportV9SlideCandidateArchive`（`:1295–1304`）、`reopenV9SlideCandidateArchive`（`:1306–1337`） | `courseLifecycleSlice.ts` |
| `prepareCourseProjectPersistence`（`:1659–1722`）、`captureCourseProjectRecoverySnapshot`（`:1724–1743`）、`acknowledgeCourseProjectSaved`（`:1745–1763`）与 helper `materializeActiveDrafts`（`:318–364`）、`snapshotPersistence`（`:292–301`）、`applyNativeTextDraftToDocument`（`:303–316`）、`openFlowAuthoringSessionAtLocation`（`:275–290`） | `courseLifecycleSlice.ts`；各 slice 提供 `commitDraftForPersistence(): { ok: true } | { ok: false; reason: string }` 与 `materializeDraft(document)`，lifecycle 只组合 |

留在 router 的方法白名单：`setCanvasMode`、`setEditingScope`、`activateCourseLocation`、`setActiveScene`、`undo`、`redo`、`setEditingTextNode`、`beginTextEdit`、`updateTextEditDraft`、`commitTextEdit`、`cancelTextEdit`、`renameProject`、`addTextNode`、`addFormulaNode`、`addRectangleNode`、`addShapeNode`、`selectNode`、`selectNodes`、`updateNodes`、`updateNode`、`copySelectedNodes`、`pasteNodes`、`deleteNode`、`deleteSelectedNodes`、`duplicateSelectedNodes`、`duplicateNode`、`ensureTeacherController`、`commitSlideCandidateTextRunStyle`、`createLiveEditorSelectionSnapshot`、`routeEditorAction`，以及上表中改为纯分派的同名方法。`CrossSurfaceCommandPorts` 删除因此不再使用的 `persistLayer`、`readProjection`、`readResources`、`lifecycle` 成员。

允许新建：`src/renderer/store/slices/courseStructureSlice.ts`；若 ratchet 的 Store 模块清单（`architectureDependencyRatchet.test.ts:526–528`、`:569–573`、`:660–669`）需要加入该路径，只允许追加路径，不改其他断言。结构事实：`grep -cE "structuredClone|commitSlideProjectMutation|commitSlideAuthoringHistory|commitSpatialAuthoringHistory|openCourseProjectArchiveBytes|exportCourseProjectArchiveBytes|courseProjectDocumentSchema|deleteEffectiveLayerItems|setGlobalLayerScenePlane|reorderEffectiveLayerItems|moveEffectiveLayerOwner|setGlobalLayerLocationVisibility|setGlobalLayerVisibleAtLocation|materializeActiveDrafts|snapshotPersistence" src/renderer/composition/crossSurfaceCommands.ts` 为 0；`wc -l src/renderer/composition/crossSurfaceCommands.ts` 粘贴（只作记录，不设阈值）。Focused：`npx vitest run tests/unit/editorStore.test.ts tests/unit/editorActionRouting.test.ts tests/integration/mixedCrossSurfaceHistory.test.tsx tests/integration/architectureBaselineFlows.test.tsx tests/unit/courseDraftPersistence.test.ts tests/integration/draftSaveTransaction.test.tsx tests/unit/v9SlideProductIntegration.test.tsx tests/unit/flowProductIntegration.test.tsx tests/unit/spatialProductIntegration.test.tsx tests/unit/globalLayerUi.test.tsx tests/unit/architectureDependencyRatchet.test.ts tests/unit/readModelBoundary.test.ts` 与 `npm run typecheck`。

### W6 教师控制器模块级绑定删除

| 位置 | 动作 |
|---|---|
| `src/renderer/authoring/v9TeacherControllerAuthoring.ts:105–120` | 删除 `boundTeacherControllerAuthoringPorts`、`bindTeacherControllerAuthoringPorts`、`resolveTeacherControllerAuthoringPorts` |
| 同文件 `createV9TeacherControllerAuthoringController(ports?)`（`:512`）与 `resolveTeacherControllerAuthoringKind(ports?)`（`:754`） | `ports` 改为必填；内部 `activePorts()` 与 `resolveTeacherControllerAuthoringPorts(ports)` 改为直接使用 `ports` |
| `editorStore.ts:119` import 与 `:1734–1737` 的 bind 调用 | 删除 |
| `src/renderer/ui/workspaces/SlideLocationWorkspace.tsx:684` | 已传 ports；只核对形状为 `{ readBackend, commit }` |
| `tests/unit/teacherControllerAuthoringBounds.test.ts:166`、`tests/unit/teacherControllerAuthoringOwnership.test.tsx:196`、`tests/unit/teacherControllerRuntimeSession.test.ts`（无参调用与 `resolveTeacherControllerAuthoringKind`） | 改为显式传入 `{ readBackend: () => selectSlideAuthoringBackend(useEditorStore.getState()), commit: (run) => useEditorStore.getState().applySlideCandidateCommand(run) }` |

允许新建：无。结构事实：`grep -rcE "bindTeacherControllerAuthoringPorts|boundTeacherControllerAuthoringPorts|resolveTeacherControllerAuthoringPorts" src tests` 全部为 0；`grep -cE "^let [A-Za-z]+.*=\s*null" src/renderer/authoring/v9TeacherControllerAuthoring.ts` 为 0；`grep -c "v9TeacherControllerAuthoring" src/renderer/store/editorStore.ts` 为 0。Focused：`npx vitest run tests/unit/teacherControllerAuthoringBounds.test.ts tests/unit/teacherControllerAuthoringOwnership.test.tsx tests/unit/teacherControllerRuntimeSession.test.ts tests/unit/teacherControllerConsistency.test.ts tests/unit/v9SlideProductIntegration.test.tsx tests/unit/architectureDependencyRatchet.test.ts tests/unit/readModelBoundary.test.ts` 与 `npm run typecheck`。

### W7 画布投影归 course owner

新建 `src/renderer/course/editorCanvasProjection.ts`，接收 root 的：`SlideCandidateUiProjection`（`:507–511`）、`isV9SlideTextContentDraft`（`:513–517`）、`courseRuntimeToDocument`（`:519–538`）、`firstRuntimeItem`（`:540–542`）、`attachProjectedRuntimes`（`:544–566`）、`spatialEditingNodes`（`:582–612`）、`flowEditingNodes`（`:614–622`）、`editingNodes`（`:1165–1171`），以及带模块级缓存的 `slideAuthoringUiFromState`（`:1880–1953`）、`spatialEditingNodesFromState`（`:1955–1972`）、`flowEditingNodesFromState`（`:1974–1992`）、`syntheticActiveScene`（`:1994–2028`）与 `selectEffectiveLayerProjection` 的缓存和函数体（`:2130–2213`）。迁入后它们只接受 `Pick` 窄输入（slide：`slideBackend`、`slideCandidateSnapshot`、`v9ContentEdit`；spatial：`spatialSession`、`spatialContentEdit`；flow：`flowSession`），不 import `useEditorStore`，只允许 type import `store/slideBackendPort` 等类型。root 的 `selectActiveScene`、`selectSlideSceneList`、`selectEditingNodes`、`selectSelectedNode`、`selectSelectedNodes`、`selectEffectiveLayerProjection` 变为单行委托；`buildCandidateEffectiveLayers` 包装（`:568–576`）删除，改直接用 `activeSurfaceProjection.ts` 已有的同名导出。

ratchet `tests/unit/architectureDependencyRatchet.test.ts:79` 以 `'\nlet cachedSlideUiPresent'` 作为工厂切片的结束锚点；缓存迁走后该锚点消失，只允许把它改为工厂结束后紧接的下一行文本（如 `'\nexport const selectActiveScene'`），不改任何断言。

允许新建：`src/renderer/course/editorCanvasProjection.ts`。结构事实：`grep -cE "^(let|const) cached[A-Za-z]+" src/renderer/store/editorStore.ts` 为 0；`grep -cE "function (spatialEditingNodes|flowEditingNodes|attachProjectedRuntimes|courseRuntimeToDocument|slideAuthoringUiFromState|syntheticActiveScene|editingNodes)\b" src/renderer/store/editorStore.ts` 为 0；`grep -cE "useEditorStore|from '\.\./store/editorStore'" src/renderer/course/editorCanvasProjection.ts` 为 0。Focused：`npx vitest run tests/unit/editorStore.test.ts tests/unit/v9SlideViewportAdapter.test.ts tests/unit/sceneThumbnailComposition.test.ts tests/unit/v9SlideProductIntegration.test.tsx tests/unit/spatialProductIntegration.test.tsx tests/unit/flowProductIntegration.test.tsx tests/unit/globalLayerUi.test.tsx tests/unit/architectureDependencyRatchet.test.ts tests/unit/readModelBoundary.test.ts` 与 `npm run typecheck`。

### W8 EditorState 类型合成与根收口

范围固定，符号表在 W7 复查通过后由 Integrator 补齐：`EditorState` 改为各 owner 拥有的 state 类型与 `ReturnType<typeof create*Slice>` / `ReturnType<typeof create*AuthoringActions>` / `ReturnType<typeof createCrossSurfaceCommands>` 的交叉类型，删除 `:835–1160` 的手写扁平接口；root 工厂只剩 kernel host、slice 工厂调用、`persistDocument`/`persistTransaction` 分派表、初始状态与 return 展开；import 只剩 owner 的工厂与类型；`FEATURE_CONSUMER_OWNER_LEDGER.md` 的 raw Store baseline 重算且不高于 21。结构事实（届时写入卡）：`grep -cE "produce\(|structuredClone\(" src/renderer/store/editorStore.ts` 为 0；`grep -cE "^import" src/renderer/store/editorStore.ts` 严格低于 W7 结束时记录的数值。

### W9 根级 selection/navigation 镜像

范围固定，符号表在 W8 复查通过后由 Integrator 补齐：`activeSceneId`、`activePresentationStateId`、`selectedNodeId`、`selectedNodeIds`、`editingScope` 五个根字段与 `kernel.readSelection`/`syncSelection` 改为从活动 owner 会话派生的命名 selector；HEAD 上有 23 个 src 文件与 33 个测试文件读取这些字段，届时重新计数并可按 consumer 组拆成多张卡。本节点的 Acceptance 在 W9 完成前不成立。

## Write scope

按波：每张执行卡只列该波表中的文件，加上因该波签名变化而编译失败的直接 consumer；`architectureDependencyRatchet.test.ts` 与 `readModelBoundary.test.ts` 只允许各波明确写出的行号或锚点改动。禁止修改 V9/Published wire、Main/Preload、格式 producer、共享 Legacy inventory，禁止新建第二 Store/Session/History、任何 `*Ports` 汇总 Facade 或 `features/`、`services/` 目录。

## Execution

1. 每波开工前，对该波表中每个符号运行 `grep -nE "\bSYMBOL\b" FILE` 确认仍在原位；任一缺失即停止。
2. 严格按表搬运：新位置写入、旧位置删除、调用方改指向，三者在同一提交完成；不留包装、不留 `export ... from`。
3. 每波结束运行该波 Focused 命令与结构事实命令，按指南第 6 节交接，等待复查；不自动开始下一波。
4. W8、W9 只有在 Integrator 补齐符号表并签卡后才可开始。

## Stop conditions

- 需要新增第二 Store/Session/History、兼容双写、完整 Store Facade 或万能 Surface service。
- 新 slice/use case 需要完整 `EditorState`、raw root `get/set` 或 import `useEditorStore` 才能工作。
- 任一中间提交会破坏保存重开、Undo/Redo、Surface、Preview/Player、Runtime/Component 或导出。
- 表中符号与当前代码不符，或需要卡外新名字。

## Acceptance

- `editorStore.ts` 是唯一 Zustand composition root：无 `produce`/document mutation、Feature planner/message、格式调用或 Surface 业务实现；不 import `ui/**`；factory 内外都只实例化与接线。
- `crossSurfaceCommands` 只有 W5 白名单的分派职责；`FeatureAuthoringPorts` 式宽 Facade 与 module-global bind 为零。
- 固定模块各自拥有 state/actions；slice/use case 不 import root Store、完整 Store 类型或其他 owner 深层实现。
- 根级 `history`/`assetFiles`/`textEditSession` 镜像与根级 selection/navigation 镜像无定义、无 consumer；唯一 document+resource History 保持。
- `editorStore.ts` 与 `v9TeacherControllerAuthoring.ts` 之间无运行时环，无新增 runtime SCC、Core→Feature、Player→Store 或 contract→renderer 依赖。
- raw Store direct consumer 数量不高于 `FEATURE_CONSUMER_OWNER_LEDGER.md` 记录的 21，且只剩 composition/UI adapter 白名单。
- Slide/Flow/Spatial/Mixed、保存/Recovery、Undo/Redo、Preview/Player、Runtime/Component 和全部适用导出不降级；sessionless fail-loud。
- 九波交接齐全；本节点的 focused architecture checks 只标记 037 退出，不替代 r11-055 最终门。

## Focused validation

- `npx vitest run tests/unit/editorStore.test.ts tests/unit/crossSurfaceResourceHistory.test.ts tests/unit/architectureDependencyRatchet.test.ts tests/unit/readModelBoundary.test.ts`
- `npx vitest run tests/integration/mixedCrossSurfaceHistory.test.tsx tests/integration/architectureBaselineFlows.test.tsx`
- `npm run typecheck`
- `npm run test:product`（只在 W9 结束时运行一次）

## Rollback / handoff

以单波提交为回滚点；不能恢复已删除的旧 writer 或保留新旧 slice 双写。每波交接按指南第 6 节格式，并写明下一波编号；Integrator 复查通过后签发下一张卡。
