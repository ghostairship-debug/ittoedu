# r11-037t-routed-action-owners 动作路由adapter与删除分支迁回对应slice

- Status / Owner: queued /
- Outcome / Evidence: 把 routeEditorAction 的三 Surface adapter、global delete 分支和 focus 推导迁到各 slice；router 只组装 snapshot 并分派。
- Write scope: `src/renderer/composition/crossSurfaceCommands.ts`、`src/renderer/store/slices/slideAuthoringSlice.ts`、`src/renderer/store/slices/spatialAuthoringSlice.ts`、`src/renderer/store/slices/flowAuthoringSlice.ts`、`src/renderer/store/editorStore.ts`
- Write locks: none
- Acceptance: 三 Surface 专属动作路由与删除实现归位各自 slice，crossSurfaceCommands 仅保留通用路由与分派；目标测试通过。
- Validation: `npx vitest run tests/unit/editorActionRouting.test.ts tests/unit/unifiedDeleteTransaction.test.ts` 与 `npm run typecheck`。
