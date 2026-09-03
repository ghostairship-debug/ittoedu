# r11-037a-dead-text-edit-mirror 删除根级 textEditSession 镜像

- Status / Owner: queued /
- Outcome / Evidence: 根级 `textEditSession` 镜像从不保存非 null 值，且三 Surface 已各有其文字草稿机制；删除根镜像及多余兜底。
- Write scope: `src/renderer/store/editorStore.ts`、`src/renderer/store/slices/editorShellSlice.ts`、`src/renderer/store/slices/slideAuthoringSlice.ts`、`src/renderer/store/slices/flowAuthoringSlice.ts`、`src/renderer/store/slices/spatialAuthoringSlice.ts`、`src/renderer/App.tsx`、`tests/unit/editorStore.test.ts`
- Write locks: editor-store-history
- Acceptance: `editorStore.ts`、App 和三个 slice 不再包含根镜像；文字草稿仍由 Slide/Flow/Spatial 各自 draft 字段负责；`selectHasDirtyCourseContentDraft` 删除该兜底；App 删除对应 watch。不要触碰 `shouldIgnoreSlideLayerDeleteForFocus` 入参中的同名布尔字段。
- Validation: `npx vitest run tests/unit/editorStore.test.ts tests/integration/draftSaveTransaction.test.tsx`；`npm run typecheck`。
