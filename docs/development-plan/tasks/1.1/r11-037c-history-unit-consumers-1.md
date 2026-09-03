# r11-037c-history-unit-consumers-1 迁移单元测试根级 history 读取 (批次 1)

- Status / Owner: queued /
- Outcome / Evidence: 迁移首批 8 个单元测试对 `useEditorStore.getState().history` 的读取，使其直接改读活动 Surface 会话的 history，产品代码不动。
- Write scope: `tests/unit/batchMediaAndInsertion.test.ts`、`tests/unit/componentCatalogReplacement.test.ts`、`tests/unit/componentPackageManagement.test.tsx`、`tests/unit/componentPropertiesEditor.test.tsx`、`tests/unit/courseLogicAuthoringStore.test.ts`、`tests/unit/editorFormattingUi.test.tsx`、`tests/unit/formulaNode.test.ts`、`tests/unit/formulaNodeUi.test.tsx`
- Write locks: editor-store-history
- Acceptance: 按测试当前活动 Surface 改读 `slideBackend.getSession().history`、`flowSession.history` 或 `spatialSession.history`；保持原来的 past/future 数值和引用相等断言；产品代码零改动。
- Validation: `npx vitest run tests/unit/batchMediaAndInsertion.test.ts tests/unit/componentCatalogReplacement.test.ts tests/unit/componentPackageManagement.test.tsx tests/unit/componentPropertiesEditor.test.tsx tests/unit/courseLogicAuthoringStore.test.ts tests/unit/editorFormattingUi.test.tsx tests/unit/formulaNode.test.ts tests/unit/formulaNodeUi.test.tsx`。
