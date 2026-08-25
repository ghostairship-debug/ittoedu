# repair-exp-01-preflight-producer-parity 修复 Package Preflight 假绿

- Status / Owner: queued /
- Risk / Hotspot: S2 / published-producer
- Outcome / Why now: `collectCoursePackageExportPreflight` 对被引用但缺少 AssetMeta 的 ID 静默 continue，而 Published producer 随后确定性抛错，形成 `canExport=true` 假绿。
- Write scope / Baseline: baseline `b967c96`; `src/renderer/export/course/buildCoursePackages.ts`、必要的 `buildPublishedCourse.ts` 共享前置与直接 package/preflight tests；不得扩展网络资源合同、改 App UI 或静态 PDF/PPTX 语义。
- Acceptance: 对缺 metadata、缺 bytes、byteLength 不符和组件闭包等静态可判定前置，preflight 与 producer 使用同一事实；`canExport=true` 后 producer 不再因这些同类前置失败；错误带稳定 code/path。
- Focused validation: `npx vitest run tests/unit/coursePackageExport.test.ts tests/integration/courseExportPreflightApp.test.tsx tests/unit/buildPublishedCourseV2.test.ts`。
- S2 safety / rollback: 回滚起点 `b967c96`；不放宽 producer 校验、不吞异常；若共享 helper 会扩大跨格式语义，先用最窄 package preflight 修复并保留 producer 为最终硬门。
