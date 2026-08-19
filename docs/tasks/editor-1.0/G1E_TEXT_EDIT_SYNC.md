# G1E · 就地编辑时属性栏格式同步回稿纸 draft

> 状态：**第二波**（G1A 合入后再领；抢 `FlowWorkspace.tsx`）  
> 症状：F0 当时降级跳过：属性栏改 runs 时，正在就地编辑的 `FlowWorkspace` 本地 draft 不更新  
> 车道：G  
> 合同变化：无  
> 工人先读：[02_WORKER.md](02_WORKER.md)、[G0_FLOW_NEAR_WORD_PLAN.md](G0_FLOW_NEAR_WORD_PLAN.md)

## 一句话

`formatFlowTextStyle` 已经写工程并更新 store `flowTextEdit`。稿纸本地 `edit` 必须跟 store 走，闲置态 F1 已经能画 runs。不要重写 editorStore。

## Git

从 **合入 G1A 后的** `origin/cursor/flow-near-word-g-0ab9` 建 `cursor/g1e-text-edit-sync-0ab9`。禁止开 PR。HANDOFF：`G1E_HANDOFF.md`。

## 允许修改

```text
src/renderer/ui/FlowWorkspace.tsx
tests/unit/flowWorkspace.test.tsx
docs/tasks/editor-1.0/G1E_HANDOFF.md
```

## 禁止

- `editorStore.ts`、`PropertiesTab.tsx`、`flowTextEdit.ts`（除非最小验证无法编译，机械 import 才可）
- 同一路径 Read 第二次；全程最多 **8** 次 Read

## 逐步算法

`Workspace` 已 `onTextEditChange → setFlowTextEdit`（单向纸→店）。在 `FlowWorkspace` 用 `useEditorStore((s) => s.flowTextEdit)`：

当 store 的 `flowTextEdit` 与本地 `editRef` 同 `blockId`，且 `draft`（text/runs）或 `range` 不同时，`setEditState(storeEdit)` 并 `setRestyleToken+1`。不要在 composing 时用过期 store 覆盖 IME。

若 store 为 null 且本地有 edit，不要自动清（那是输入中）。

## 测试

模拟：进入 p-body 就地编辑后，直接 `useEditorStore.getState().formatFlowTextStyle({ italic: true })`（测试里要先把项目放进 store 并挂 flowSession——若太重，改为给 FlowWorkspace 传入后 spy `onTextEditChange` 不够）。优先：render FlowWorkspace 包一层能读 store 的测试，或在现有 paper 测试里把 `onTextEditChange` 接到 `setFlowTextEdit` 再调 `formatFlowAuthoringTextStyle` 的结果通过 props 回灌。

最小：本地 edit 存在时，父组件把带 italic runs 的 edit 再传入——若当前 API 没有 `textEdit` prop，就只从 store 读，测试里 `useEditorStore.setState({ flowTextEdit: next })`。

断言 `flow-inline-editor` 的 HTML 含 `font-style: italic` 或 innerHTML 匹配。

## 最小验证

```bash
npx vitest run tests/unit/flowWorkspace.test.tsx
git diff --check
```
