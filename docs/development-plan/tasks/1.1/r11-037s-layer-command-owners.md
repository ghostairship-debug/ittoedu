# r11-037s-layer-command-owners 全局图层命令实现迁回对应slice

- Status / Owner: queued /
- Outcome / Evidence: 把全局图层设置、重排、owner 移动和位置可见性的 Flow/Spatial 实现迁到对应 slice；cross-surface 只分派。
- Write scope: `src/renderer/composition/crossSurfaceCommands.ts`、`src/renderer/store/slices/slideAuthoringSlice.ts`、`src/renderer/store/slices/spatialAuthoringSlice.ts`、`src/renderer/store/slices/flowAuthoringSlice.ts`、`src/renderer/course/slideOwnedCommands.ts`、`src/renderer/store/editorStore.ts`
- Write locks: none
- Acceptance: Flow/Spatial 全局图层命令迁入各自 slice，crossSurfaceCommands 仅保留跨 surface 路由；目标测试通过。
- Validation: `npx vitest run tests/unit/effectiveLayerCommands.test.ts tests/unit/globalLayerUi.test.tsx` 与 `npm run typecheck`。
