# r11-037o-media-ports-and-facade-removal 媒体Authoring窄ports与彻底删除featureAuthoringPorts

- Status / Owner: queued /
- Outcome / Evidence: 媒体 Authoring 使用独立窄 ports；彻底删除 featureAuthoringPorts.ts、root 的 featurePorts 汇总对象与冗余旧实现。
- Write scope: `src/renderer/media/commitCourseMediaAuthoring.ts`、`src/renderer/store/editorStore.ts`、`src/renderer/authoring/featureAuthoringPorts.ts`（删除）、直接 importers
- Write locks: none
- Acceptance: FeatureAuthoringPorts 彻底清零删除，root 中不再有 featurePorts 汇总对象；目标测试通过。
- Validation: `npx vitest run tests/integration/courseMediaLibraryImportVerticalSlice.test.ts tests/integration/imageReplacementVerticalSlice.test.ts` 与 `npm run typecheck`。
