# repair-ui-01-slide-surface-owner-selection 修复 Slide Surface 共享层选择

- Status / Owner: queued /
- Risk / Hotspot: S1 / editor-store-history
- Outcome / Why now: Slide NodesTab 能显示 `surfaceLayerItems`，但 `editorStore.ts:11173-11179` 把所有非 global owner 折叠为 scene，导致选择后 Properties/canvas 丢失目标。
- Write scope / Baseline: baseline `b967c96`; `src/renderer/store/editorStore.ts` 中有效图层选择适配、必要的 Slide/effective-layer helper 与直接 unit/integration tests；不得改 V9 Schema、Flow/Spatial 命令或 Published producer。
- Acceptance: global/surface/scene row 各自保持正确 owner token；选择 surface row 后 Properties 与画布解析同一稳定 `authoringAddress`；一次属性修改只产生一次 canonical V9 提交且 undo 后恢复。
- Focused validation: `npx vitest run tests/unit/effectiveLayerProjection.test.ts tests/unit/effectiveLayerCommands.test.ts tests/unit/editorStore.test.ts`。
