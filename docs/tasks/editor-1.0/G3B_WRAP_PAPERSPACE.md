# G3B · wrap 绕排与 paperSpace 浮层跟滚

> 状态：**第二波/第三波**（等 G0B + G2A 合入；抢 `FlowSurfaceHost.ts` / `FlowWorkspace.tsx`）  
> 症状：G3 近 Word 绕排；内容浮层应能跟稿纸滚，控制器仍钉视口  
> 车道：G  
> 合同变化：否（字段已在 G2A）  
> 工人先读：[02_WORKER.md](02_WORKER.md)、[G0_FLOW_NEAR_WORD_PLAN.md](G0_FLOW_NEAR_WORD_PLAN.md)

## 一句话

`wrap: left|right` 让稿纸图/组件浮在文字一侧（缺省 none=今天通栏）。`paperSpace: 'paper'` 的内容浮层 `top` 随 `article.scrollTop` 走；省略或 `'viewport'` 钉 1280×720 孔。教师控制器即使误写 paper 也当 viewport（或属性栏不允许改控制器）。

## Git

从合入 G0B+G2A 的集成分支建 `cursor/g3b-wrap-paperspace-0ab9`。禁止开 PR。

## 允许修改

```text
src/player/surfaces/flow/FlowSurfaceHost.ts
src/renderer/ui/FlowWorkspace.tsx          仅 wrap CSS 与 overlay paper 位移；不要拆拖拽排序
src/renderer/ui/PropertiesTab.tsx          仅媒体/组件 wrap 下拉与浮层 paperSpace 下拉（若与 G2B 冲突则停手）
src/renderer/course/flowSharedAuthoringAdapters.ts  仅当转浮层默认 paperSpace 需要写 'paper'；控制器禁止 paper
tests/unit/flowSurfaceHost.test.ts
tests/unit/flowWorkspace.test.tsx
docs/tasks/editor-1.0/G3B_HANDOFF.md
```

## 禁止

- 改 Schema、改 `LayerFrame.mode`
- 把视口浮层默默重新解释成段落锚点
- Spatial 逛世界手势
- 同一路径 Read 第二次；全程最多 **8** 次 Read

## 逐步算法

### wrap

figure/component 块：

- `none` / omitted：`float: none`（现通栏 + 三档 maxWidth）
- `left`：`float: left; margin: 0 16px 8px 0`
- `right`：`float: right; margin: 0 0 8px 16px`

编辑态与试运行同一套。给父级 reading 加 `overflow: auto` 已存在则不要改坏。

### paperSpace

`#renderOverlay`：内容项（非 teacher-controller）若 `item.paperSpace === 'paper'`，定位 `top = frame.y - (this.#article?.scrollTop ?? 0)`。article `scroll` 事件里只更新 paper 项 top，不要写工程。

控制器：永远按 viewport 用 `frame.y + session.offset.dy`，忽略 paperSpace。

缺省 omitted = viewport（现有钉舞台）。

转浮层命令：内容 overlay 可写 `paperSpace: 'paper'`（新课更像 Word）；旧 convert 测试若断言整对象相等，补上字段或允许 optional。

## 测试

- wrap left 的 figure `style.float === 'left'`
- paper 浮层：把 article.scrollTop 设 100 后触发 scroll，该 overlay wrap 的 top 减少 100
- 控制器 top 不随 scrollTop 变
- omitted paperSpace 行为与今天一致（scroll 不移动）

## 最小验证

```bash
npx vitest run tests/unit/flowSurfaceHost.test.ts tests/unit/flowWorkspace.test.tsx
git diff --check
```
