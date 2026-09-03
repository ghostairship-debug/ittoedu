# r11-037f-remove-history-and-can-flags 彻底删除根级 history 与 canUndo/canRedo 字段

- Status / Owner: queued /
- Outcome / Evidence: 从 EditorState 和 editorStoreKernel 中彻底删除 history、canUndo、canRedo、canUndoRef、canRedoRef，所有 UI 消费端改用活动 Surface 会话派生状态。
- Write scope: `src/renderer/store/editorStoreKernel.ts`、`src/renderer/store/editorStore.ts`、`src/renderer/store/slices/historySlice.ts`、`src/renderer/ui/TopToolbar.tsx`、相关断言测试
- Write locks: editor-store-history
- Acceptance: EditorState 上零 history、canUndo、canRedo、canUndoRef、canRedoRef 导出；TopToolbar 与快捷键正确按活动 Surface 会话派发 undo/redo 并展示可用状态；npm run typecheck 通过。
- Validation: `npm run typecheck`，并运行关联的 store 与 UI 测试。
