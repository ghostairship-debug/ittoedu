# 关键事实证据索引

本文件供后续 AI 在 HEAD 漂移后按符号重新核对，不依赖固定行号。

| 事实 | 当前证据路径/符号 |
|---|---|
| main 文档提交与产品父提交 | branch main：`dbe518e`，parent `690411d`；dbe 同时刷新三份 ai-capabilities 生成物 |
| V9 project id/revision | `src/shared/contracts/course-project-v9/types.ts` → `CourseProjectDocument` |
| FlowComponentBlock | 同文件 → `FlowComponentBlock`, `FlowSurfaceDocument.blocks` |
| Spatial LayerItem carrier | 同文件 → `SpatialSurfaceDocument.world.layerItems` |
| LayerItem/global/surface | 同文件 → `LayerItem`, `ScopedLayerItem`, `globalLayerItems`, `surfaceLayerItems` |
| 当前 EditorMode | `src/renderer/store/editorStore.ts` → `EditorMode` |
| 多套 Store 状态 | 同文件 → `EditorState` |
| 活动 V9 selector | 同文件 → `selectActiveCourseProjectDocument` |
| 当前 resource history 基础 | `src/renderer/store/history.ts` → `HistoryEntry`, `AssetFileHistoryChange`, `ComponentPackageHistoryChange` |
| 当前 authoring identity | `src/renderer/authoring/courseAuthoringSession.ts` |
| exactly-one-active session 生命周期 | `src/renderer/store/editorStore.ts` → initial backend、applyV9/Flow/SpatialBackend、loadCourseProject |
| current scope owner | `src/renderer/authoring/courseAuthoringScope.ts` |
| V9 save snapshot | `src/renderer/App.tsx` → `currentCourseArchiveData`, `handleSave` |
| V2 publish sources | 同文件 → `activeCoursePublishSources` |
| HTML/Web/PPTX 双轨 | 同文件 → `buildHtml`, `handleExportWebPackage`, `handleExportPptx` |
| App 实时 V8 health | 同文件 → `collectProjectHealth(project, componentPackages)` |
| 当前简洁/专业 Tabs | `src/renderer/ui/RightSidebar.tsx` |
| DeveloperTab 能力 | `src/renderer/ui/DeveloperTab.tsx` |
| CoursePlayer | `src/player/surfaces/CoursePlayer.ts` |
| Surface Hosts | `src/player/surfaces/{flow,spatial}`, SlidePublishedAdapter |
| V2 producer | `src/renderer/export/course/buildPublishedCourse.ts` |
| Legacy producer | `src/renderer/export/buildExportPayload.ts`、`buildPublishedLesson.ts` |
| 现有 mount helper | `src/renderer/ui/serializedSessionMount.ts` |
| Recovery | `src/renderer/project/recoveryWriteCoordinator.ts` |
| contracts check | `scripts/generate-contracts.ts`, package `check:contracts` |
| ai capabilities check | `scripts/generate-ai-capabilities.ts`, package `check:ai-capabilities` |
| TypeScript 版本 | `package.json` → `typescript: 7.0.2` |
| repo-index 当前缺失 | main tree；`PROJECT_COGNITION_INDEX.md` 为人工 Bootstrap；旧 `0c12bb0` 可读但路径/状态已过期，只作参考 |
| read model/棘轮 | `src/renderer/course/read-model/index.ts`, `tests/unit/readModelBoundary.test.ts`, `editor10ForbiddenTokens.test.ts` |
| V9 软冻结与唯一计划 | `AGENTS.md`, `COURSEWARE_DEVELOPMENT_PLAN.md`, `docs/contracts/V9_COMPATIBILITY_POLICY.md` |
| 外部 Catalog 当前快照 | `artifacts/ai-capabilities/component-catalog.snapshot.json`；外部输入状态需每次基线重查 |

## 复核规则

- HEAD 改变后先查符号是否仍存在；
- 文件移动但符号语义相同，更新索引而不重写方案；
- persisted contract 或正式主路径变化时，才需要 ADR 和阶段重基线；
- 本索引是导航，不高于源码和合同。
