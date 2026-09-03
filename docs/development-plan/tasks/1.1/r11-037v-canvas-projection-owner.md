# r11-037v-canvas-projection-owner 画布投影与缓存独立解耦

- Status / Owner: queued /
- Outcome / Evidence: 新建 course/editorCanvasProjection.ts，迁入 Slide/Flow/Spatial 画布投影 helper、缓存与 effective projection；root selector 只委托。
- Write scope: `src/renderer/course/editorCanvasProjection.ts`、`src/renderer/course/activeSurfaceProjection.ts`、`src/renderer/store/editorStore.ts`、`tests/unit/architectureDependencyRatchet.test.ts`
- Write locks: none
- Acceptance: 新建模块承接三 Surface 画布投影及 5 组模块级缓存，禁止 import useEditorStore 或执行 mutation；root selector 纯委托；目标测试通过。
- Validation: `npx vitest run tests/unit/v9SlideViewportAdapter.test.ts tests/unit/spatialProductIntegration.test.tsx tests/unit/flowProductIntegration.test.tsx` 与 `npm run typecheck`。
