# G1B · 上移下移 / 转为浮层 / 转回正文 / 真引用 / 浮层公式

> 状态：**可领取**  
> 症状：G1 作者入口没露出；F2 引用下拉只读；F3 只接了稿纸公式块  
> 车道：G  
> 合同变化：无（可加 `convert-quote` 命令，不加字段）  
> 工人先读：[02_WORKER.md](02_WORKER.md)、[G0_FLOW_NEAR_WORD_PLAN.md](G0_FLOW_NEAR_WORD_PLAN.md)

## 一句话

属性栏对图/视频/组件提供「上移 / 下移 / 转为浮层 / 转回正文」，调用**已有** convert/move。块类型下拉**永远**有「引用」且走新 `convert-quote`。选中浮层公式时也能 `FormulaAuthoringEditor`。不要回退 F2 颜色从 runs 读、F3 稿纸公式。

## Git

1. isolated worktree。
2. `git fetch origin cursor/flow-near-word-g-0ab9`
3. 建 `cursor/g1b-block-chrome-0ab9`
4. push。**禁止开 PR。**
5. 写 `docs/tasks/editor-1.0/G1B_HANDOFF.md`

## 允许修改

```text
src/renderer/ui/PropertiesTab.tsx
  仅 FlowBlockProperties / FlowMediaBlockProperties / 约 2429 的 Flow 分支
  可在同文件新增 FlowOverlayProperties / FlowComponentBlockChrome，不要改 Slide FontFamilyPicker 行为
src/renderer/course/flowEditorCommands.ts
  仅 FlowBlockFormatSpec + convert-quote 分支
src/renderer/course/flowSharedAuthoringAdapters.ts
  仅在文件末尾追加 commitFlowOverlayFormulaAst
tests/unit/flowProductIntegration.test.tsx     追加
tests/unit/flowEditorCommands.test.ts          追加 convert-quote
tests/unit/flowFormulaProperties.test.tsx      可追加浮层用例，或新建 tests/unit/flowOverlayFormulaProperties.test.tsx
docs/tasks/editor-1.0/G1B_HANDOFF.md
```

## 禁止

- `FlowWorkspace.tsx`、`editorStore.ts`（用已有 `applyFlowCommand` / `formatFlowBlock`）、`FormulaAuthoringEditor.tsx`
- 改 `SelectField` 组件 API
- 把缩进当标题层级
- 无 offset 整文件 Read `PropertiesTab.tsx`（约 2700 行）
- 同一路径 Read 第二次；全程最多 **8** 次 Read
- `npm test` / typecheck / e2e

## 基线（≤4 Read）

1. `rg -n "function FlowBlockProperties|function FlowMediaBlockProperties|focus !== 'overlay'" src/renderer/ui/PropertiesTab.tsx` → Read FlowBlockProperties（约 2261–2360）和 2429 附近。
2. Read `FlowBlockFormatSpec` 与 `convert-paragraph` 分支（`flowEditorCommands.ts` 约 94–99 与 673–696）。最后一条可导航标题转段落抛 `FLOW_LAST_HEADING_REASON`。
3. `rg -n "export function convertFlowMediaBlockToOverlay|convertFlowOverlayMediaToDocument|convertFlowComponentBlockToOverlay|convertFlowOverlayComponentToDocument" src/renderer/course/flowSharedAuthoringAdapters.ts` — 只记名字，不要整文件读。调用即可。
4. Read `src/renderer/ui/FlowFormulaBlockProperties.tsx`（很短）和 `tests/unit/flowProductIntegration.test.tsx` offset=145 limit=30。

`applyFlowCommand` 已接受 `FlowSharedAuthoringResult`。

## 逐步算法

### A. `convert-quote`

`FlowBlockFormatSpec` 增加 `{ kind: 'convert-quote' }`。

在 `formatFlowEditorBlock` 的 convert 链里：

- 已是 quote：noop 成功
- heading：若去掉后 `listFlowCourseAnchors` 为空 → throw `FLOW_LAST_HEADING_REASON`；否则换成 quote，保留 `id/text/runs`
- paragraph：换成 quote，保留 `id/text/runs`
- 其它：throw `当前块不能转为引用`

### B. 块类型下拉（不得降级成只读引用）

`quote` 选项**始终**出现（不要 `block.type === 'quote' ? [...]`）。`onChange`：

- `paragraph` → `convert-paragraph`
- `quote` → `formatFlowBlock({ kind: 'convert-quote' })`
- `'1'..'6'` → `convert-heading`

颜色 `flowRichTextColor` 保持从 runs 读。

### C. 媒体/组件上移下移与所有权

`FlowMediaBlockProperties` 增加按钮（`data-testid`）：

- `flow-block-move-up` / `flow-block-move-down`：`applyFlowCommand(executeFlowEditorCommand(document, session.selection, { name: 'move', destination: { parentId, index: found.index ± 1, surfaceId } }))`。`found` 用已有 `findFlowBlockRecursive`。
- `flow-block-to-overlay`：`convertFlowMediaBlockToOverlay`（音频保持现有拒绝原因，不要改命令语义）

组件块：同样三个按钮，转为浮层走 `convertFlowComponentBlockToOverlay`。可在 `FlowBlockProperties` 里 `block.type === 'component'` 时渲染一小段，不要新文件。

### D. 浮层选中

把

```ts
if (flowSession && flowSession.selection.focus !== 'overlay' && flowSession.selection.selectedBlockId) {
  return <FlowBlockProperties session={flowSession} />
}
```

改成：overlay 焦点走新的同文件 `FlowOverlayProperties`：

- native image/video：按钮 `flow-overlay-to-document` → `convertFlowOverlayMediaToDocument`
- component overlay：`convertFlowOverlayComponentToDocument`
- native formula：复用 `FormulaAuthoringEditor`，提交 `commitFlowOverlayFormulaAst`（你在 adapters 末尾写：定位 `selectedOverlayIds[0]`，要求 `kind==='native' && nativeType==='formula'`，`runOverlayMutation` 写 `content.data.ast` + `accessibleText`，镜像 `updateFlowOverlayComponentProps` 的写法）

控制器 / shape 不要「转回正文」。

稿纸公式仍由现有 `FlowFormulaBlockProperties` 处理，不要拆掉。

## 测试

1. `flowEditorCommands.test.ts`：paragraph → quote 保留 text/runs；最后一条 heading → quote 失败文案含「至少需要一个可导航标题」。
2. `flowProductIntegration.test.tsx`：选中 paragraph，属性栏选「引用」，块变成 quote；选中 media 点转为浮层后 ownership 为 viewport-overlay（可 `readFlowSharedOwnership`，从 `flowSharedAuthoringAdapters` import）。旧 bold 用例必须绿。
3. 浮层公式：选中 overlay formula 后能看到 `flow-formula-properties` 或 `flow-overlay-formula-properties`。

## 最小验证

```bash
npx vitest run tests/unit/flowEditorCommands.test.ts tests/unit/flowProductIntegration.test.tsx tests/unit/flowFormulaProperties.test.tsx
git diff --check
```

若新建了 overlay 公式测试文件，把它加进 vitest 命令。
