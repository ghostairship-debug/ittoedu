# r11-037-editor-store-owner-modularization｜按 Owner 拆 Store 并清除最后旧工程真相

- Release / Dependencies: 1.1 / r11-025-editor-store-v9-only, r11-032-player-v2-only-entry, r11-034-app-project-lifecycle-module, r11-035-app-delivery-module, r11-036-app-import-input-modules
- Write locks: `editor-store-history`, `workspace-properties`
- Inventory access: `read`
- Preservation: PM-01–PM-18, PM-25–PM-27

## Outcome / current evidence

`editorStore.ts` 已由约 1.2 万行缩至约 2240 行，并形成 kernel、resource helpers、Surface slices 与若干 Feature owner；这些成果可保留。但 root 仍持有跨 Owner projection/persist/authoring 业务、完整 action surface 与根级镜像。本节点在全部外部 consumer 形成窄入口后完成真实 Owner 迁移：root 只实例化唯一 Zustand Store、组合 slice/ports 并导出受控 hook；完整 Store Facade、万能 Surface service、模块级 service locator 与 wrong-owner mirror 均消失。

## Integrator audit / reopened（2026-09-03）

此前 79 个产品回归已经修复，`npm run test:product` 当前为 275 files / 2147 tests 全绿；这证明现有 slices/owners 和行为修复应保留，但不证明结构完成。当前可复现反例是：

- `editorStore.ts` 在 factory 内外仍实现 Slide/Flow/Spatial projection、draft/Runtime 附着、backend apply、Surface persist、document+resource transaction 与 Feature feedback，并反向 import UI authoring 模块。
- `EditorState` 仍作为扁平完整 action surface 被跨域消费；根级 selection/navigation/history/resource mirror 尚存。
- `crossSurfaceCommands.ts` 除 undo/location/canvasMode/text-edit router 外，还实现项目结构、具体 Surface command、Archive reopen、草稿 materialize、save/recovery snapshot 与 ACK，已经成为万能 Surface service。
- `featureAuthoringPorts.ts` 汇总完整 document、sidecar、packages、三 Surface session/read/persist 和 writer，是换名后的完整 Store Facade。
- `workspaceSlideAuthoring.ts` / `v9TeacherControllerAuthoring.ts` 的模块级 mutable bind 构成 service locator，规避静态 SCC 但没有形成显式窄依赖；前者由 r11-029 清理，本节点只接收已验证 handoff 并负责后者。

返工必须保留已通过行为的 kernel、resource state、slices 与 Feature owner，只把 projection/read model、lifecycle/save/recovery、Feature use case 和具体 Surface writer 归还正式 Owner。不要恢复 `EditorState.project`，不要整体回滚到旧 Store，也不要用另一个宽 ports 对象替代它。重新进入前必须复核 r11-026/029 handoff、在其改动后重验 r11-025 evidence（失效才先执行 r11-025），并确认 r11-032/034–036 的源码、依赖、验证定义与输入闭包未变；闭包变化就先返回对应节点，不能借本规格吸收。

## Read first

- `src/renderer/store/editorStore.ts`（完整读取 state、actions、imports 与直接 exporters）
- `src/renderer/store/history.ts`
- `src/renderer/authoring/resourceAwareAuthoringHistory.ts`
- `src/renderer/authoring/editorTransaction.ts`
- `src/renderer/authoring/courseAuthoringSession.ts`
- `src/renderer/authoring/featureAuthoringPorts.ts`
- `src/renderer/authoring/v9TeacherControllerAuthoring.ts`
- `src/renderer/components/commitComponentPackageAuthoring.ts`
- `src/renderer/interactions/commitInteractionAuthoring.ts`
- `src/renderer/media/commitCourseMediaAuthoring.ts`
- `src/renderer/runtime/commitRuntimeAuthoring.ts`
- `docs/development-plan/inventories/FEATURE_CONSUMER_OWNER_LEDGER.md`
- `tests/unit/architectureDependencyRatchet.test.ts`

## Fixed module map

| Owner module | Own state/actions | Must not own |
|---|---|---|
| `src/renderer/store/editorStoreKernel.ts` | canonical document read、authoring identity、transaction commit、feedback 的窄 ports | UI、Surface selection、Feature planner、Zustand hook |
| `src/renderer/store/courseResourceState.ts` | asset/component sidecar bytes 与 resource delta/apply | `slideCandidateSidecar*` 名称、Surface selection |
| `src/renderer/store/slices/slideAuthoringSlice.ts` | Slide session/selection/draft 与 Slide action entry | Flow/Spatial state、App lifecycle、resource planner |
| `src/renderer/store/slices/flowAuthoringSlice.ts` | Flow session/selection/draft 与 Flow action entry | Slide/Spatial state、Flow view implementation |
| `src/renderer/store/slices/spatialAuthoringSlice.ts` | Spatial session/selection/session camera 与 Spatial action entry | persisted camera、Slide/Flow state |
| `src/renderer/store/slices/courseLifecycleSlice.ts` | active project identity、dirty/save/recovery status | archive IO/effect 实现、Preview/Export |
| `src/renderer/store/slices/editorShellSlice.ts` | tab/dialog/path/status 等 App UI state | document/resource/Surface writer |
| `src/renderer/composition/surfaceRouter.ts` | exactly-one active Surface session 的纯选择/切换计划 | UI component、Store hook、Surface command implementation |
| `src/renderer/composition/crossSurfaceCommands.ts` | 跨 Surface 分派（undo/location/canvasMode/text-edit router），只组合 slice 窄口 | 完整 `EditorState`、第三套 persist、Surface command 实现 |
| `editorStore.ts` | 唯一 Store 实例化、slice/port 接线、窄 selectors/hook export | planner、document mutation、Feature message、完整 action 实现 |

