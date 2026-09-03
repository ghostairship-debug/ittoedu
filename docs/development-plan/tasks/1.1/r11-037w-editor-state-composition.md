# r11-037w-editor-state-composition EditorState 合成类型与根工厂纯化

- Status / Owner: queued /
- Outcome / Evidence: EditorState 改为 owner state 与各工厂返回类型的交叉类型；root 工厂只剩 kernel host、slice/Feature 工厂调用、分派接线、初始值和展开返回。
- Write scope: `src/renderer/store/editorStore.ts`
- Write locks: none
- Acceptance: EditorState 由各 slice / feature 交叉组合；root store 工厂纯化为只有组合与分派接线；目标测试通过。
- Validation: `npx vitest run tests/unit/architectureDependencyRatchet.test.ts tests/unit/readModelBoundary.test.ts` 与 `npm run typecheck`。
