# r12-040-background-authoring｜六 owner 背景编辑与共享常用色/连续调色闭环

- Release / Dependencies: 1.2 / none
- Write locks: `contracts-schema`, `store-slide`, `store-flow`, `store-spatial`, `store-course`, `props-shared`, `props-slide`, `props-flow`, `props-spatial`, `props-global`, `workspace-shell`, `authoring-slide`, `authoring-flow`, `authoring-spatial`, `published-slide`, `published-flow`, `published-spatial`, `published-producer`, `export-pptx`, `export-docx-print`, `diagnostics`
- Inventory access: none

## Outcome / current evidence

当前 additive 字段、effective-background resolver、六 owner UI、固定常用色板和稳定目标控件绑定已存在。[本地复审 F2、L4 / P2](../../reviews/1.2-local-review-2026-09-05.md) 确认真正剩余缺口：`onPreviewChange` 未接实际调用者；聚焦 HEX 后输入合法颜色，Esc 触发 blur，旧 draft 被误提交。按 [共享实施合同](IMPLEMENTATION_CONTRACT.md) §7.3 修复共享生命周期与真实 preview 接线，不重新建设色板、字段或背景继承。原生色盘连续拖动尚无本轮完整证据。

## Read first

- `src/renderer/ui/ColorInput.tsx` 及其实际调用者
- `src/renderer/ui/properties/SharedBackgroundProperties.tsx`
- `src/renderer/ui/properties/SharedShapeProperties.tsx`
- `src/renderer/ui/properties/PropertyControls.tsx`
- `src/renderer/composition/properties/usePropertiesAuthoringBinding.tsx`
- `src/renderer/ui/properties/FlowPropertiesContextBuilder.ts`
- `src/renderer/ui/properties/SpatialPropertiesContextBuilder.ts`
- `src/renderer/ui/DesignTokensEditor.tsx`
- `src/renderer/ui/workspaces/SlideLocationWorkspace.tsx`
- `src/renderer/ui/properties/SlideTableProperties.tsx`
- `src/renderer/ui/properties/SlideChartProperties.tsx`
- `tests/unit/colorInput.test.tsx`
- `src/shared/contracts/course-project-v9/types.ts`
- `src/shared/contracts/course-project-v9/schema.ts`
- `src/shared/contracts/published-course-v2/types.ts`
- `src/shared/contracts/published-course-v2/schema.ts`
- `src/shared/contracts/course-project-v9/assetReferences.ts`
- `src/renderer/course/effectiveLayerProjection.ts`
- `src/renderer/course/v9SlideContentCommands.ts`
- `src/renderer/course/flowSharedAuthoringAdapters.ts`
- `src/renderer/course/spatialEditorCommands.ts`
- `src/renderer/store/slices/courseStructureSlice.ts`
- `src/renderer/store/slices/slideAuthoringSlice.ts`
- `src/renderer/store/slices/flowAuthoringSlice.ts`
- `src/renderer/store/slices/spatialAuthoringSlice.ts`
- `src/renderer/export/course/buildPublishedCourse.ts`
- `src/player/surfaces/slide/SlidePublishedAdapter.ts`
- `src/player/surfaces/flow/FlowSurfaceHost.ts`
- `src/player/surfaces/spatial/SpatialSurfaceHost.ts`
- `src/renderer/ui/properties/SlideNativePropertiesPanel.tsx`
- `src/renderer/ui/properties/FlowPropertiesPanel.tsx`
- `src/renderer/ui/properties/SpatialPropertiesPanel.tsx`
- `src/renderer/ui/properties/CourseGlobalPropertiesPanel.tsx`
- `src/renderer/ui/properties/EmptyScenePropertiesPanel.tsx`
- `tests/unit/sceneStateUi.test.tsx`
- `tests/unit/spatialCanvasBackground.test.ts`
- `tests/unit/buildPublishedCourseV2.test.ts`

## Write scope

本轮只改 `ColorInput.tsx`、实际共享颜色 consumer（PropertyControls、SharedShape/Background、Slide/Table/Chart/Flow/Spatial/Global/EmptyScene properties、DesignTokensEditor）、`composition/properties/` 窄绑定、三 Surface 的现有 transient preview 接线/必要 host 清理及目标测试、局部样式。必要的最终提交仍走既有 owner command/slice，禁止逐帧写工程。已交付 contracts/resolver/导出/health 只读复用；若出现相关真实回归，再按本节点完整锁边界聚焦修复。禁止第二背景/预览工程 store、reserved-ID LayerItem、新主题 wire、渐变/平铺或无关 Surface 重构。

## Execution

当前修复只执行步骤 8–9 及其直接绑定/consumer 验证；步骤 1–7 是已交付背景合同的保全要求，输入未变时不重做或重跑。新证据若命中其中某一 Owner，只返回该具体边界修复，不从第一步重新开始。连续预览 adapter 不依赖尚未完成的 Table/Chart delivery；相关完整 UI 结果在候选前汇总。