Feature 逻辑迁入已经存在的 `authoring/`、`media/`、`components/`、`runtime/`、`interactions/`、`course/` owner；只有没有合适现有 owner 且本节点列出时才新增文件，不创建统一 `features/` 或 `services/` 平台。合法窄 adapter 可以消费命名 selector、单一 owner view 与 typed command port；不得读取完整 `State` / document、调用 raw `getState/setState`、组合跨 owner mutation/persist、持有 module-global mutable bind，或返回可替代 Store 的宽对象。

## Write scope

只允许修改 `src/renderer/store/**`、`src/renderer/composition/surfaceRouter.ts`、`src/renderer/composition/crossSurfaceCommands.ts`、表中直接 authoring owner、`src/renderer/authoring/featureAuthoringPorts.ts`、`src/renderer/authoring/v9TeacherControllerAuthoring.ts`、`src/renderer/components/commitComponentPackageAuthoring.ts`、`src/renderer/interactions/commitInteractionAuthoring.ts`、`src/renderer/media/commitCourseMediaAuthoring.ts`、`src/renderer/runtime/commitRuntimeAuthoring.ts` 和因这些窄 port 变化而编译失败的直接 Store consumer；允许新增 Fixed module map 文件。`editorStore.ts` 的既有整文件 CRLF 噪声在本节点随实际修改清理。只允许更新：

- `tests/unit/editorStore.test.ts`
- `tests/unit/crossSurfaceResourceHistory.test.ts`
- `tests/integration/mixedCrossSurfaceHistory.test.tsx`
- `tests/integration/architectureBaselineFlows.test.tsx`
- `tests/unit/architectureDependencyRatchet.test.ts`
- `tests/unit/readModelBoundary.test.ts`
- 因删除 `EditorState.project` / `projectCandidatePreviewDocument` 而 typecheck 失败的直接 tests（只改读路径，不降断言）：`tests/unit/projectCandidatePreviewDocument.test.ts`（删除）、`tests/unit/v9SlideBackendSelection.test.ts`、`tests/unit/globalEditorStore.test.ts`、`tests/unit/simpleEditorMode.test.tsx`、`tests/unit/courseDraftPersistence.test.ts`、`tests/unit/batchMediaAndInsertion.test.ts`、`tests/unit/componentPackageManagement.test.tsx`、`tests/unit/componentCatalogReplacement.test.ts`、`tests/unit/spatialCanvasBackground.test.ts`、`tests/integration/imageReplacementVerticalSlice.test.ts`、`tests/integration/courseMediaLibraryImportVerticalSlice.test.ts`、`tests/integration/courseComponentPackageReplacementVerticalSlice.test.ts`、`tests/integration/courseInteractionAuthoringVerticalSlice.test.ts`、`tests/integration/courseRuntimeAssetReplacementVerticalSlice.test.ts`、`tests/integration/courseRuntimeSourceAuthoringVerticalSlice.test.tsx`、`tests/integration/runtimePropertyAuthoringVerticalSlice.test.tsx`、`tests/integration/runtimeContentTextAuthoringVerticalSlice.test.tsx`
- `tests/unit/developerMode.test.tsx`（只允许改 selector 路径；禁止删可编辑副本/校验断言）
- `tests/unit/editor10ForbiddenTokens.test.ts`（只允许从 `migrateProjectV8ToCourseProjectV9` 白名单去掉已无命中的 `editorStore.ts`）

禁止修改 V9/Published wire、Main/Preload、格式 producer、共享 Legacy inventory 或新建第二 Store/Session/History。

## Execution

