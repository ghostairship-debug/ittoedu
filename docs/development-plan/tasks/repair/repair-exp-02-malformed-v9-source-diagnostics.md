# repair-exp-02-malformed-v9-source-diagnostics 修复畸形 V9 Source 诊断

- Status / Owner: queued /
- Risk / Hotspot: S2 / published-producer
- Outcome / Why now: source-facts resolver 把 issues 全为 `custom` 的 Schema 失败视为可安全 raw-walk；native image `content.data=null` 等结构畸形输入会让 preflight 与 producer 泄漏原生 `TypeError`，掩盖应有的 Schema/合同诊断。
- Write scope / Baseline: baseline `3780090`; `src/renderer/export/course/buildPublishedCourse.ts`、必要时同 producer 边界内的共享 source-facts helper 与 `src/renderer/export/course/buildCoursePackages.ts`、直接 export/preflight tests；不得修改 Course Project V9/Published Schema、网络合同、App UI 或其他导出格式。
- Acceptance: Schema parse 必须先于任何 raw source-facts walk；已复现的 native image `content.data=null` 在 preflight 中返回 `canExport=false` 与稳定 code `project-schema-invalid`，path 等于首个 Zod issue path，producer 对同一输入抛出的类型化错误共享完全相同的 code/path 且绝不泄漏原生 `TypeError`；Schema-valid 的缺 metadata、缺 bytes、byteLength 不符与组件闭包仍在 preflight/producer 共享完全一致的稳定 code/path，空白 ID 归一化不回归。
- Focused validation: `npx vitest run tests/unit/buildPublishedCourseV2.test.ts tests/unit/coursePackageExport.test.ts tests/integration/courseExportPreflightApp.test.tsx`；新增直接反例锁定 native `content.data=null` 的 `project-schema-invalid` code/首个 Zod path，并覆盖既有 valid-source parity。
- S2 safety / rollback: 回滚起点 `3780090`；不放宽 producer 校验、不吞异常，只用内存畸形 fixture；独立 Reviewer 同时复核 custom-only 结构错误和合法 missing-source 回归。
