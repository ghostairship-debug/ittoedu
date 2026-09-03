# r11-025-editor-store-v9-only｜Surface Store 清除 V8 镜像与旧 writer

- Release / Dependencies: 1.1 / r11-026-slide-properties-modules, r11-029-slide-workspace-modules
- Write locks: `editor-store-history`, `workspace-properties`
- Inventory access: read
- Preservation: PM-01, PM-03–PM-18, PM-25–PM-27

## 2026-09-03 执行版（基于 HEAD bb1f848）

**裁决：本节点以证据闭合，不再派执行卡。** 原规格列出的全部删除目标在当前源码中已经为零，两个测试文件也不再读取 `EditorState.project`。原先与 r11-037 的"history 归属冲突"裁定如下：Store 根上的 `history: HistoryState` 计数镜像、`kernel.writeHistoryMirror` 与 `storeHistoryFromSessionLengths` 不属于本节点，统一由 r11-037 的 W1 删除；本节点不再改任何代码。通用规则见 [执行者指南](EXECUTION_GUIDE.md)。

## Outcome / current evidence

复查者在当前 HEAD 重跑下列命令即可确认闭合；每条都应得到 0 或通过：

- `grep -rc "slideCandidateUi" src/renderer` 所有文件为 0
- `grep -rc "v9HistoryToStoreHistory" src/renderer` 所有文件为 0
- `grep -rc "derivedV8ProjectFromBackend" src/renderer` 所有文件为 0
- `grep -rc "projectCandidatePreviewDocument" src/renderer` 所有文件为 0
- `grep -rc "slideCandidateSidecar" src/renderer` 所有文件为 0
- `grep -cE "getState\(\)\.project\b" tests/unit/v9GlobalLayerUiAdapter.test.tsx tests/unit/assetTransactions.test.ts` 两个文件均为 0
- `grep -cE "state\.project\b" tests/unit/v9GlobalLayerUiAdapter.test.tsx tests/unit/assetTransactions.test.ts` 两个文件均为 0

## Read first

无需阅读；本节点不产生代码改动。

## Exact targets

移交给 r11-037 W1 的残留（本节点不处理）：

| 残留 | 位置 | 去向 |
|---|---|---|
| `history: HistoryState` 计数镜像与其初始化 | `src/renderer/store/editorStore.ts:845`、`:1836` | r11-037 W1 删除 |
| `writeHistoryMirror`、`storeHistoryFromSessionLengths` 及三份 slice 对后者的调用 | `src/renderer/store/editorStoreKernel.ts`、`src/renderer/store/slices/*.ts` | r11-037 W1 删除 |
| 读取 `useEditorStore.getState().history` 的测试 | `tests/integration/componentPackageReplacementRace.test.tsx`、`tests/integration/courseComponentPackageReplacementVerticalSlice.test.ts`、`tests/integration/courseInteractionAuthoringVerticalSlice.test.ts` | r11-037 W1 改为断言活动 Surface 会话历史长度不变；断言数量与语义不得减少 |

## Write scope

无。

## Execution

无。

## Stop conditions

无。

## Acceptance

上文 Outcome 中的七条命令全部成立，且 Focused validation 通过。成立后本节点视为通过其 Acceptance；后继 r11-034、r11-035、r11-036 的依赖条件由此满足。

## Focused validation

- `npx vitest run tests/unit/v9SlideBackendSelection.test.ts tests/unit/v9GlobalLayerUiAdapter.test.tsx tests/unit/assetTransactions.test.ts tests/integration/architectureBaselineFlows.test.tsx tests/unit/crossSurfaceResourceHistory.test.ts`
- `npm run typecheck`

## Rollback / handoff

无代码改动，无回滚点。复查者确认后在交接中写明"r11-025 closed by evidence"。
