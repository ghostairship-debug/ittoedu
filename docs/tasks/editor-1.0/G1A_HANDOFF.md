# G1A Handoff · 稿纸块拖拽排序 + 编辑态三档宽度

## 任务概要
- 车道：G1A
- 分支：`cursor/g1a-block-drag-0ab9`
- 目标：
  1. 稿纸块增加 `data-flow-block-index` 与 `data-flow-block-parent`。
  2. 非 `readOnly` 且非 `editingThis` 时提供左侧拖拽把手 `data-testid="flow-block-drag-${blockId}"`，支持 dragStart/dragOver/drop 触发 `executeFlowEditorCommand({ name: 'move' })` 重新排序。
  3. 编辑态媒体 figure 保留 `data-flow-media-layout`，按 `content-width | wide | full-width` 分别设置 maxWidth（`view.layout.readingWidth` / `surface.layout.wideContentWidth` / `100%`），以及 `width: 100%`, `marginInline: auto`。
  4. 保持 F1 `idleRichText` / `data-flow-idle-rich-text` 及所有原有测试断言绿。

## 变更文件
- `src/renderer/ui/FlowWorkspace.tsx`
- `tests/unit/flowWorkspace.test.tsx`
- `docs/tasks/editor-1.0/G1A_HANDOFF.md`

## 验证结果
- `npx vitest run tests/unit/flowWorkspace.test.tsx`：9 passed (9)
- `git diff --check`：无空白/格式错误
