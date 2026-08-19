# G1C 交接文档 · 图层树虚拟「正文」行

## 变更概要

1. **`src/renderer/ui/NodesTab.tsx`**:
   - 当处于 `flowSession` 且 `editingScope !== 'global'` 时，在图层树最上方渲染不可排序的虚拟正文行 `<button data-testid="flow-paper-body-row">`，标签为「正文」。
   - 点击该正文行时，读取当前 flow surface 的首个 heading 块（或首个 block），调用 `applyFlowSelection(selectFlowEditorBlocks(...))` 将选区聚焦到稿纸块上。
   - 不将 heading / paragraph 加入 `layerItems` 或作为 `node-item-*` 图层行渲染，也不将虚拟正文行放入 `SortableContext` 的 items 中。
   - 维持 P7 规则：非 global 作用域下不列出教师控制器。

2. **`tests/unit/flowUnifiedLayerEntry.test.tsx`**:
   - 更新首个测试用例：验证 `flow-paper-body-row` 存在且包含「正文」标签；heading/paragraph 仍无 `node-item-${id}`；教师控制器在非 global 仍不出现；点击正文行后选区聚焦到稿纸块。
   - 保留其他所有测试用例全部通过。

## 验证结果

- `npx vitest run tests/unit/flowUnifiedLayerEntry.test.tsx`：5/5 passed.
- `git diff --check`：无异常。
