# r11-052i-legacy-test-reference-closure 剩余 Legacy 测试引用收口

- Status / Owner: queued / Codex
- Outcome / Evidence: r11-053 扫描证实多个 V9 竞态/导出集成测试仍 mock 早已不在产品依赖闭包中的 `renderSceneImages` 模块，另有一条 V8 静态渲染测试的行为已由 V9 thumbnail/capture 测试承接；移除这些无效引用与旧测试，保留支持场景覆盖。
- Write scope: 仅修改直接 mock `src/renderer/export/renderSceneImages.ts` 的现有 V9 集成测试、删除 `tests/unit/elementAnimationStaticExport.test.ts`、必要的同行旧符号文字改写，以及本卡与任务板。禁止修改产品、scanner、inventory、timeout/retry 或削弱 V8 拒绝行为。
- Write locks: test-fixtures
- Acceptance: V9 测试不再引用退役渲染模块；播放初始隐藏不影响稳定帧的行为仍由 `sceneThumbnailAnimation.test.tsx` 覆盖；竞态、PDF 和 Spatial 最近层测试通过。
- Validation: `npx vitest run tests/unit/sceneThumbnailAnimation.test.tsx tests/integration/componentPackageReplacementRace.test.tsx tests/integration/coursePdfExportApp.test.tsx tests/integration/imageReplacementRaceCharacterization.test.tsx tests/integration/mediaLibraryImportRace.test.tsx tests/unit/spatialProductIntegration.test.tsx`。
