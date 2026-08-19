# G2B · Flow 属性栏接 FontFamilyPicker + 段级对齐/行距 + 字号

> 状态：**第二波**（等 G2A 与 G1B 合入；抢 `PropertiesTab.tsx`）  
> 症状：G2 UI；块类型不得再冒充字号  
> 车道：G  
> 合同变化：否（字段已在 G2A）  
> 工人先读：[02_WORKER.md](02_WORKER.md)、[G0_FLOW_NEAR_WORD_PLAN.md](G0_FLOW_NEAR_WORD_PLAN.md)

## 一句话

把演示页 `FontFamilyPicker` **抽出复用外观**（不要复制第二套）。Flow 选区格式：字体/字号写 runs 的 additive 字段；对齐/行距写块上 `textAlign`/`lineSpacing`。缺省显示 Token / 左对齐。块类型下拉仍只管 H1–H6/段落/引用。

## Git

从合入 G2A+G1B 的集成分支建 `cursor/g2b-flow-font-ui-0ab9`。禁止开 PR。

## 允许修改

```text
src/renderer/ui/PropertiesTab.tsx
  导出或上提 FontFamilyPicker；FlowBlockProperties 接线；不要改 Slide 其它属性语义
src/renderer/authoring/flowTextEdit.ts   仅当 formatFlowAuthoringTextStyle 必须把 fontFamily/fontSize 写进 runs
src/player/surfaces/flow/FlowSurfaceHost.ts  仅 appendRichText 应用 fontFamily/fontSize 与段级 textAlign/lineSpacing
src/renderer/ui/FlowWorkspace.tsx           仅 idleRichText/段容器应用段级对齐（若 G1A 已合入则最小补）
src/renderer/authoring/flowTextEdit.ts      buildFlowRichTextHtml 增加 font-family/font-size CSS
tests/unit/flowProductIntegration.test.tsx
docs/tasks/editor-1.0/G2B_HANDOFF.md
```

若与 G1E/G3B 抢 FlowWorkspace：只改 heading/paragraph/quote 的 style 属性，不要改拖拽。

## 禁止

- 改 Schema（G2A 已做）
- 新造一套字体下拉
- 用块类型当字号
- 同一路径 Read 第二次；全程最多 **8** 次 Read

## 逐步算法

1. 将 `function FontFamilyPicker` 改为 `export function FontFamilyPicker`（同文件即可）。
2. Flow「选区格式」增加 FontFamilyPicker，value：当前块 runs 上第一个 fontFamily，否则 `project.designTokens.fonts[0].fontFamily`。onCommit → `formatFlowTextStyle({ fontFamily })`。
3. 字号：数字输入，空=缺省，onCommit → `formatFlowTextStyle({ fontSize: n })`。
4. 段级：SelectField 对齐 left/center/right；行距数字。用 `updateFlowEditorBlock` 写 `textAlign`/`lineSpacing`，不要写进 runs。
5. `buildFlowRichTextHtml` / `appendRichText` 输出 `font-family` / `font-size`。heading/paragraph/quote DOM `textAlign` 与 `lineHeight`（lineSpacing 缺省不设，有值则 `${1.6 + lineSpacing/100}` 或 `lineSpacing` 当额外 px——选一种并在测试写死：`lineSpacing: 8` → `line-height` 含该影响）。推荐：`element.style.lineHeight = lineSpacing === undefined ? '' : String(1.6 + lineSpacing / 16)`。

## 最小验证

```bash
npx vitest run tests/unit/flowProductIntegration.test.tsx tests/unit/flowWorkspace.test.tsx
git diff --check
```
