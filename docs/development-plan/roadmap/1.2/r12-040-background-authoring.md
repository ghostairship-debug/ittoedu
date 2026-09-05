# r12-040-background-authoring｜六 owner 背景编辑与共享常用色/连续调色闭环

- Release / Dependencies: 1.2 / none
- Write locks: `contracts-schema`, `store-slide`, `store-flow`, `store-spatial`, `store-course`, `props-shared`, `props-slide`, `props-flow`, `props-spatial`, `props-global`, `authoring-slide`, `authoring-flow`, `authoring-spatial`, `published-slide`, `published-flow`, `published-spatial`, `published-producer`, `export-pptx`, `export-docx-print`, `diagnostics`
- Inventory access: none

## Outcome / current evidence

当前 additive 字段、共享 effective-background resolver 与六 owner UI 已存在，继续复用相关有效证据。2026-09-05 在原生色板单步调整颜色，确认背景组件因含 revision 的 key 被替换，弹层消失；共享 ColorInput 目前仅有原生连续色板和 HEX。按 [共享实施合同](IMPLEMENTATION_CONTRACT.md) §7 修复操作生命周期并补齐常用色，不重新实现已成立的字段/继承算法。

## Read first

- `src/renderer/ui/ColorInput.tsx` 及其实际调用者
- `src/renderer/ui/properties/SharedBackgroundProperties.tsx`
- `src/renderer/ui/properties/PropertyControls.tsx`
- `src/renderer/composition/properties/usePropertiesAuthoringBinding.tsx`
- `src/renderer/ui/properties/FlowPropertiesContextBuilder.ts`
- `src/renderer/ui/properties/SpatialPropertiesContextBuilder.ts`
- `src/renderer/ui/DesignTokensEditor.tsx`
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

允许修改背景 additive contracts/fixtures、一个共享 effective-background resolver、六个 owner 的 canonical commands/slices/properties、Published producer/hosts、PPTX/DOCX background projection、health 与现有目标测试。按执行顺序形成可独立审阅提交；禁止第二 background store、把背景伪装为 reserved-ID LayerItem、渐变/平铺或顺便重构无关 Surface。

## Execution

当前修复从步骤 3–4 的提交与控件生命周期开始；步骤 1–2 已成立且输入未变的证据继续有效。共享 ColorInput 及其实际 consumer、局部连续取色面板和对应样式纳入本节点 Write scope；不新增主题 wire 或改变数据颜色字段。

1. 第一提交只落实施合同 §7.1 的字段、strict schema、Published matching fields、旧 fixture 与兼容反例；逐项证明旧 Scene、Flow、Spatial 的缺省视觉不变。
2. 在 shared course composition owner 实现唯一 resolver 与 table-driven precedence tests；resolver 输入只含 Course/surface/scene/state，输出 `{color,assetId,sourceOwner}`，素材解析留给 consumer。同步扩展 canonical asset-reference traversal，使每个新 background asset 进入保存、删除保护与 Published closure。
3. 为 Course、Slide surface、Slide scene、Slide named state、Flow surface、Spatial surface 分别提供 typed command。mode/颜色/素材一次提交一条历史，stale/missing asset/错 owner 零写入；State “继承”删除两个 override。
4. 在 shared properties owner 建一个无 Store 依赖的 Background owner/control view，六个 Properties adapter 传窄值与 typed callbacks；显示当前编辑 owner、继承/自有状态和 effective 来源。切 owner 只改变 UI selection，不写工程。Flow/Spatial 旧项目默认 own，Slide surface 默认 inherit。
5. Published producer 保留原始 owner 字段并用共享 resolver 产生 consumer 所需的 effective background；Slide/Flow/Spatial host、作者 preview 与单 HTML不得各写另一套 precedence。
6. PPTX 投影 page color/cover image；DOCX 投影 section/page color 与必要的 full-page image，表达差异定位 warning。missing asset 保留 color 并报错，不回退到下层 asset。
7. 对每个 owner 做设置→Undo→Redo→保存→重开→Published/导出用例，并覆盖 inherit 切换后保留 dormant own 值、State partial override 和旧 fixture。
8. 按 §7.3 将稳定目标身份与 revision 校验分开；控件使用局部 draft/preview/final commit，目标变化或 Esc 清理草稿和预览。连续拖动期间组件不重挂载，不逐帧提交历史；预设色、HEX 与无变化的结束分别得到一条/一条/零条历史。
9. 同一控件提供固定常用色、自定义连续选色、HEX 和键盘操作，逐个迁移真实颜色入口；遇到 Chart 数据表等已有草稿，只更新原草稿，保持其最终“应用”事务。不得只修 Scene 背景而留下 Flow/Spatial 或其他共享调用者的同源问题。

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
- 真实 Renderer/Electron 执行一次连续拖动并完成、一条 Undo 恢复、取消、切换目标；配合六背景 owner 的参数化测试和实际侧栏截图。单次 change 写值通过不能替代这项操作验收。

## Focused validation

- `npx vitest run tests/unit/sceneStateUi.test.tsx tests/unit/flowNativeAuthoringParity.test.tsx tests/unit/spatialCanvasBackground.test.ts tests/unit/designTokens.test.tsx tests/integration/mixedCrossSurfaceHistory.test.tsx`
- `npx vitest run tests/unit/courseBackgroundCommands.test.ts tests/unit/effectiveBackground.test.ts tests/unit/courseProjectRoundTrip.test.ts tests/unit/backgroundStageCEndToEnd.test.ts`
- `npm run test:e2e -- tests/e2e/stabilizationCoreUsability.spec.ts tests/e2e/stabilizationFlowAuthoring.spec.ts`

## Rollback / handoff

合同+resolver 是第一回滚单元；每个 owner 的 command/UI/consumer 作为纵切回滚，但最终不能留下部分 owner 被另一 resolver 解释。交接 `r12-045-flow-docx-fidelity` / `r12-050-native-closure` 时附 precedence truth table、六 owner fixture、missing-asset 诊断和两类导出证据。
