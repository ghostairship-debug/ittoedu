# 任务卡模板

> 只在多执行者协调、重叠写入风险、跨会话恢复、明确交接或真实阻断时建卡。单执行者、单会话工作不建卡；敏感变更本身也不自动建卡。
>
> 完成后删除卡并重新生成任务板。完成事实由实质 diff / commit 和检查结果承载，不设 done 状态。

固定六项字段：

```markdown
# <task-id> <标题>

- Status / Owner: queued | active | blocked / <active 必须填写唯一写入者>
- Outcome / Evidence: <一个可观察结果 + 当前失败或启动证据>
- Write scope: <允许写入的精确路径；需要时补禁止路径、越界停止条件或 baseline>
- Write locks: none | contracts-schema | generated-index | legacy-inventory | store-kernel | store-slide | store-flow | store-spatial | store-course | props-shared | props-slide | props-flow | props-spatial | props-global | workspace-shell | authoring-slide | authoring-flow | authoring-spatial | authoring-interaction | authoring-recipe | published-slide | published-flow | published-spatial | published-interaction | published-dynamic | published-producer | export-pptx | export-docx-print | app-save-recovery | diagnostics | main-preload | cli-adapters | ai-session | mcp-server | chat-ui
- Acceptance: <完成后可直接判断的结果>
- Validation: <最多 1–3 条直接证明结果的命令或人工检查；敏感变更在这里写明真实 carrier / fixture / 回退检查>
```

约定：

- `queued` 表示已经可以开始，`active` 表示有唯一 writer，`blocked` 必须在 `Outcome / Evidence` 中写明阻断原因、解除条件和下一决策者；未来占位任务不建卡。
- `Write locks` 可用逗号列多个固定标签；非共享写入写 `none`。同一标签不能同时出现在两张 active 卡上。
- 给较弱模型或跨会话交接时，必须写出当前证据、允许路径、越界停止条件、确定结果和精确检查；不增加风险等级、预算、Reviewer、Ready checklist 或 Evidence 表单。
- 文件放在 `docs/development-plan/tasks/<wave>/<task-id>.md`，task-id 使用小写稳定 ID。
- 任务板由 `npm run generate:task-board` 生成，只在任务集合实质变化时更新。

## 写锁边界

