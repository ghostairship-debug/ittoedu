# r11-052m-player-export-test-token-closure Player/Export 保护测试字面量收口

- Status / Owner: queued / unassigned
- Outcome / Evidence: 现有 Published V2、PPTX、预检、authoring 与 host-action 测试已不执行旧 Player/Export 实现，但描述与源码守卫仍连续写出退役符号；保留相同负向断言，移除 scanner consumer 假象。
- Write scope: `tests/integration/architectureBaselineFlows.test.tsx`、`tests/integration/courseExportPreflightApp.test.tsx`、`tests/integration/player-payload.test.ts`、`tests/unit/coursePptxExport.test.ts`、`tests/unit/nodeExportHostFontWiring.test.ts`、`tests/unit/playerAuthoringProtocol.test.ts`、`tests/unit/playerHostActions.test.ts`、`tests/unit/publishedCourseNavigation.test.ts`、`tests/unit/renderPptxComponentSnapshots.test.ts`、`tests/unit/renderPptxRuntimeSnapshots.test.ts`、必要同行测试、本卡与任务板。禁止修改产品行为、scanner、inventory、timeout/retry 或放宽 Published V2 拒绝。
- Write locks: none
- Acceptance: 测试仍证明 Published V2 seam、当前 PPTX capture、authoring 与 host action 行为；不再连续包含旧 Player/Export 扫描符号；Node 字体 host 守卫只覆盖当前 V9 package 入口。
- Validation: `npx vitest run tests/integration/architectureBaselineFlows.test.tsx tests/integration/courseExportPreflightApp.test.tsx tests/integration/player-payload.test.ts tests/unit/coursePptxExport.test.ts tests/unit/nodeExportHostFontWiring.test.ts tests/unit/playerAuthoringProtocol.test.ts tests/unit/playerHostActions.test.ts tests/unit/publishedCourseNavigation.test.ts tests/unit/renderPptxComponentSnapshots.test.ts tests/unit/renderPptxRuntimeSnapshots.test.ts`、`npm run typecheck`。
