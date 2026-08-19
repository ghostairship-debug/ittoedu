# G2C · 稿纸浮动工具条接字体/字号

> 状态：**与 G3C 并行**（禁止碰 `FlowWorkspace.tsx` / `PropertiesTab.tsx`）  
> 症状：G2B 只接了属性栏；就地编辑时稿纸工具条仍只有粗斜体颜色，不像 Word  
> 车道：G  
> 合同变化：无  
> 工人先读：[02_WORKER.md](02_WORKER.md)

## 一句话

在 `FlowBlockContextToolbar` 的选区工具里加字体、字号。走已有 `{ type: 'range-style', style: { fontFamily } | { fontSize } }`。`FlowWorkspace.applyToolbarCommand` 对非粗斜体的 range-style 已落到 `formatFlowAuthoringTextStyle`，**不要改 FlowWorkspace**。

## Git

从 `origin/cursor/flow-near-word-g-0ab9` 建 `cursor/g2c-toolbar-font-0ab9`。禁止开 PR。

## 允许修改

```text
src/renderer/ui/FlowBlockContextToolbar.tsx
tests/unit/flowBlockContextToolbar.test.tsx
docs/tasks/editor-1.0/G2C_HANDOFF.md
```

## 禁止

- `FlowWorkspace.tsx`、`PropertiesTab.tsx`、`FlowSurfaceHost.ts`（G3C 占用）
- 复制一整套 FontFamilyPicker 下拉面板
- 同一路径 Read 第二次；全程最多 **8** 次 Read

## 逐步算法

1. 从 `./PropertiesTab` **只 import** 已导出的 `COMMON_FONT_FAMILIES`（不要改 PropertiesTab）。
2. `showRangeTools` 为真时，在粗体按钮前加：
   - `<select data-testid="flow-toolbar-font-family" aria-label="字体">`，option 来自 `COMMON_FONT_FAMILIES`（value=family，label 可用 family 短名）
   - onChange → `onCommand({ type: 'range-style', style: { fontFamily: value } })`
   - 数字 input `data-testid="flow-toolbar-font-size"` aria-label="字号"；blur/Enter → `onCommand({ type: 'range-style', style: { fontSize: n } })`；空不提交
3. 不要改结构工具（H1/缩进/上移）。块类型仍不是字号。

## 测试

新建 `tests/unit/flowBlockContextToolbar.test.tsx`：render 工具条（`edit` 为 rich-text session 最小 stub），change 字体 select，断言 `onCommand` 收到 `{ type: 'range-style', style: { fontFamily: ... } }`；字号 input 同理。

## 最小验证

```bash
npx vitest run tests/unit/flowBlockContextToolbar.test.tsx
git diff --check
```