| 写锁 | 当前覆盖的 Owner / 路径 |
|---|---|
| `none` | 无共享写入 |
| `contracts-schema` | `src/shared/contracts/**`、`src/shared/assessmentEvaluators.ts` 中的合同共享归一化、`docs/contracts/**`、`artifacts/contracts/**` 与对应 contract fixture |
| `generated-index` | `artifacts/ai-capabilities/**`、`scripts/generate-ai-capabilities.ts` |
| `legacy-inventory` | `inventories/legacy-consumers.json` |
| `store-kernel` | `src/renderer/store/editorStore.ts`、`editorStoreKernel.ts`、`history.ts`、`slideBackendPort.ts`、`slideEditorProjection.ts`、`v9LayerMutations.ts` |
| `store-slide` | `src/renderer/store/slices/slideAuthoringSlice.ts`、`slices/slideOwnedCommands.ts` |
| `store-flow` | `src/renderer/store/slices/flowAuthoringSlice.ts` |
| `store-spatial` | `src/renderer/store/slices/spatialAuthoringSlice.ts` |
| `store-course` | `src/renderer/store/slices/courseLifecycleSlice.ts`、`courseStructureSlice.ts`、`editorShellSlice.ts`、`courseResourceState.ts`、`src/shared/effectiveBackground.ts` |
| `props-shared` | `src/renderer/ui/ColorInput.tsx`、`DesignTokensEditor.tsx`、`src/renderer/ui/properties/PropertyControls.tsx`、`SharedShapeProperties.tsx`、`SharedBackgroundProperties.tsx`、`propertiesItemView.ts`、`PropertiesPanelRouter.tsx`、`PropertiesContext*.ts(x)`、`src/renderer/composition/properties/**` |
| `props-slide` | `SlideNativePropertiesPanel.tsx`、`SlideTableProperties.tsx`、`SlideChartProperties.tsx`、`MultiSelectionPropertiesPanel.tsx`、`RuntimePropertiesPanel.tsx`、`RuntimePropertiesContextBuilder.ts` |
| `props-flow` | `FlowPropertiesPanel.tsx`、`FlowPropertiesContextBuilder.ts`、`FlowSpatialInteractionUnavailableSection.tsx` |
| `props-spatial` | `SpatialPropertiesPanel.tsx`、`SpatialPropertiesContextBuilder.ts` |
| `props-global` | `CourseGlobalPropertiesPanel.tsx`、`EmptyScenePropertiesPanel.tsx` |
| `workspace-shell` | `src/renderer/ui/Workspace.tsx`、`ui/workspaces/**`、`ElementsTab.tsx`、`TopToolbar.tsx`、`RightSidebar.tsx`、`src/renderer/styles/globals.css`、`src/renderer/composition/surfaceRouter.ts`、`crossSurfaceCommands.ts` |
| `authoring-slide` | `src/renderer/course/v9SlideContentCommands.ts`、`v9TableCommands.ts`、`v9ChartCommands.ts`、`v9SlideClipboard.ts`、`slideAuthoringBackend.ts`、`effectiveLayerCommands.ts`、`v9MediaAudioCommands.ts`、`src/renderer/project/nativeNodeFactories.ts`、`src/shared/playerAuthoringProtocol.ts`、`src/shared/nativeTableLayout.ts`、`src/shared/nativeChartView.ts`、`src/shared/nativeLineGeometry.ts` |
| `authoring-flow` | `src/renderer/course/flowSharedAuthoringAdapters.ts`、`src/renderer/authoring/flowTextEdit.ts`、`flowOverlayAuthoring.ts` |
| `authoring-spatial` | `src/renderer/course/spatialEditorCommands.ts`、`src/renderer/authoring/spatialWorldAuthoring.ts` |
| `authoring-interaction` | `src/renderer/ui/InteractionEditor.tsx`、`src/renderer/interactions/**`、`src/renderer/course/courseLogicAuthoringCommands.ts` |
| `authoring-recipe` | 1.3 配方定义 Owner；首个节点创建目录时在写入前回填精确路径 |
| `published-slide` | `src/player/surfaces/slide/**` |
| `published-flow` | `src/player/surfaces/flow/**` |
| `published-spatial` | `src/player/surfaces/spatial/**` |
| `published-interaction` | `src/player/interactions/**`、`src/player/CourseStateStore.ts`、`src/player/InteractionEngine.ts`、`src/player/surfaces/publishedCourseState.ts` |
| `published-dynamic` | `src/player/surfaces/publishedDynamicHosts.ts` 与 Component / Runtime registry |
| `published-producer` | `src/renderer/export/course/buildPublishedCourse.ts`、`buildCoursePackages.ts` |
| `export-pptx` | `src/renderer/export/course/buildCoursePptx.ts`、`pptxTableAndChart.ts`、`pptxTextAndShape.ts`、`renderPptx*` |
| `export-docx-print` | `src/renderer/export/course/flowDocx.ts`、`flowDocxProjection.ts`、`flowPrintPlan.ts`、`buildCoursePrintArtifacts.ts` |
| `app-save-recovery` | `src/renderer/app/useCourseDelivery.ts`、`src/renderer/project/courseProjectArchive.ts` 与保存 / 恢复路径 |
| `diagnostics` | `src/shared/courseProjectHealth.ts`、`src/shared/courseProjectHealth/**`、`src/renderer/diagnostics/**` |
| `main-preload` | `src/main/**`、`src/preload/**` |
| `cli-adapters` | 1.6 起 CLI adapter 与启动器 Owner；首个节点创建目录时在写入前回填精确路径 |
| `ai-session` | 1.6 起本地会话、staging 与准入 Owner；首个节点创建目录时在写入前回填精确路径 |
| `mcp-server` | 1.8 起 MCP Authoring Server Owner；首个节点创建目录时在写入前回填精确路径 |
| `chat-ui` | 1.9 起 Chat shell、timeline 与引用选择 Owner；首个节点创建目录时在写入前回填精确路径 |

同锁绝对互斥。路线中每个节点必须预先列出完整锁名；对于尚未创建的未来模块，当前确定的是 Owner 锁和节点映射，不虚构不存在的精确文件路径。首个写入节点须先回填路径边界并同步校验器，不能另造锁名或在任务卡中临时换锁。
