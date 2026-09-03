# r11-043-html-web-v2-only｜HTML/Web Package 只携带 Published V2

- Release / Dependencies: 1.1 / r11-031-published-slide-player, r11-040-v9-health-preflight, r11-050-v9-fixture-foundation
- Write locks: `published-producer`
- Inventory access: read
- Preservation: PM-03–PM-21, PM-25, PM-28

## Outcome / current evidence

离线便携单 HTML、在线轻量单 HTML 与 Web Package 只嵌入/加载 Published V2 和匹配 CoursePlayer bundle；旧 standalone/ExportPayload/ProjectDocument 路径退出产品。两种 HTML 的资源与网络语义保持明确不同；脚本/connect facts 分析、格式预检与 HTML/CSP/asset/ZIP 发射各有单一真实 owner。

## Read first

- `src/renderer/export/course/buildCoursePackages.ts`
- `src/renderer/export/buildStandaloneHtml.ts`
- `src/renderer/export/buildWebPackage.ts`
- `src/renderer/export/loadPlayerBundle.ts`
- `tests/unit/coursePackageExport.test.ts`
- `tests/e2e/publishedOnlineSingleHtml.spec.ts`

## Write scope

只允许修改 Course package producer、App HTML/Web use case、bundle loader、HTML/Web preflight adapter与 listed tests；允许新增 `src/renderer/export/course/coursePackageScriptAnalysis.ts` 与 `src/renderer/export/course/coursePackagePreflight.ts`。禁止修改共享 inventory、Player entry/V2 wire、其他导出、合并离线/在线语义、删除 Web Package、内联远程脚本、泄露 Secret、用旧 payload fallback 或建设通用导出平台。

## Execution

1. 对两种 HTML 与 Web Package 固定当前 payload、asset URL、connectOrigins、CSP、离线/在线行为和错误提示。
2. producer 从 canonical V9 构建一次 Published V2；离线版闭合本地素材/代码，在线版保留声明的远程资源与精确 origin。
3. 三种产物加载 r11-031 的同一匹配 CoursePlayer V2 bundle；unsupported/corrupt payload fail-loud，不调用 `PlayerApp`。
4. 把 JS/connect facts 的纯分析迁到 `coursePackageScriptAnalysis.ts`；它只接收显式源码/声明并返回 facts，不生成 HTML/ZIP、不读取 Store。把 HTML/Web-specific finding 适配迁到 `coursePackagePreflight.ts` 并复用 r11-040 finding catalog。
5. `buildCoursePackages.ts` 只组合 Published payload、analysis/preflight 结果与 HTML/CSP/asset/ZIP emitter；删除内联 parser/analyzer 和重复 finding 规则，且不新增第二 producer。
6. 保持 Component/Runtime bytes、静态后备、课程状态、导航守卫和教师控制器；删除产品对 legacy standalone/Web builder 输入的调用。交接列出预期减少的 LEG endpoint、replacement 与精确查询，不修改共享 inventory；旧测试/模块最终由 r11-052/054 处理。

## Stop conditions

- 离线 HTML 需要网络才能运行，或在线 HTML 丢失精确 origin 诊断。
- 需要把动态 carrier 静态化、删除 Web Package 或恢复旧 Player。
- 产物包含 Provider Secret、绝对本地路径或未声明远程脚本。

## Acceptance

- 三种产品产物只包含 Published V2 + 匹配 Player，不含 V8 payload。
- Slide/Flow/Spatial/Mixed、互动、动态 carrier 和两种网络语义不降级。
- 产物在其声明环境中真实打开；失败可见且不改作者工程。
- emitter 不直接 import `acorn` 或实现脚本分析；analyzer 不生成 HTML/ZIP、不读取 Store；preflight 使用统一 finding contract。三种 producer 仍唯一，原 `buildCoursePackages.ts` 真正删除迁出职责而非 re-export。

## Focused validation

- `npx vitest run tests/unit/coursePackageExport.test.ts`
- `npx playwright test tests/e2e/publishedOnlineSingleHtml.spec.ts`
- `npm run typecheck`

## Rollback / handoff

按产物类型回滚 producer 切换，不能保留运行时自动双入口。交接列出未闭合的 asset/origin/bundle consumer。