1. 第一提交只落实施合同 §7.1 的字段、strict schema、Published matching fields、旧 fixture 与兼容反例；逐项证明旧 Scene、Flow、Spatial 的缺省视觉不变。
2. 在 shared course composition owner 实现唯一 resolver 与 table-driven precedence tests；resolver 输入只含 Course/surface/scene/state，输出 `{color,assetId,sourceOwner}`，素材解析留给 consumer。同步扩展 canonical asset-reference traversal，使每个新 background asset 进入保存、删除保护与 Published closure。
3. 为 Course、Slide surface、Slide scene、Slide named state、Flow surface、Spatial surface 分别提供 typed command。mode/颜色/素材一次提交一条历史，stale/missing asset/错 owner 零写入；State “继承”删除两个 override。
4. 在 shared properties owner 建一个无 Store 依赖的 Background owner/control view，六个 Properties adapter 传窄值与 typed callbacks；显示当前编辑 owner、继承/自有状态和 effective 来源。切 owner 只改变 UI selection，不写工程。Flow/Spatial 旧项目默认 own，Slide surface 默认 inherit。
5. Published producer 保留原始 owner 字段并用共享 resolver 产生 consumer 所需的 effective background；Slide/Flow/Spatial host、作者 preview 与单 HTML不得各写另一套 precedence。
6. PPTX 投影 page color/cover image；DOCX 投影 section/page color 与必要的 full-page image，表达差异定位 warning。missing asset 保留 color 并报错，不回退到下层 asset。
7. 对每个 owner 做设置→Undo→Redo→保存→重开→Published/导出用例，并覆盖 inherit 切换后保留 dormant own 值、State partial override 和旧 fixture。
8. 先增加 focus→合法 HEX→Esc→blur 的正式反例，用同步取消标记/等价的可靠生命周期阻止旧闭包提交；取消同时恢复 draft 和当前 target 的 transient preview。稳定目标身份与 revision 校验继续分离，失效/切目标/卸载时清理；不可用删除 blur、关闭 stale 校验或每次重挂载规避。
9. 把共享 preview 事件接到实际 consumer/owner adapter 与真实画布；连续变化仅更新非持久预览，完成一次 canonical commit，取消或无变化零历史，预设色/HEX 保持正常一次提交。Chart 已有整表草稿时只更新该草稿和相应预览，最终仍由“应用”提交。覆盖六背景 owner 和实际图形/文字/表格/图表入口，不以控件 mock callback 被调用代替真实接线，也不只修 Scene 背景。

## Stop conditions

- 旧 V9 在无新字段时视觉变化，或必须改变既有 Scene/State/Flow/Spatial 字段语义。
- 任一 consumer 只能靠 reserved layer ID、Store mirror 或私有 precedence 工作。
- 需要渐变、平铺、混合模式或新 Surface carrier 才能完成当前验收。
- PPTX/DOCX 只能静默忽略明确设置的背景。

## Acceptance

- 六个 owner 在可见 UI 中明确可选，写入不串层；继承算法与 effective 来源一致。
- Undo/Redo、保存重开、三 Surface Player/HTML、PPTX/DOCX 使用同一结果；旧 fixture 不变。
- 新字段严格、missing asset 可定位、无第二背景状态或 reserved-ID 背景对象。
- 所有实际共享取色入口有常用色与自定义取色；原生或自有色板连续变化不中断，修改回调到渲染期间控件身份保持，最终一次操作一条历史，Esc/目标切换零误写，Chart 数据草稿保持原事务边界。
- 聚焦 HEX 输入合法新色后 Esc→blur，工程值/revision/history 均不变；连续预览真实改变对应画布且未提交前工程不变，取消恢复画布，切目标不泄漏到新对象或新 owner。
- 真实 Renderer/Electron 执行一次连续拖动并完成、一条 Undo 恢复、取消、切换目标；配合六背景 owner 的参数化测试和实际侧栏截图。单次 change 写值通过不能替代这项操作验收。

## Focused validation

- `npx vitest run tests/unit/colorInput.test.tsx tests/unit/sceneStateUi.test.tsx tests/unit/flowNativeAuthoringParity.test.tsx tests/unit/spatialCanvasBackground.test.ts tests/unit/designTokens.test.tsx`
- `npx vitest run tests/unit/v9SlideProductIntegration.test.tsx tests/unit/backgroundStageCEndToEnd.test.ts tests/integration/mixedCrossSurfaceHistory.test.tsx`
- `npm run test:e2e -- tests/e2e/stabilizationCoreUsability.spec.ts tests/e2e/stabilizationFlowAuthoring.spec.ts`

## Rollback / handoff

本轮共享取消/preview 生命周期与真实 adapter 接线作为可审阅回滚单元，不能只留下新 callback 而无 consumer。向 `r12-050-native-closure` 交接合法 HEX 取消、真实连续预览/一次 Undo/切目标、六 owner 与 Chart 草稿证据；已有合同/resolver/导出证据在依赖未变时复用，只有实际受影响时补相应回归。
