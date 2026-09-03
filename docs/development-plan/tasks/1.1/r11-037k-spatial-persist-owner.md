# r11-037k-spatial-persist-owner 把 Spatial persist 逻辑下沉收敛至 spatialAuthoringSlice

- Status / Owner: queued /
- Outcome / Evidence: 把 applySpatialBackend、persistSpatialResult、persistSpatialLayerCommand 迁入 spatialAuthoringSlice，并保留资源 Undo/Redo generation 行为。
- Write scope: `src/renderer/store/editorStore.ts`、`src/renderer/store/slices/spatialAuthoringSlice.ts`、`src/renderer/composition/crossSurfaceCommands.ts`、`src/renderer/store/slices/courseLifecycleSlice.ts`
- Write locks: none
- Acceptance: Spatial persist 逻辑完全收敛在 spatialAuthoringSlice；root 无冗余闭包；目标测试通过。
- Validation: `npx vitest run tests/unit/spatialProductIntegration.test.tsx tests/integration/mixedCrossSurfaceHistory.test.tsx` 与 `npm run typecheck`。
