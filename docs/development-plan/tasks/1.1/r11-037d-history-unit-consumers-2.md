# r11-037d-history-unit-consumers-2 迁移单元测试根级 history 读取 (批次 2)

- Status / Owner: queued /
- Outcome / Evidence: 迁移余下 7 个单元测试对 `useEditorStore.getState().history` 的读取，使其直接改读活动 Surface 会话的 history，产品代码不动。
- Write scope: `tests/unit/courseDraftPersistence.test.ts`、`tests/unit/editorStore.test.ts`、`tests/unit/globalEditorStore.test.ts`、`tests/unit/scenePanelReorder.test.tsx`、`tests/unit/simpleEditorMode.test.tsx`、`tests/unit/textEmphasis.test.ts`、`tests/unit/unifiedDeleteTransaction.test.ts`
- Write locks: editor-store-history
- Acceptance: 按测试当前活动 Surface 改读 `slideBackend.getSession().history`、`flowSession.history` 或 `spatialSession.history`；不得删除历史深度、撤销分支或 no-op 不新增历史的断言；产品代码零改动。
- Validation: `npx vitest run tests/unit/courseDraftPersistence.test.ts tests/unit/editorStore.test.ts tests/unit/globalEditorStore.test.ts tests/unit/scenePanelReorder.test.tsx tests/unit/simpleEditorMode.test.tsx tests/unit/textEmphasis.test.ts tests/unit/unifiedDeleteTransaction.test.ts`。
