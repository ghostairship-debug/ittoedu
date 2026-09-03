# r11-037j-flow-persist-owner 把 Flow persist 逻辑下沉收敛至 flowAuthoringSlice

- Status / Owner: queued /
- Outcome / Evidence: 把 applyFlowBackend、persistFlowResult、persistFlowLayerCommand 迁入 flowAuthoringSlice，root 仅接返回成员。
- Write scope: `src/renderer/store/editorStore.ts`、`src/renderer/store/slices/flowAuthoringSlice.ts`、`src/renderer/composition/crossSurfaceCommands.ts`、`src/renderer/store/slices/courseLifecycleSlice.ts`
- Write locks: none
- Acceptance: Flow persist 逻辑完全收敛在 flowAuthoringSlice；root 无冗余闭包；目标测试通过。
- Validation: `npx vitest run tests/unit/flowProductIntegration.test.tsx tests/integration/courseMediaLibraryImportVerticalSlice.test.ts` 与 `npm run typecheck`。