1. 生成当前 state/action/import/direct-consumer 清单并按 Fixed module map 归属；一个 symbol 只能有一个 owner。无法归属或需要改变行为时停止，由 Integrator 更新规格。
2. 审计并复用现有 `editorStoreKernel`、`courseResourceState`、`editorTransaction` 与 `resourceAwareAuthoringHistory`；只把仍留在 root/history 的对应 symbol 移入唯一现有 owner，并在同一提交删除原 helper/writer。不得再创建同名或并行 kernel/resource 模块，禁止复制 History。
3. 依次审计现有 Slide → Flow → Spatial slice；只迁仍留在 root 的 owner state/action，consumer 同提交改用现有窄 selector/command，root 删除原字段/实现。slice factory 只接收自身 state 与 `EditorStoreKernel` 窄 port，不接收完整 `EditorState`、root `get/set` 或 `useEditorStore`；已迁 symbol 不重写、不复制。
4. 审计现有 course lifecycle 与 editor shell slice；只移动尚未归位的状态/commands，实际 IO/effect 继续由 r11-034 hook 持有。若 r11-034 closure 已变，先返回该节点，不在这里重建生命周期模块。
5. 审计并复用现有纯 `surfaceRouter`，只迁 root 尚存的路由 planner/Surface switch 并删除原实现；不得新建第二 router 或把 Workspace connector 责任吸入 Store。
6. 把 Runtime/Media/Component/Interaction/Global-Teacher 的 planner/use case 调用移到正式 owner。`v9TeacherControllerAuthoring.ts` 改为接收 target/read/commit 窄 port，删除对 `useEditorStore` 的 import，切断当前运行时 SCC。
7. 删除 `EditorState.project`、`projectCandidatePreviewDocument`、`derivedV8ProjectFromBackend`、`slideCandidateSidecar*` 和根级 selection/navigation/history/resource mirror；任何仍有 consumer 的字段立即停止，不用 nullable fallback。
8. `crossSurfaceCommands` 只保留 undo/location/canvasMode/text-edit 的跨 Surface 分派；具体 Surface command、project lifecycle、archive、materialize、persist、save/recovery/ACK 全部回到既有 owner。拆除汇总完整 document/session/writer 的 `FeatureAuthoringPorts`。
9. 删除 Store→UI import 和 `v9TeacherControllerAuthoring.ts` 的 module-global mutable bind/service locator；显式依赖只经窄 target/read/commit port 注入。`workspaceSlideAuthoring.ts` 的 bind 必须已由 r11-029 删除，本节点只验证而不修改该文件。
10. `editorStore.ts` 最终只保留 type composition、唯一 store creation、slice/port wiring 和窄 selectors/hook export；不得 re-export 所有 actions 或保留迁出实现的代理。
11. 每个 owner 迁移后先跑对应最近层行为测试，再继续下一 owner；最后更新依赖棘轮与 raw Store consumer baseline，只允许下降。这些结构检查只是本 Owner 的退出证据；r11-055 必须在其当前 gate invocation 的稳定源码、测试、helper 与 ledger 状态上独立重建并运行原子 gate。

## Stop conditions

- 需要新增第二 Store/Session/History、兼容双写、完整 Store Facade 或万能 Surface service。
- 新 slice/use case 需要完整 `EditorState`、raw root `get/set` 或 import `useEditorStore` 才能工作。
- 任一中间提交会破坏保存重开、Undo/Redo、Surface、Preview/Player、Runtime/Component 或导出。
- 迁出后原 root 仍保留同一 writer/planner，或新的依赖环出现。

## Acceptance

- `editorStore.ts` 是唯一 Zustand composition root：无 `produce`/document mutation、Feature planner/message、格式调用或 Surface 业务实现；原职责/imports/state/actions 实际消失。
- `editorStore.ts` 不 import `ui/**` 或具体 Surface/Feature command 实现；factory 内外都只实例化/接线。`crossSurfaceCommands` 只有固定窄 router 职责，`FeatureAuthoringPorts` 式宽 Facade 与 module-global bind 为零。
- 固定模块各自拥有 state/actions；slice/use case 不 import root Store、完整 Store 类型或其他 owner 深层实现。
- `EditorState.project`、preview projection、wrong-owner sidecar、根级 selection/navigation/history/resource mirror 无定义、无 consumer；唯一 document+resource History 保持。
- `editorStore.ts` ↔ `v9TeacherControllerAuthoring.ts` 运行时环为零，无新增 runtime SCC、Core→Feature、Player→Store 或 contract→renderer 依赖。
- raw Store direct consumer 数量严格低于本节点启动时写入 `FEATURE_CONSUMER_OWNER_LEDGER` 的可重现 baseline，且只剩 composition/UI adapter 白名单；没有完整 action re-export Facade，r11-055 必须独立复核该 ledger。
- 所有合法 adapter 只消费命名 selector、单 owner view 与 typed port；无完整 State/document、raw Store、跨 owner mutation/persist、module-global bind 或宽对象返回。
- Slide/Flow/Spatial/Mixed、保存/Recovery、Undo/Redo、Preview/Player、Runtime/Component 和全部适用导出不降级；sessionless fail-loud。
- `editorStore.ts` 无 CRLF/trailing-whitespace 噪声；本节点 focused architecture checks 仅标记 037 退出，不替代 r11-055 最终门。

## Focused validation

- `npx vitest run tests/unit/editorStore.test.ts tests/unit/crossSurfaceResourceHistory.test.ts tests/unit/architectureDependencyRatchet.test.ts tests/unit/readModelBoundary.test.ts`
- `npx vitest run tests/integration/mixedCrossSurfaceHistory.test.tsx tests/integration/architectureBaselineFlows.test.tsx`
- `npm run typecheck`
- `npm run test:product`

## Rollback / handoff

以单一 owner 迁移提交为回滚点；不能恢复已删除的 V8 writer 或保留新旧 slice 双写。交接按 Core/Slide/Flow/Spatial/App/Feature 列出完成项、剩余 direct consumer、ratchet 数量与首个失败行为。
