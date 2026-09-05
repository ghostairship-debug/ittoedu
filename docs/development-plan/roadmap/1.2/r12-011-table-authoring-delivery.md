# r12-011-table-authoring-delivery｜Table 编辑 UI、键盘路径、保存重开、Player、HTML 与原生 PPTX 闭环

- Release / Dependencies: 1.2 / r12-010-table-core, r12-008-native-authoring-transport
- Write locks: `props-slide`, `props-shared`, `authoring-slide`, `published-slide`, `export-pptx`
- Inventory access: none

## Outcome / current evidence

当前已存在 Table commands、可见入口和 renderer。[本地复审 L5、L6 / P2](../../reviews/1.2-local-review-2026-09-05.md) 确认末格编辑后 Tab 只保存文本、追加行因旧 revision 失败，以及正式 painter 忽略部分填充/边框透明度。L1 增量同步由 `r12-008-native-authoring-transport`、L2/L3 owner/state 与 L5 复合命令由 `r12-010-table-core` 先闭合；本节点按 [共享实施合同](IMPLEMENTATION_CONTRACT.md) §2.2/§2.3/§3 完成真实 UI/painter/保存/导出验收。

## Read first

- `src/renderer/ui/properties/SlideNativePropertiesPanel.tsx`
- `src/renderer/ui/properties/SlideTableProperties.tsx`
- `src/renderer/composition/properties/usePropertiesAuthoringBinding.tsx`
- `src/renderer/course/v9TableCommands.ts`
- `src/shared/nativeTableLayout.ts`
- `src/renderer/course/v9SlideContentCommands.ts`
- `src/player/surfaces/slide/publishedNativeRendering.ts`
- `src/player/surfaces/slide/SlidePublishedAdapter.ts`
- `src/renderer/export/course/buildCoursePptx.ts`
- `src/renderer/export/course/pptxTableAndChart.ts`
- `tests/unit/nativeTableLayout.test.ts`
- `tests/unit/v9SlideProductIntegration.test.tsx`
- `tests/unit/buildPublishedCourseV2.test.ts`
- `tests/unit/coursePptxExport.test.ts`
- `tests/e2e/stabilizationCoreUsability.spec.ts`

## Write scope

允许修改 `SlideTableProperties.tsx`、`SlideNativePropertiesPanel.tsx`、`usePropertiesAuthoringBinding.tsx` 的 Table 窄接线、`nativeTableLayout.ts`、Published Slide painter/adapter、PPTX Table projection 及现有目标测试。局部 cell draft 只暂存未提交输入，不构成第二工程真相；禁止修改 Schema/core command、取消 stale 检查或为 Flow/Spatial/global 加入口。复合命令不足时返回 Table core，transport 缺陷返回共同节点。

## Execution

1. 在 Slide 可见插入入口创建 Table，选中后显示结构、尺寸、基础样式与 cell override 编辑器；所有 commit 调 `r12-010-table-core` command。
2. cell 编辑使用局部 draft；Enter/Tab 提交并前进，Shift+Tab 后退，Esc 取消，IME composing 不提交。末格 Tab 调 core 的复合命令，一次提交文本+追加行；禁止先 commit 再用旧绑定 append，防止 blur 重复提交。焦点落到新增行首格，失败保持可恢复草稿且无半成品。
3. 键盘和按钮完成行列插入/删除/重排；focus 以 rowId+columnId 恢复，操作后不得依赖旧数组下标。
4. 作者画布和 Published renderer 复用同一纯 layout/view model；将 effective fillOpacity/borderOpacity 分别投影到 CSS alpha，不使用整个 td opacity。覆盖 0、0.5、1 与 cell override/继承，文字 alpha 不变；保全 resize、header 和高 DPI 行为。
5. 保存重开后从 V9 重建 UI，Player 与单 HTML从 Published 数据渲染；不得从作者 DOM 截图。
6. PPTX 用原生 table primitive 投影 cell 文本、尺寸、边框、填充、字体与对齐；无法表达的细节有定位 warning，不降整表图片。

## Stop conditions

- UI 需要修改合同或在 React 内保存第二份 rows/cells 才能编辑。
- Published 与 authoring 无法共用布局输入，或 PPTX 只能用截图/静默遗漏。
- IME、Tab focus 或 blur 无法做到一次明确提交一条历史。

## Acceptance

- 只用可见 UI 完成创建、cell 编辑、键盘移格、行列增删重排、宽高与样式修改；插入后真实作者态初始快照和后续修改均收到 ACK，画布持续可操作，保存重开后仍能继续编辑。不得用仅构建 Published payload 或 mock host 代替此项。
- Undo/Redo、保存重开、Player、单 HTML 保持值、结构、尺寸、样式和 ID。
- 真实 UI 在 base、两个 named state 与合法 Slide surface 分别编辑并切换，内容不串状态/owner，画布增量即时显示；末格输入后 Tab 新增一行，无 stale 提示，一次 Undo 同时恢复文本与行数，焦点按稳定 ID 恢复。
- 正式 painter 与真实作者/Player 中填充和边框透明度分别生效，0 不绘制、0.5 部分透明、1 不透明，文字不被整体淡化。PPTX 填充保留现有支持，边框透明度差异继续明示，不以整表截图降级。
- PPTX 中为原生可编辑表格；已知样式差异通过 preflight 明示。

## Focused validation

- `npm run test:product -- tests/unit/nativeTableLayout.test.ts tests/unit/v9SlideProductIntegration.test.tsx tests/unit/buildPublishedCourseV2.test.ts`
- `npm run test:product -- tests/unit/coursePptxExport.test.ts tests/unit/courseSlidePreflightParity.test.ts`
- `npm run test:e2e -- tests/e2e/stabilizationCoreUsability.spec.ts`

## Rollback / handoff

按 UI→shared view→Published→PPTX 纵切回滚，不能留下仅作者态可见或导出丢失的 Table。交接 `r12-050-native-closure` 时附 L2/L3 的实际 UI/保存往返、L5 末格单事务/焦点、L6 alpha 正式 painter 与浏览器证据，以及 PPTX 原生 table 证据；不用受 L1 干扰的旧截图单独证明透明度。
