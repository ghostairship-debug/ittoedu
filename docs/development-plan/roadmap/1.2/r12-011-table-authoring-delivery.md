# r12-011-table-authoring-delivery｜Table 编辑 UI、键盘路径、保存重开、Player、HTML 与原生 PPTX 闭环

- Release / Dependencies: 1.2 / r12-010-table-core, r12-008-native-authoring-transport
- Write locks: `props-slide`, `authoring-slide`, `published-slide`, `export-pptx`
- Inventory access: none

## Outcome / current evidence

当前已存在 Table commands、可见入口和 renderer；2026-09-05 确认完整节点被共同 authoring parser/guard 拒绝。共同接线由 `r12-008-native-authoring-transport` 修复，本节点依照 [共享实施合同](IMPLEMENTATION_CONTRACT.md) §2.2/§3 闭合真实 UI、保存与导出，不从头重建已通过的 core。

## Read first

- `src/renderer/ui/properties/SlideNativePropertiesPanel.tsx`
- `src/renderer/course/v9SlideContentCommands.ts`
- `src/player/surfaces/slide/publishedNativeRendering.ts`
- `src/player/surfaces/slide/SlidePublishedAdapter.ts`
- `src/renderer/export/course/buildCoursePptx.ts`
- `tests/unit/v9SlideProductIntegration.test.tsx`
- `tests/unit/buildPublishedCourseV2.test.ts`
- `tests/unit/coursePptxExport.test.ts`
- `tests/e2e/stabilizationCoreUsability.spec.ts`

## Write scope

允许修改 Slide 插入/选择接线、Table properties/editor、共享 table layout view、Published Slide renderer、PPTX projection 与现有目标测试。禁止复制 table 数据到 React state、改变合同/command、不经确认在 blur 时提交脏 draft，或为 Flow/Spatial/global 加入口。

## Execution

1. 在 Slide 可见插入入口创建 Table，选中后显示结构、尺寸、基础样式与 cell override 编辑器；所有 commit 调 `r12-010-table-core` command。
2. cell 编辑使用局部 draft；Enter/Tab 提交并前进，Shift+Tab 后退，Esc 取消，IME composing 不提交。最后单元格 Tab 可按明确 UI 动作追加行，一笔事务。
3. 键盘和按钮完成行列插入/删除/重排；focus 以 rowId+columnId 恢复，操作后不得依赖旧数组下标。
4. 作者画布和 Published renderer 复用同一纯 layout/view model；对 resize、header、cell override 与高 DPI 增加确定性用例。
5. 保存重开后从 V9 重建 UI，Player 与单 HTML从 Published 数据渲染；不得从作者 DOM 截图。
6. PPTX 用原生 table primitive 投影 cell 文本、尺寸、边框、填充、字体与对齐；无法表达的细节有定位 warning，不降整表图片。

## Stop conditions

- UI 需要修改合同或在 React 内保存第二份 rows/cells 才能编辑。
- Published 与 authoring 无法共用布局输入，或 PPTX 只能用截图/静默遗漏。
- IME、Tab focus 或 blur 无法做到一次明确提交一条历史。

## Acceptance

- 只用可见 UI 完成创建、cell 编辑、键盘移格、行列增删重排、宽高与样式修改；插入后真实作者态初始快照和后续修改均收到 ACK，画布持续可操作，保存重开后仍能继续编辑。不得用仅构建 Published payload 或 mock host 代替此项。
- Undo/Redo、保存重开、Player、单 HTML 保持值、结构、尺寸、样式和 ID。
- PPTX 中为原生可编辑表格；已知样式差异通过 preflight 明示。

## Focused validation

- `npm run test:product -- tests/unit/v9SlideProductIntegration.test.tsx tests/unit/buildPublishedCourseV2.test.ts`
- `npm run test:product -- tests/unit/coursePptxExport.test.ts tests/unit/courseSlidePreflightParity.test.ts`
- `npm run test:e2e -- tests/e2e/stabilizationCoreUsability.spec.ts`

## Rollback / handoff

按 UI→shared view→Published→PPTX 纵切回滚，不能留下仅作者态可见或导出丢失的 Table。交接 `r12-050-native-closure` 时附保存重开 fixture、键盘路径和解包 PPTX 原生 table 证据。
