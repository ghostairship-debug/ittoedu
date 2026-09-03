# r11-054c-export-diagnostics-shells Export / diagnostics 空壳删除

- Status / Owner: blocked / Integrator
- Outcome / Evidence: 精确删除八个零消费者的旧 Export/diagnostics 空壳；Course Project V9 / Published V2 package producer、PPTX/PDF 与 Course Project Health 保持正式 Owner。
- Write scope: `src/renderer/export/{buildExportPayload,buildPptx,buildPublishedLesson,buildStandaloneHtml,buildWebPackage,exportPayloadSupport,renderSceneImages}.ts`、`src/shared/projectHealth.ts`、`docs/development-plan/inventories/legacy-consumers.json`、本卡、后继卡与任务板。
- Write locks: legacy-inventory
- Acceptance: 八个精确路径不存在；LEG-002/004/005/007 无目标定义或引用；Published V2、PPTX、PDF、Course Project Health 替代测试通过。
- Validation: `npx vitest run tests/unit/buildPublishedCourseV2.test.ts tests/unit/coursePptxExport.test.ts tests/integration/coursePdfExportApp.test.tsx tests/unit/courseProjectHealth.test.ts`、`npm run typecheck`、`npm run check:legacy-ready`。
