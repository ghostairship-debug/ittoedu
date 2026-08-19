# G0 流式讲义：先能读、再近 Word，不要解冻 V9

> 执行入口：[00_INDEX.md](00_INDEX.md) 车道 G。  
> 工人协议：[02_WORKER.md](02_WORKER.md) + 本轮 Git 后缀 **`-0ab9`**。  
> 来源：教师确认的产品计划原文「流式讲义：先能读、再近 Word，不要解冻 V9」。  
> 合同：G0/G1 **无**。G2/G3 只做一小包 additive，顶层 `.strict()` 不变。  
> 已合入、禁止重做：F1 闲置稿纸 `runs`、F2 块类型下拉 + 颜色从 runs 读、F3 稿纸公式属性栏。本车道把 F 里**降级/砍掉**的作者入口一并接上，不得再缩水。

## 产品选择（已锁定）

默认进文档流，也可以把对象提成浮层盖在正文上。与现有 V9（`blocks` + `surfaceLayerItems`）合得上，不必重做表面类型。

**不要解冻 Schema 再重开发、再软冻结。也不要进 V10。** 软冻结已允许 additive 可选字段；破坏性重解释才要 V10。全面解冻会把 Slide / Spatial / 冻结测试 / 合同生成一起拆开。没有教师 `accepted`、没有实质生产课，只说明可以大胆加可选字段、旧编辑器拒收新键也可以接受，不说明该把 `schemaVersion: 9` 推倒重来。

真正致命、且与合同无关：当前位置试运行和整课预览几乎滚不动稿纸。编辑态 `flow-workspace-scroll` 是 `overflow: auto`，所以「编辑还能往下翻，一切试运行就死」。

## 0. 先修阅读（Schema 影响：无）

合同已经写了：Flow 可以高于 720 并滚动；浮层钉在 1280×720 孔上。实现把孔做成了牢。

根因：

1. `PublishedCourseSession.syncActiveSlot` 对活动槽也设 `pointerEvents = 'none'`。子元素只有显式 `auto` 才能点（教师控制器因此还能拖）。稿纸 `article` 继承 `none`，滚轮/拖拽打不到滚动盒。
2. `FlowSurfaceHost` 根节点锁死 1280×720 + `overflow: hidden`；文章虽是 `height: 100%; overflow: auto`，但接不到指针。
3. `.flow-try-run-host` / `.canvas-viewport` 也是 `overflow: hidden`。整课预览同一套 CoursePlayer。导出包 CSS 同样要修槽位命中。

「拖拽画布」在无限画布是会话相机；流式讲义应对齐 Word：滚轮/触控板滚稿纸，空白处可拖动画布滚动。不要做成 Spatial 那种逛世界。

最小修法：

- 活动 surface 槽恢复 `pointer-events: auto`；未活动槽保持 `none`。
- 稿纸 `article` 明确 `pointer-events: auto`、`overflow: auto`、`overscroll-behavior: contain`；浮层层继续 `none`，卡片/控制器/视频 `auto`。
- 试运行/预览加稿纸拖拽滚动（不写工程）。jsdom 不会原生滚动，必须自己把 `wheel` / 拖拽写到 `article.scrollTop`。
- 单测：长文 `article.scrollHeight > clientHeight`，wheel 后 `scrollTop` 变化；控制器仍可点。

**这一条不过，后面排版做了教师也验收不了。G0 可单独合 main。**

## 1. 产品模型（hybrid，不改表面类型）

```text
稿纸文档流（默认）          视口/稿纸浮层（可选「提出」）
heading / paragraph   →    只盖在正文上，不进课程树
media / component     →    图、视频、组件、形状
formula / table / list
顺序 = Word 里上下移动段落
```

文档块不是必须，但是默认。点「图片/视频/组件/文本」先插入稿纸流；Alt 或「作为浮层」才盖在正文上。插入路径已有（`insertFlowSharedMedia` 的 `document-block` vs `viewport-overlay`）。

位置关系先做「流内顺序」，再做「盖在上面」。`moveFlowEditorBlock` / `reorderFlowEditorBlock` 已有，稿纸几乎没把手。浮层已能拖缩放。缺：块拖拽排序、块↔浮层来回转换的作者入口、浮层随稿纸滚动。

图层树：不要把每个段落变成 z-order 行。加一行虚拟「正文」（不新增持久化字段），下面只列浮层。文字整体算一层。

不要把流式页做成会滚动的演示页（每个字一个 x/y 框）。

## 2. 作者能力：接线，不是换模型

命令层已经有、UI 没露出或露出得不像 Word：

- 插入段落 / 媒体块 / 公式 / 组件
- 块上移下移、缩进（缩进仍不是标题层级）
- 媒体三档宽度、alt/caption、替换文件
- 媒体块 → 浮层（`convertFlowMediaBlockToOverlay`）与浮层 → 正文（`convertFlowOverlayMediaToDocument`）；组件同样有 convert
- 浮层拖缩放
- 选区粗斜体颜色（runs）—— **F1/F2 已合入，禁止回退**

最快可见增量（G1，尽量 0 Schema）：

