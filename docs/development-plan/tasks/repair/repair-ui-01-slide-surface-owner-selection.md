# repair-ui-01-slide-surface-owner-selection 修复 Slide Surface 共享层选择

- Status / Owner: queued /
- Risk / Hotspot: S2 / editor-store-history
- Outcome / Why now: 已合入修复只让 Slide backend 进入 surface scope；候选投影与 Store 恢复仍把 surface owner 折叠为 scene，且命名状态下 surface target 携带 `stateId` 后被属性命令拒绝，原卡的 Properties 写入与 undo 验收仍未满足。
- Write scope / Baseline: baseline `3780090`; `src/renderer/store/editorStore.ts`、`src/renderer/authoring/courseAuthoringScope.ts`、`src/renderer/course/effectiveLayerProjection.ts`、`src/renderer/course/effectiveLayerCommands.ts`、必要的 `src/renderer/course/slideAuthoringBackend.ts` 与直接 tests；不得改 V9 Schema、Flow/Spatial 命令或 Published producer。
- Acceptance: global/surface/scene 的 backend、candidate projection 与 Store 恢复保持各自 owner token；surface token 保留独立于 owner 的当前 `stateId` 查看上下文，但 `owner=surface` 的属性命令始终写 surface 基础项，不得按 scene state override 处理或因 `stateId` 拒绝；Properties/canvas 解析同一稳定 `authoringAddress`，命名状态下一次属性手势只产生一次 canonical V9 commit，undo/redo 可恢复且 global/scene 不回归。
- Focused validation: `npx vitest run tests/unit/v9GlobalLayerUiAdapter.test.tsx tests/unit/effectiveLayerProjection.test.ts tests/unit/effectiveLayerCommands.test.ts tests/unit/editorStore.test.ts`；新增直接反例必须覆盖命名状态下 surface 属性写入与 history。
- S2 safety / rollback: 回滚起点 `3780090`；只使用 fixture/内存 history，不改 Schema 或用户文件；若修复需要扩散 `editingScope` 语义到未知 consumer，先保持 projection/Store owner 单一事实并由独立 Reviewer 复核 address/history 反例。
