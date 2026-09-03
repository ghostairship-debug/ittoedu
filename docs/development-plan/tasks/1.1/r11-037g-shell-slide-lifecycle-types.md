# r11-037g-shell-slide-lifecycle-types 把 shell、Slide 与 lifecycle 类型从 root 移到已有 Owner

- Status / Owner: queued /
- Outcome / Evidence: 把 shell、Slide 与 lifecycle 类型从 root 移到已有 Owner，只有一个定义。
- Write scope: `src/renderer/store/editorStore.ts`、`src/renderer/store/slices/editorShellSlice.ts`、`src/renderer/course/slideOwnedCommands.ts`、`src/renderer/course/v9SlideContentCommands.ts`、`src/renderer/store/slices/courseLifecycleSlice.ts` 及 TypeScript 报出的直接 type importers
- Write locks: none
- Acceptance: 类型完全下沉到已有 Owner，root 只 type-import 不再作为唯一类型定义源；npm run typecheck 通过。
- Validation: `npm run typecheck`
