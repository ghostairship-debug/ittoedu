# r11-037q-lifecycle-command-owner 将生命周期命令迁入 courseLifecycleSlice

- Status / Owner: queued /
- Outcome / Evidence: 把 archive 重开、草稿物化、保存准备、Recovery snapshot 与保存 ACK 从 `crossSurfaceCommands.ts` 迁到 `courseLifecycleSlice.ts`；各 Surface 仅提供草稿物化/提交接口，lifecycle 统一组合。
- Write scope: `src/renderer/composition/crossSurfaceCommands.ts`、`src/renderer/store/slices/courseLifecycleSlice.ts`、三个 Surface slice、`src/renderer/store/editorStore.ts`
- Write locks: app-save-recovery
- Acceptance: router 中不再持有保存准备/草稿物化/recovery 等生命周期命令实现，全部委托给 courseLifecycleSlice；目标测试通过。
- Validation: `npx vitest run tests/unit/courseDraftPersistence.test.ts tests/integration/draftSaveTransaction.test.tsx` 与 `npm run typecheck`。
