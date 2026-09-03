# r11-052n-legacy-module-isolation Legacy 模块零消费者隔离

- Status / Owner: queued / unassigned
- Outcome / Evidence: 在 053 正式清单与 054 精确删除前，将所有 file-absent target 收敛为空壳、删除仅服务于该闭包的非 target V8 helper，并把保留的拒绝/校验测试改为正式 V9/V2 Owner；产品树达到零 confirmed observation、零 symbol target definition，旧文件只剩可机械删除的空壳。
- Write scope: `src/player/{CourseRuntimeKernel,PlayerApp,PlayerScene,payload,publishedLesson,globalLayerVisibility,renderNode}.ts`、`src/player/surfaces/CoursePlayer.ts`、`src/renderer/export/{buildExportPayload,buildPptx,buildPublishedLesson,buildStandaloneHtml,buildWebPackage,exportPayloadSupport,pptxImages,renderSceneImages}.ts`、`src/renderer/project/projectArchive.ts`、`src/shared/{assetReferences,componentPackageLifecycle,constants,informationRelease,presentation,projectDiagnostics,projectHealth,projectSchema,projectSchemaTypeContract,projectTypes,publishedLessonTypes,visualDensity}.ts`、`src/shared/contracts/component-v4/types.ts`、`scripts/{build-interactive-lesson,run-courseware-authoring,validate-project}.ts`、直接受影响测试/package/语义导航、本卡与任务板。禁止修改 scanner、inventory、timeout/retry，禁止削弱 V9/V2 seam 的 fail-loud 行为。
- Write locks: none
- Acceptance: 所有现存 file-absent target 只含无副作用空模块；非 target V8 helper/脚本在无当前消费者后移除；V8 工程与旧 Published payload 仍明确拒绝；programmatic ratchet 显示 `confirmedObserved=0`、`targetDefinitions=17`（仅 file targets）、`targetReferences=0`、无 new/unmatched。
- Validation: `npm run typecheck`、受影响测试、`npm run check:ai-capabilities`、`npm run repo:index:check`、programmatic legacy ratchet（不更新 inventory）。
