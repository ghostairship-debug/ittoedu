# G2C · 稿纸浮动工具条接字体/字号 Handoff

## 变更摘要

1. **`src/renderer/ui/FlowBlockContextToolbar.tsx`**:
   - 导入 `COMMON_FONT_FAMILIES` 来自 `./PropertiesTab`。
   - 在选区工具条（`showRangeTools`）中粗体按钮前添加字体选择下拉框 `<select data-testid="flow-toolbar-font-family" aria-label="字体">`，选择字体后触发 `{ type: 'range-style', style: { fontFamily: value } }`。
   - 添加字号数字输入框 `<input type="number" data-testid="flow-toolbar-font-size" aria-label="字号">`，回车（Enter）或失焦（blur）时触发 `{ type: 'range-style', style: { fontSize: n } }`（空值或无效值不提交）。
   - 保留焦点/选区捕获行为（`onMouseDown={preserveFocus}`）。

2. **`tests/unit/flowBlockContextToolbar.test.tsx`**:
   - 编写针对 `FlowBlockContextToolbar` 字体/字号及选区工具条展示行为的单元测试，5 个用例全部通过。

## 验证结果

- `npx vitest run tests/unit/flowBlockContextToolbar.test.tsx`: 5/5 通过
- `npx vitest run tests/unit/flowWorkspace.test.tsx`: 12/12 通过
- `git diff --check`: 无多余空格/冲突标记
