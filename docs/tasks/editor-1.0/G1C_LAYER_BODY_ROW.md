# G1C · 图层树虚拟「正文」行

> 状态：**可领取**  
> 症状：G1 图层要么空文案、要么将来会把段落做成 z-order 行  
> 车道：G  
> 合同变化：无（禁止新持久化字段）  
> 工人先读：[02_WORKER.md](02_WORKER.md)、[G0_FLOW_NEAR_WORD_PLAN.md](G0_FLOW_NEAR_WORD_PLAN.md)

## 一句话

Flow 图层树加一行虚拟「正文」（不是 layerItem）。下面仍只列浮层。不要把 heading/paragraph 变成 `node-item-*`。点「正文」把选区拉回稿纸块，不要进全局层。

## Git

1. isolated worktree。
2. `git fetch origin cursor/flow-near-word-g-0ab9`
3. 建 `cursor/g1c-layer-body-0ab9`
4. push。**禁止开 PR。**
5. 写 `docs/tasks/editor-1.0/G1C_HANDOFF.md`

## 允许修改

```text
src/renderer/ui/NodesTab.tsx
tests/unit/flowUnifiedLayerEntry.test.tsx
docs/tasks/editor-1.0/G1C_HANDOFF.md
```

## 禁止

- 改 `groupedVisualRows` 函数体 / `effectiveLayerProjection`
- 把段落写入 `layerItems` 或新增 Schema 字段
- `editorStore.ts`、`FlowWorkspace.tsx`、`PropertiesTab.tsx`
- 同一路径 Read 第二次；全程最多 **8** 次 Read
- `npm test` / typecheck / e2e

## 基线（≤2 Read）

1. `rg -n "flowSession|本页没有浮层|NodesTab" src/renderer/ui/NodesTab.tsx` → Read `export function NodesTab` 的 empty-state 与 list（约 355–470）。
2. Read `tests/unit/flowUnifiedLayerEntry.test.tsx` 第一个 it（约 81–101）。Q7/P7：非 global 不列出控制器；heading/paragraph 不能出现 `node-item-${id}`。

`applyFlowSelection` / `selectFlowEditorBlocks` 已存在。`useEditorStore` 已在 NodesTab。

## 逐步算法

在 `return (` 的 `nodes-tab` 里，当 `flowSession` 且 `editingScope !== 'global'`（或只要 flowSession 非 global）：

在列表**最上方**（empty-state 之前）渲染不可排序行：

```tsx
<button
  type="button"
  data-testid="flow-paper-body-row"
  className="..." 
  onClick={() => {
    const flow = useEditorStore.getState().flowSession
    if (!flow) return
    const surface = flow.history.present.surfaces.find((s) => s.id === flow.selection.surfaceId)
    const first = surface && surface.type === 'flow'
      ? surface.blocks.find((b) => b.type === 'heading') ?? surface.blocks[0]
      : null
    if (!first) return
    useEditorStore.getState().applyFlowSelection(
      selectFlowEditorBlocks(flow.history.present, flow.selection.locationId, [first.id]),
    )
  }}
>
  正文
</button>
```

需要 `import { selectFlowEditorBlocks } from '../course/flowEditorSlice'`。

旧 empty-state「本页没有浮层…」：有浮层行时不要显示；**没有浮层时可以保留在正文行下面作 hint**，或改成「浮层会出现在下方」。无论哪种，测试必须能找到 `flow-paper-body-row` 且仍找不到 heading/paragraph 的 `node-item-*`。

不要把虚拟行放进 `SortableContext` 的 items（它没有真实 layer id）。Dnd 仍只排浮层。

## 测试

改第一个 it：

- `expect(screen.getByTestId('flow-paper-body-row')).toBeTruthy()`
- heading/paragraph 仍无 `node-item-${id}`
- 控制器在非 global 仍不出现
- 允许不再出现整句「本页没有浮层。标题和段落在稿纸里编辑，不出现在图层。」——改断言为正文行存在即可，不要再要求那句必须存在
- 点正文行后 `flowSession.selection.focus` 为 `'blocks'` 或 selectedBlockId 为 heading id

其它 it（进全局层列出控制器、Delete 分流）必须绿。

## 最小验证

```bash
npx vitest run tests/unit/flowUnifiedLayerEntry.test.tsx
git diff --check
```
