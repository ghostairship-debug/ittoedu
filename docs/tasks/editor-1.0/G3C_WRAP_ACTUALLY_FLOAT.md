# G3C · wrap 必须真的让后文绕排

> 状态：**第三波**（G3B 已合入集成分支；本卡修 G3B 绕排无效）  
> 症状：`wrap: left|right` 只改了 `float`/`margin`，图仍通栏，后一段文字不会走到图旁边  
> 车道：G  
> 合同变化：无  
> 工人先读：[02_WORKER.md](02_WORKER.md)、[G0_FLOW_NEAR_WORD_PLAN.md](G0_FLOW_NEAR_WORD_PLAN.md)

## 一句话

绕排要像 Word：左/右浮动的图或组件只占一列（约 48% 宽），**后面的段落文字从旁边流过**。缺省 `none` 仍是今天通栏 + 三档 maxWidth。

## 根因（不要只加 float）

1. 编辑态 `FlowWorkspace` 每个块外面还有一层 `{rootBlocks.map(... <div key>{renderBlock}</div>)}`。float 困在通栏 wrapper 里，后一块是 wrapper 的兄弟，绕不到。
2. 分节子块同样包了多余 `<div key>`（`flow-section-content` 里）。
3. 试运行 `figure.style.width = '100%'`，即使 `float:left` 仍吃满阅读列，旁边没有空位。
4. 组件块属性栏没有 wrap 下拉（媒体已有 `flow-media-wrap`）。

## Git

从 **当前** `origin/cursor/flow-near-word-g-0ab9`（HEAD 应含 G3B，约 `9518a24` 或更新）建 `cursor/g3c-wrap-float-0ab9`。禁止开 PR。HANDOFF：`G3C_HANDOFF.md`。

不要在 `/workspace` 或别人的 worktree 上改。

## 允许修改

```text
src/player/surfaces/flow/FlowSurfaceHost.ts
src/renderer/ui/FlowWorkspace.tsx
src/renderer/ui/PropertiesTab.tsx          仅组件块 wrap 下拉；不要拆 G1B chrome / G2B 字体 / 媒体 wrap / 浮层 paperSpace
tests/unit/flowSurfaceHost.test.ts
tests/unit/flowWorkspace.test.tsx
docs/tasks/editor-1.0/G3C_HANDOFF.md
```

## 禁止

- 改 Schema、G0 稿纸 wheel/drag 滚动、三档 `wideContentWidth`、G1E `storeEdit` 同步、`convert-quote`、overlay chrome
- 用 `position:absolute` 冒充绕排
- 同一路径 Read 第二次；全程最多 **8** 次 Read

## 逐步算法

### 编辑态

1. 去掉稿纸根上多余 wrapper：`rootBlocks.map((blockView) => renderBlock(blockView))`，把 `key={blockView.blockId}` 放到 `renderBlock` 返回的那层 `div {...frameProps}`。
2. 分节 `flow-section-content` 同样直接 `renderBlock(child)`，不要再套一层 key-div。
3. 当 `block.type` 为 `media` 或 `component` 且 `wrap` 为 `left|right`：把 **外层块框**（`frameProps.style`）设为  
   - left：`float:left; width:48%; margin:0 16px 8px 0`  
   - right：`float:right; width:48%; margin:0 0 8px 16px`  
   内层 figure 不要再 float（避免套娃）；内层 `width:100%`。
4. `wrap` 缺省或 `none`：外层不要 float，保持今天通栏。
5. `<article>` 末尾加 `clear:both` 的空 div（`aria-hidden`），避免最后一块 float 撑不满高度。

### 试运行

`renderFlowArticle` 里块已经是 `reading` 的兄弟，不要再包一层。

- `wrap: left|right`：覆盖 `width` 为 `48%`，再设对应 float/margin（可抽小函数 `applyFlowDocumentWrap`）。
- `none` / omitted：保持 `width:100%` + 现有三档 maxWidth，`float:none`。
- 媒体与组件块都要做。
- `reading` 末尾 `clear:both`。

**不要删** `article.dataset.flowPaperScroll`、`wheel`/`pointer` 拖滚、`wideContentWidth`、`applyFlowBlockTypography`。

### 属性栏

`block.type === 'component'`：在上移/下移/转浮层按钮旁加 `data-testid="flow-component-wrap"` 的 SelectField（none/left/right），`updateFlowEditorBlock` 写 `wrap`。媒体下拉已有，不要改坏。用 fragment 包按钮行 + 下拉，保证 JSX 合法。

## 测试

`flowSurfaceHost.test.ts`（保留 G0 滚动、G3B paperSpace 跟滚）：

- wrap left 的 figure：`style.float === 'left'` **且** `style.width === '48%'`（不得仍是 `100%`）
- wrap right 同理
- omitted wrap：width 仍 `100%` 或现有通栏行为
- 在 wrap left 图后面紧跟一个 paragraph：figure 与 `p` 同为 `reading` 的子元素（兄弟），不是各困在通栏 wrapper 里

`flowWorkspace.test.tsx`：

- wrap left 媒体：`getByTestId('flow-block-…')` 外层框 `float:left` 且宽度 `48%`
- 不要删 G1E italic 同步、idle textAlign、G1A 拖拽单测
- 夹具 `assetId` 必须是项目里真实的图片 id（现有 G3B 测试若写了不存在的 `audio-1` 当 image，一并改成 `asset-image`）

## 最小验证

```bash
npx vitest run tests/unit/flowSurfaceHost.test.ts tests/unit/flowWorkspace.test.tsx
git diff --check
```

禁止 `npm test` / e2e / desktop / typecheck。
