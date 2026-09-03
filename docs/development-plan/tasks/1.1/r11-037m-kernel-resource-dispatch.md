# r11-037m-kernel-resource-dispatch 把 courseResourceCommands 的包装收敛入 kernel

- Status / Owner: queued /
- Outcome / Evidence: 把 courseResourceCommands 的包装移入 kernel，root 不直接操作资源历史。
- Write scope: `src/renderer/store/editorStoreKernel.ts`、`src/renderer/store/editorStore.ts`、`src/renderer/store/courseResourceCommands.ts`
- Write locks: editor-store-history
- Acceptance: 资源命令统一经由 kernel 驱动，root 不直接操作资源历史分支；目标测试通过。
- Validation: `npx vitest run tests/unit/courseResourceState.test.ts tests/unit/courseResourceCommands.test.ts` 与 `npm run typecheck`。