- 稿纸块拖到另一块前后（调用已有 `move`）
- 选中图/视频/组件：「上移 / 下移 / 转为浮层 / 转回正文」
- 三档宽度在**编辑和试运行**都要看得出
- 块类型下拉继续管结构（H1–H6/段落/**引用**），不要再冒充字号；F2 把 quote 做成只读选项，本车道必须变成真 `convert-quote`
- 浮层公式也能在属性栏编（F3 只接了稿纸块）
- 就地编辑时属性栏 `flowTextEdit` 同步回 `FlowWorkspace` 本地 draft（F0 当时「单独开卡」，不得再砍）

G2 UI：属性栏字体控件复用演示页 `FontFamilyPicker` 的**外观**，接到 Token 缺省 + additive 字段，不要复制一套。

## 3. Schema：一小包 additive，保持软冻结

顶层 `.strict()` 不变。已有判别器、`LayerFrame.mode: 'absolute'`、location/owner、统一图层排序不改语义。

单独合同提交（G2A 一次打包 G2+G3 字段，**不要混进滚动 bugfix**）：

| 字段 | 放哪 | 缺省（旧课） | 做什么 |
|---|---|---|---|
| `fontFamily?` `fontSize?` | `TextRunStyle`（Flow runs 与演示页 run 同源类型） | 继承稿纸/Token | 真能选字体字号 |
| `textAlign?` `lineSpacing?` | 可选，挂在 heading/paragraph/quote 块上 | 左对齐 / 浏览器默认 | 段级排版 |
| `wrap?: 'none' \| 'left' \| 'right'` | `FlowMediaBlock` / 稿纸 component 块 | `none`（现有通栏） | 图在文字左/右，近 Word 绕排 |
| `paperSpace?: 'viewport' \| 'paper'` | 图层可选键（LayerItemBase + Published 同源） | `'viewport'`（现有钉舞台） | 内容浮层随稿纸滚；控制器保持 viewport |

这些都是「新键可选、缺了等于今天」。旧编辑器因 `.strict()` 打不开新课——兼容政策已经允许。

**不要做、那才叫解冻/V10：**

- 把 blocks 改成图层数组，或让每个 paragraph 变成 NativeLayerItem
- 改 `LayerFrame.mode` 的唯一字面量、改 owner / 统一排序
- 第四种 surface、持久化 `projectMode`
- 把视口浮层重新解释成「相对段落锚定」而不加新键（旧课控制器会飞）

`designTokens.fonts` 已存在，改 Token 不会自动重排已有段落；仍须写到块/runs。

## 4. 分批（最优最快）与并行图

```text
第一波（无共同实现文件，从 origin/cursor/flow-near-word-g-0ab9 分树）：
  G0A  活动槽 pointer-events auto     publishedDynamicHosts.ts
  G0B  稿纸滚动 + 拖拽 + 试运行三档宽度   FlowSurfaceHost.ts
  G0C  试运行/导出 CSS                 globals.css + COURSE_PLAYER_CSS
  G1A  稿纸块拖拽排序 + 编辑态三档宽度   FlowWorkspace.tsx
  G1B  上移下移/转浮层/引用/浮层公式     PropertiesTab + convert-quote
  G1C  图层虚拟「正文」行               NodesTab.tsx
  G2A  G2+G3 additive 合同             contracts + generate:contracts

第二波（等第一波合入，文件冲突）：
  G1E  flowTextEdit ↔ 稿纸 draft      FlowWorkspace.tsx
  G2B  FontFamilyPicker 接 Flow       PropertiesTab.tsx（合同已在）
  G3B  wrap 绘制 + paperSpace 跟滚     FlowSurfaceHost + FlowWorkspace
```

G0 可单独合 main。G2/G3 **合同与 UI 仍分开提交**。

父代理只合入与复检。工人禁止开 PR。

## 5. 明确不做

- 不解冻 V9，不开 V10，不重写 `editorStore` / 整页编辑器
- 不做 Word 分节/目录/脚注/页眉页脚
- 不把 paragraph 推进课程树（树仍是 heading/section）
- 不把试运行打回 Phaser
- 不宣称 `accepted`
- 不重做 F1–F3 / P1–P8 / Q1–Q8 / T0–T6

## 关键文件

- 滚动：`src/player/surfaces/publishedDynamicHosts.ts`、`src/player/surfaces/flow/FlowSurfaceHost.ts`、`src/renderer/styles/globals.css`、`src/renderer/export/course/buildCoursePackages.ts`
- 已有命令：`src/renderer/course/flowEditorCommands.ts`、`src/renderer/course/flowSharedAuthoringAdapters.ts`
- 作者面：`src/renderer/ui/FlowWorkspace.tsx`、`src/renderer/ui/PropertiesTab.tsx`、`src/renderer/ui/NodesTab.tsx`
- 合同：`src/shared/contracts/course-project-v9/`、`docs/contracts/V9_COMPATIBILITY_POLICY.md`

## 验证

每卡只跑自己的「最小验证」+ `git diff --check`。禁止 `npm test` / e2e / desktop。G2A 因改了 `TextRunStyle` 允许 `npm run typecheck`。

父代理合入第一波后复跑：

```bash
npx vitest run tests/unit/flowSurfaceHost.test.ts tests/unit/publishedCourseNavigation.test.ts tests/unit/flowWorkspace.test.tsx tests/unit/flowProductIntegration.test.tsx tests/unit/flowUnifiedLayerEntry.test.tsx tests/unit/flowEditorCommands.test.ts tests/unit/courseProjectCoreContract.test.ts tests/unit/flowTryRunCss.test.ts
git diff --check
```
