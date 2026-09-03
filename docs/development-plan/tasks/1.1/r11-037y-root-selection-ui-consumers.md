# r11-037y-root-selection-ui-consumers 根选区 UI 消费者迁移

- Status / Owner: queued /
- Outcome / Evidence: 迁移 `ui/**`、Phaser bridge 和三个 Workspace connector 对五个根镜像字段的读取，改用命名 selector 或单一 Owner view。
- Write scope: `src/renderer/ui/**`、`src/renderer/phaser/**`、`src/renderer/store/editorStore.ts`（仅 selector 导出）
- Write locks: none
- Acceptance: UI 层消费者改走命名 selector；目标测试通过；类型检查无错误。
- Validation: `npx vitest run tests/unit/v9SlideProductIntegration.test.tsx tests/unit/flowProductIntegration.test.tsx tests/unit/spatialProductIntegration.test.tsx tests/unit/globalLayerUi.test.tsx` 与 `npm run typecheck`。
