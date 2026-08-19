# G0B · 试运行稿纸可滚可拖，控制器仍可点

> 状态：**可领取**  
> 症状：G0 `FlowSurfaceHost` 把 1280×720 做成牢；article 有 overflow:auto 但接不到指针  
> 车道：G  
> 合同变化：无  
> 工人先读：[02_WORKER.md](02_WORKER.md)、[G0_FLOW_NEAR_WORD_PLAN.md](G0_FLOW_NEAR_WORD_PLAN.md)

## 一句话

运行态稿纸 `article` 明确可点、可滚、空白处可拖着滚；浮层层仍 `none`，控制器/视频/卡片仍 `auto`。jsdom 不会原生滚动，必须自己写 `wheel` / 拖拽到 `scrollTop`。试运行媒体三档宽度要看得出。不要做成 Spatial 逛世界。

## Git

1. 只用本 worker isolated worktree。
2. `git fetch origin cursor/flow-near-word-g-0ab9`
3. 从该分支建 `cursor/g0b-paper-scroll-0ab9`
4. push。**禁止开 PR。**
5. 写 `docs/tasks/editor-1.0/G0B_HANDOFF.md`

## 允许修改

```text
src/player/surfaces/flow/FlowSurfaceHost.ts
tests/unit/flowSurfaceHost.test.ts
docs/tasks/editor-1.0/G0B_HANDOFF.md
```

## 禁止

- `publishedDynamicHosts.ts`、`globals.css`、`editorStore.ts`、`FlowWorkspace.tsx`
- 改根节点成可以逛的无限世界（不要改成 Spatial pan/zoom 写相机）
- 把 overlay 整层改成 auto
- 改 V9 字段
- 无 offset 整文件 Read `FlowSurfaceHost.ts`（约 929 行）
- `npm test` / typecheck / e2e
- 同一路径 Read 第二次；全程最多 **8** 次 Read

## 基线（合计 ≤3 次 Read）

1. `rg -n "renderFlowArticle|overflow = 'hidden'|pointerEvents" src/player/surfaces/flow/FlowSurfaceHost.ts` → Read `renderFlowArticle` 一段（约 651–687）和 `mount` 里 root/overlay 样式（约 150–178）。
2. Read `case 'media'`（约 751–781）。
3. Read `tests/unit/flowSurfaceHost.test.ts` 末尾 `describe` 附近 offset≈380 limit≈50，看 `mountHost` / 控制器 next 用例。现有 TOC、导航、组件挂载用例必须保持绿。

root 可以继续 `width/height = 1280×720`（孔还在）。overflow hidden 可以留在 root 上，**滚动盒是 article**。

## 逐步算法

### A. article 命中与滚动

在 `renderFlowArticle` 创建 article 后立刻：

```ts
article.style.pointerEvents = 'auto'
article.style.overflow = 'auto'
article.style.overscrollBehavior = 'contain'
article.dataset.flowPaperScroll = 'true'
```

`reading` 不要 `pointer-events: none`。

### B. wheel + 空白拖拽（必须，jsdom 依赖）

在同一函数给 article 绑监听（不要新文件）：

1. `wheel`：`article.scrollTop += event.deltaY`（可 clamp 到 `[0, max(0, scrollHeight - clientHeight)]`）。`preventDefault` 仅当确实在滚。`{ passive: false }`。
2. 空白拖拽：`pointerdown` 主按钮，若 `event.target` 是 `video, audio, button, a, input, textarea, [data-flow-interactive]` 或其内部 → return。否则记录 `startY` / `startScroll`，`setPointerCapture`，`pointermove` 设 `article.scrollTop = startScroll - (clientY - startY)`，`pointerup/cancel` 结束。这是会话滚动，**不写工程**。

overlay 继续 `pointerEvents = 'none'`。`#mountTeacherController` 的 frame 已是 auto，不要改坏。`renderStaticOverlayItem` 里 video wrap 已是 auto，不要改坏。

### C. 试运行三档宽度（不得降级）

`case 'media'` 的 figure：

```ts
figure.dataset.flowMediaLayout = block.layout
const readingWidth = options.readingWidth ?? 760
const wideWidth = options.playback.surfaces.find(...)?.layout.wideContentWidth
  ?? Math.round(readingWidth * 1.4)
if (block.layout === 'content-width') figure.style.maxWidth = `${readingWidth}px`
if (block.layout === 'wide') figure.style.maxWidth = `${wideWidth}px`
if (block.layout === 'full-width') figure.style.maxWidth = '100%'
figure.style.width = '100%'
figure.style.margin = '0 auto'
```

把 `wideContentWidth` 放进 `renderFlowArticle` 传给 `renderBlockDom` 的 options（不要猜数字硬编码两套）。img/video `maxWidth: 100%`。

## 测试

在 `flowSurfaceHost.test.ts` 追加 describe，不要删旧 it。长文：复制 `flowSurface()` 后把 `blocks` 换成 1 个 heading + **40** 段 `paragraph`（每段至少 80 字）。`mountHost` 后：

```ts
const article = container.querySelector<HTMLElement>('[data-testid="flow-runtime-article"]')!
expect(article.style.pointerEvents).toBe('auto')
expect(article.style.overflow).toBe('auto')
Object.defineProperty(article, 'clientHeight', { configurable: true, value: 720 })
Object.defineProperty(article, 'scrollHeight', { configurable: true, value: 4000 })
let top = 0
Object.defineProperty(article, 'scrollTop', {
  configurable: true,
  get: () => top,
  set: (value) => { top = Number(value) },
})
expect(article.scrollHeight).toBeGreaterThan(article.clientHeight)
article.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }))
expect(top).toBeGreaterThan(0)
```

再断言：同一 fixture 若含 `teacherController()` overlay（沿用文件里已有 helper），`[data-testid="flow-runtime-teacher-controller"]` 的 `pointerEvents` 为 `auto`，且 next 按钮仍 `click` 得到 `scene.next`（复制现有控制器用例的 click 断言，不要弱化）。

再加一条：media `layout: 'wide'` 的 figure `data-flow-media-layout="wide"` 且 `style.maxWidth` 等于 surface `wideContentWidth` px。

## 最小验证

```bash
npx vitest run tests/unit/flowSurfaceHost.test.ts
git diff --check
```

## Gate

- wheel 后 scrollTop 变
- 控制器可点
- wide 布局看得出
- 未改 publishedDynamicHosts

## 停手

必须改 CSS 文件或槽位 pointerEvents → 停（那是 G0C / G0A）。
