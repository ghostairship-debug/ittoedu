# r11-037e-history-e2e-consumers 迁移集成测试根级 history 读取

- Status / Owner: queued /
- Outcome / Evidence: 迁移 integration 测试中的根级 history 读取，使其直接改读活动 Surface 会话的 history，产品代码不动。
- Write scope: `tests/unit/authoringRecoveryIntegration.test.ts`、`tests/unit/externalComponentIntegration.test.ts`、`tests/unit/presentationModeIntegration.test.ts`、`tests/unit/richTextIntegration.test.tsx`
- Write locks: editor-store-history
- Acceptance: 迁移对 `useEditorStore.getState().history` 的断言至当前 Surface 会话；保持各集成测试原有的恢复、撤销/重做、多状态、富文本历史断言；产品代码零改动。
- Validation: `npx vitest run tests/unit/authoringRecoveryIntegration.test.ts tests/unit/externalComponentIntegration.test.ts tests/unit/presentationModeIntegration.test.ts tests/unit/richTextIntegration.test.tsx`。
