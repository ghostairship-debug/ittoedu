# r11-035-app-delivery-module｜App Preview、Preflight 与导出形成 Delivery 模块

- Release / Dependencies: 1.1 / r11-025-editor-store-v9-only, r11-032-player-v2-only-entry
- Write locks: `published-producer`, `workspace-properties`
- Inventory access: `read`
- Preservation: PM-03–PM-09, PM-14–PM-25, PM-27–PM-28

## Outcome / current evidence

`App.tsx` 中 Try-run/Full Preview、preflight、HTML/Web/PPTX/PDF/DOCX 发起、进度、finding 定位与结果反馈由 `useCourseDelivery` 用例组合。它只调用现有唯一 Published/export producer，不复制 payload、capture、CSP、ZIP 或格式规则。

## Read first

- `src/renderer/App.tsx`
- `src/renderer/preview/coursePlayerTryRun.ts`
- `src/renderer/export/course/buildCoursePackages.ts`
- `src/renderer/export/`
- `src/renderer/diagnostics/`
- `tests/integration/courseExportPreflightApp.test.tsx`

## Exact targets

| Input | Use case result | Must delegate to |
|---|---|---|
| active V9 document + current target | Try-run/Preview mount result | existing Published V2/preview producer |
| format + canonical snapshot | preflight findings | r11-040 unified diagnostics adapters |
| accepted preflight + output target | HTML/Web/PPTX/PDF/DOCX result | existing per-format producer/Main port |
| finding target | UI navigation request | existing canonical navigation command |

唯一新文件是 `src/renderer/app/useCourseDelivery.ts`。它不得包含 format-specific serializer/parser、Player payload、capture、CSP 或 ZIP 实现。

## Write scope

只允许修改 `src/renderer/App.tsx`、现有 App delivery adapter/feedback wiring，并新增 `useCourseDelivery.ts`；只允许更新 `tests/integration/courseExportPreflightApp.test.tsx`、`tests/integration/coursePdfExportApp.test.tsx`、`tests/unit/coursePlayerTryRunFit.test.ts`、`tests/unit/readModelBoundary.test.ts`。禁止修改格式 wire、Published producer 语义、Player host、Main/Preload IPC、Store writer、共享 inventory 或删除任何导出。

## Execution

1. 固定当前页试运行、整课预览、两种单 HTML、Web Package、PPTX、PDF、Flow DOCX 的成功、finding、取消与失败反馈。
2. 定义 `CourseDeliveryPorts`：read canonical snapshot、build/mount preview、preflight、per-format emit、choose output、navigate finding、report status/error；每项引用现有 producer，不能传整个 Store/Preload API。
3. 先迁 Preview/try-run，再迁 preflight/finding，最后按 HTML/Web → PPTX → PDF/DOCX 迁发起逻辑；每组同一提交删除 App 对具体 builder 的 import/handler/effect。
4. 无 active V9 document/session 时返回可行动错误；不读取 `EditorState.project` 或旧 ExportPayload fallback。
5. 保持一次 canonical snapshot 贯穿 preflight 与 emit；revision 改变时要求重新预检，不混用旧 finding/新 document。
6. 在 boundary test 禁止 `App.tsx` import具体格式 builder，禁止 delivery hook import root Store 或实现格式规则。

## Stop conditions

- 需要修改任何导出 wire、静态化动态 carrier、合并离线/在线语义或删除格式。
- 新 hook 必须复制 payload/capture/CSP/ZIP/format rule 才能工作。
- App 与 hook 同时保留同一 export/preview handler。

## Acceptance

- `App.tsx` 不直接 import具体格式 builder；`useCourseDelivery` 只组合正式 producer/ports，不复制格式实现或读取 root Store。
- Slide/Flow/Spatial/Mixed、Runtime/Component、资源闭包、当前全部导出和错误反馈不变；sessionless fail-loud。
- Preview/preflight/emit 使用同一 canonical revision；stale/cancel/failure 不写工程且不报告伪成功。
- 原 App 的 delivery imports/state/effects/handlers 实际删除，无 wrapper/re-export 或第二 delivery service。

## Focused validation

- `npx vitest run tests/integration/courseExportPreflightApp.test.tsx tests/integration/coursePdfExportApp.test.tsx tests/unit/coursePlayerTryRunFit.test.ts tests/unit/readModelBoundary.test.ts`
- `npm run typecheck`

## Rollback / handoff

按 Preview、preflight 或单个格式发起纵切回滚；不能保留双入口。交接列出仍由 App 直接持有的格式、producer 与失败行为。
