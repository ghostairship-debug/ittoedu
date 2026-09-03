# r11-025-editor-store-v9-only｜Surface Store 清除 V8 镜像与旧 writer

- Release / Dependencies: 1.1 / r11-026-slide-properties-modules, r11-029-slide-workspace-modules
- Write locks: `editor-store-history`, `workspace-properties`
- Inventory access: read
- Preservation: PM-01, PM-03–PM-18, PM-25–PM-27

## Outcome / current evidence

在 Properties、Flow、Spatial 与 Slide Workspace consumer 已经迁出后，删除 `slideCandidateUi`、Surface 旧 selection/projection cache、旧 clipboard/history mirror 及零 consumer helper；活动 V9 session/document、Surface selection、draft 和 runtime session 保持。仍被 App/Player cutover 使用的 `EditorState.project`、`projectCandidatePreviewDocument` 最后残余只允许登记给 r11-037，不在本节点提前删功能或保留新旧双写。

## Read first

- `src/renderer/store/editorStore.ts`
- `src/renderer/store/slideEditorProjection.ts`
- `src/renderer/store/history.ts`
- `src/renderer/App.tsx`
- `src/renderer/authoring/courseAuthoringSession.ts`
- `docs/development-plan/inventories/legacy-consumers.json`（LEG-001）

## Exact targets

| Delete target | Required replacement already present | Must remain |
|---|---|---|
| `slideCandidateUi` | r11-020 effective read view | Slide hit/selection/thumbnail 稳定结果 |
| 旧 clipboard/history mirror 与 `v9HistoryToStoreHistory` | r11-022 V9 command/history | 一次操作一 History、资源 sidecar 历史 |
| `slideEditorProjection.ts` / `history.ts` 中零 consumer helper | 表中 replacement 的直接 API | 仍服务受支持行为的非 Legacy helper |
| `tests/unit/v9GlobalLayerUiAdapter.test.tsx#project` 中 LEG-001 Store projection consumer | 活动 V9 session、`selectActiveCourseProjectDocument` / 现有 V9 authoring selector | global layer owner/plane/order/visibility、selection、Undo/Redo 与保存重开断言原样保留 |
| `tests/unit/assetTransactions.test.ts#project` 中直接 `EditorState.project` 读取 | `selectActiveCourseProjectDocument`、`selectMediaAssetFiles` 与活动 V9 session/history | 媒体引用替换、孤立资源清理、audio/image/video 字节与 Undo/Redo 断言原样保留 |

## Write scope

只允许修改表中 Store/helper，以及 `tests/unit/v9SlideBackendSelection.test.ts`、`tests/unit/v9GlobalLayerUiAdapter.test.tsx`、`tests/unit/assetTransactions.test.ts`、`tests/integration/architectureBaselineFlows.test.tsx`、`tests/unit/crossSurfaceResourceHistory.test.ts`。测试迁移必须保留原行为断言；禁止修改共享 inventory、App delivery/lifecycle、创建第二 Store/Session/History、改变保存/恢复/导出语义或覆盖未提交用户修改。本节点只清除 Surface 旧镜像和旧 writer，不用搬文件冒充 r11-037 的 Owner 模块化，也不得为后续拆分保留兼容双写。

## Execution

1. 对表中每个 target 用 inventory 与静态/动态查询证明当前树 consumer 为零；任何仍位于 UI module 的非零 path#symbol 都必须退回 r11-026/r11-029，不能在 Store 中新增 adapter 掩盖。
2. 将 `v9GlobalLayerUiAdapter.test.tsx` 中 LEG-001 所指的 Store `project` 读取改为活动 V9 session 或现有 V9 selector；不要因局部变量同名而改写合法 `CourseProjectDocument` fixture，不得删除或改弱 global layer owner/plane/order/visibility、selection、Undo/Redo 和保存重开断言。
3. 将 `assetTransactions.test.ts` 中所有直接 `useEditorStore.getState().project` / `state.project` 断言改为 `selectActiveCourseProjectDocument` 与活动 V9 session/history，资源字节继续使用 `selectMediaAssetFiles`；媒体替换、引用清理、audio/image/video 和 Undo/Redo 行为断言数量与语义不得减少。
4. 按 slide cache → Surface projection helper → clipboard/history 的顺序删除；每组删除后立即运行直接目标测试。
5. 仍合理的 Asset/Component/App UI local state 使用现有正式窄类型，不塞进 `CourseProjectDocument`。
6. 验证 Save、dirty、Recovery、Preview/Export 读取同一份已提交 draft 的 V9 document；保存期间继续编辑仍保持 dirty。
7. 更新 read-model ratchet 与 Store tests；禁止 deprecated 双写。交接列出 LEG-001 预期减少的 endpoint、replacement 与精确查询，不修改共享 inventory。

## Stop conditions

- 任一待删 Surface target 仍被受支持 UI、fixture 或脚本消费。
- 删除会改变 draft/IME、dirty、Recovery、Undo 顺序、Surface selection 或导出结果。
- 需要新增 nullable session fallback、第二 history 或把 UI state 持久化进工程。

## Acceptance

- `EditorState` 不含 Surface V8 projection/cache 与旧 clipboard/history mirror；表中 helper consumer 为零。
- `tests/unit/v9GlobalLayerUiAdapter.test.tsx#project` 与 `tests/unit/assetTransactions.test.ts#project` 不再读取 `EditorState.project`，已使用活动 V9 selector/session；两文件原有 global-layer、资源事务、字节和 Undo/Redo 行为断言未删除、未更名规避、未改弱。
- Slide/Flow/Spatial/Mixed 及 Player/全部导出保持，sessionless fail-loud。
- 本节点负责的 LEG-001 Surface endpoint 为零且无第二 writer/selector truth；App/Preview 最后残余有精确 handoff，留给 r11-037 后由 r11-053 统一复核。
- Store 的 Surface 面已经纯 V9，且没有为 r11-037 预建第二 writer；后继可以拆 composition root 而不再处理 Surface V8 兼容语义。

## Focused validation

- `npx vitest run tests/unit/v9SlideBackendSelection.test.ts tests/unit/v9GlobalLayerUiAdapter.test.tsx tests/unit/assetTransactions.test.ts tests/integration/architectureBaselineFlows.test.tsx tests/unit/crossSurfaceResourceHistory.test.ts`
- `npm run typecheck`

## Rollback / handoff

只回滚首个失败 target 组及其 direct read 迁移；不得恢复其他已证明无 consumer 的 mirror。交接列出阻塞删除的精确 path#symbol、行为差异与 owner。
