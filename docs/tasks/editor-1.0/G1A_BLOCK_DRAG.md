# G1A · 稿纸块拖拽排序 + 编辑态三档宽度

> 状态：**可领取**  
> 症状：G1 流内顺序几乎没把手；`data-flow-media-layout` 写了但宽度看不出  
> 车道：G  
> 合同变化：无  
> 工人先读：[02_WORKER.md](02_WORKER.md)、[G0_FLOW_NEAR_WORD_PLAN.md](G0_FLOW_NEAR_WORD_PLAN.md)

## 一句话

稿纸块用已有 `moveFlowEditorBlock` / `executeFlowEditorCommand({ name: 'move' })` 拖到另一块前后。媒体 `content-width | wide | full-width` 在编辑态看得出宽度。禁止回退 F1 `idleRichText`。

## Git

1. isolated worktree。
2. `git fetch origin cursor/flow-near-word-g-0ab9`
3. 建 `cursor/g1a-block-drag-0ab9`
4. push。**禁止开 PR。**
5. 写 `docs/tasks/editor-1.0/G1A_HANDOFF.md`

## 允许修改

```text
src/renderer/ui/FlowWorkspace.tsx          仅稿纸块 chrome / media 宽度 / 拖拽；禁止改 overlay 手势与公式对话框
tests/unit/flowWorkspace.test.tsx          追加 1–2 个用例，不要删现有断言
docs/tasks/editor-1.0/G1A_HANDOFF.md
```

## 禁止

- `PropertiesTab.tsx`、`editorStore.ts`、`flowEditorCommands.ts`、`FlowSurfaceHost.ts`
- 把每个段落写进图层数组 / NativeLayerItem
- 改 `case 'formula'` 双击、`openFormula`、overlay `onPointerDown`
- 无 offset 整文件 Read `FlowWorkspace.tsx`（约 1747 行）
- 同一路径 Read 第二次；全程最多 **8** 次 Read
- `npm test` / typecheck / e2e

## 基线（≤3 Read）

1. `rg -n "idleRichText|case 'media'|executeFlowEditorCommand" src/renderer/ui/FlowWorkspace.tsx` → Read media 分支（约 1269–1282）和 `applyToolbarCommand` 的 `move`（约 1065–1074）。
2. Read 稿纸 article 渲染（约 1604–1640）。
3. Read `tests/unit/flowWorkspace.test.tsx` offset=89 limit=80。`p-body` 的 idle runs 断言必须绿。

`move` 已有：`executeFlowEditorCommand(project, selection, { name: 'move', destination: { parentId, index } })`。同父级 splice 逻辑已在命令层。

## 逐步算法

### A. 拖拽把手（不要拖文字选区）

每个稿纸块外框（已有 `frameProps`）增加：

```tsx
data-flow-block-index={blockView.index}
data-flow-block-parent={blockView.parentId ?? ''}
```

在非 `readOnly` 且非 `editingThis` 时，块左侧加把手：

```tsx
<button
  type="button"
  data-testid={`flow-block-drag-${blockView.blockId}`}
  draggable
  aria-label="拖动排序"
  onDragStart={(event) => {
    event.dataTransfer.setData('text/flow-block-id', blockView.blockId)
    event.dataTransfer.effectAllowed = 'move'
  }}
/>
```

`onDragOver`：`event.preventDefault()`。`onDrop`：读 `text/flow-block-id`，找到目标 `blockView`，调用：

```ts
emitProject(executeFlowEditorCommand(project, selectFlowEditorBlocks(project, locationId, [sourceId]), {
  name: 'move',
  destination: { parentId: blockView.parentId, index: blockView.index, surfaceId: view.surfaceId },
}))
```

不要在 `editingThis` 时 draggable 整块。不要改 overlay 层。

### B. 编辑态三档宽度

`view.layout` 已有 `readingWidth`。`wideContentWidth` 从当前 flow surface 读：

```ts
const surface = project.surfaces.find((entry) => entry.id === view.surfaceId)
const wide = surface?.type === 'flow' ? surface.layout.wideContentWidth : view.layout.readingWidth
```

`case 'media'` 的 figure 增加 style（保留 `data-flow-media-layout`）：

| layout | maxWidth |
|---|---|
| content-width | `view.layout.readingWidth` |
| wide | `wide` |
| full-width | `'100%'` |

`width: '100%'`，`marginInline: 'auto'`。

### C. 禁止回退

`idleRichText` / `data-flow-idle-rich-text` 必须保留。就地编辑仍走 `richEditor`。

## 测试

追加：

```ts
it('reorders a paragraph by dropping it on another block handle', () => {
  // renderPaper 已有。给 createFlowProject 增加 p-second 段落，或在本 it 里用自定义 document。
  // fireEvent.dragStart(handle of p-body) + drop onto h1
  // 断言 onProjectChange 被调用且 nextDocument 中 p-body 的 index 变成 0 或紧贴目标
})
```

若改夹具会伤旧测试，本 it 自己 `render(<FlowWorkspace project={...} />)` 两段 paragraph + heading。

再追加：夹具里加一块 `layout: 'wide'` 的 media，断言 figure style.maxWidth 为 surface.wideContentWidth px。

旧「paints idle paragraph runs」必须绿。

## 最小验证

```bash
npx vitest run tests/unit/flowWorkspace.test.tsx
git diff --check
```
