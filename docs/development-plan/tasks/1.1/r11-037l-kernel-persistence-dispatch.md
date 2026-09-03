# r11-037l-kernel-persistence-dispatch 在 kernel 建立持久化分发并在 Surface slice 实现

- Status / Owner: queued /
- Outcome / Evidence: 在 kernel 建立 persistDocument、persistTransaction 窄入口，三大 Surface slice 各实现分支，root 仅通过 dispatchActiveSurface 分发。
- Write scope: `src/renderer/store/editorStoreKernel.ts`、`src/renderer/store/editorStore.ts`、`src/renderer/store/slices/slideAuthoringSlice.ts`、`src/renderer/store/slices/flowAuthoringSlice.ts`、`src/renderer/store/slices/spatialAuthoringSlice.ts`、`src/renderer/composition/surfaceRouter.ts`
- Write locks: editor-store-history
- Acceptance: kernel 与 surfaceRouter 协同完成窄分发，三 Surface 独立管理持久化分支；目标测试通过。
- Validation: `npx vitest run tests/unit/surfaceRouter.test.ts tests/unit/crossSurfaceResourceHistory.test.ts` 与 `npm run typecheck`。
