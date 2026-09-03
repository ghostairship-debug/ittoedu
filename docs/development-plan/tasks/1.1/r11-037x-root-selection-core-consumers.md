# r11-037x-root-selection-core-consumers 根选区 Core 消费者迁移

- Status / Owner: queued /
- Outcome / Evidence: 迁移 Core 命令、快捷键与 Feature ports，改走活动 Surface session 的 selection / scope；保留 Store 上的字段与回写供下一卡使用，但不新增第二写入。
- Write scope: `src/renderer/store/editorStore.ts`、`src/renderer/composition/crossSurfaceCommands.ts`、`src/renderer/store/slices/slideOwnedCommands.ts`、`src/renderer/runtime/commitRuntimeAuthoring.ts`、`src/renderer/media/commitCourseMediaAuthoring.ts`、`src/renderer/components/commitComponentPackageAuthoring.ts`、`src/renderer/interactions/commitInteractionAuthoring.ts`、`src/renderer/App.tsx`、`src/renderer/composition/properties/PropertiesAuthoringReadModel.ts`
- Write locks: none
- Acceptance: Core 层消费者改走活动 Surface session 的 selection/scope 或命名 selector；目标测试通过；类型检查无错误。
- Validation: `npx vitest run tests/integration/courseInteractionAuthoringVerticalSlice.test.ts tests/integration/runtimePropertyAuthoringVerticalSlice.test.tsx` 与 `npm run typecheck`。
