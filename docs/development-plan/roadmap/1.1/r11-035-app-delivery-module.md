# r11-035-app-delivery-module｜App Preview、Preflight 与导出形成 Delivery 模块

- Release / Dependencies: 1.1 / r11-025-editor-store-v9-only, r11-032-player-v2-only-entry
- Write locks: `published-producer`, `workspace-properties`
- Inventory access: `read`
- Preservation: PM-03–PM-09, PM-14–PM-25, PM-27–PM-28

## 2026-09-03 执行版（基于 HEAD bb1f848）

通用规则、术语与交接模板见 [执行者指南](EXECUTION_GUIDE.md)。原规格的模块迁移步骤已经完成，不再执行；下面只保留剩余缺陷。

## Outcome / current evidence

已完成：`src/renderer/app/useCourseDelivery.ts`（591 行）持有试运行/整课预览、预检、HTML/Web/PPTX/PDF/DOCX 发起；`App.tsx` 不再直接 import 格式 builder。

剩余三处缺陷，都在 `useCourseDelivery.ts`：

1. **预检与发出用的不是同一份快照。** `exportCourse`（:421–449）把预检时的 `snapshot` 与 `identity` 存进 `pendingExportRef`；`continuePreflightExport`（:451–483）核对 identity 后却调用 `emitHtml`/`emitWebPackage`/`emitPptx`/`emitPdf`，而这四个函数各自用 `requireSnapshot(...)` 重新读取当前快照（:253、:271、:288、:311），且 `emitHtml` 在读取前还 `await prepareBundledFontEmbedding()`（:252）。在这个 `await` 期间发生的任何文档修改都会被导出，却从未经过预检。
2. **过期的预检结果仍可导航。** `locatePreflightItem`（:485–489）不核对 identity，文档已变时仍按旧 finding 导航当前新文档。
3. **大文件改网页包时跳过预检。** `exportLargeHtmlAsWebPackage`（:516–519）直接调用 `emitWebPackage()`，此前只做过 `single-html` 目标的预检，没有做过 `web-package` 目标的预检。

## Read first

- `src/renderer/app/useCourseDelivery.ts`（全文）
- `src/renderer/App.tsx:240–300`（`useCourseDelivery` 的 ports 实现，尤其 `navigateFinding` 与 `reportError`）
- `src/renderer/ui/ExportSizeWarningDialog.tsx`（按钮文案：`取消`、`仍导出单 HTML`、`导出网页包（推荐）`）
- `src/renderer/ui/ExportPreflightDialog.tsx`（按钮文案：`定位`、`保存报告`、`继续导出`）
- `tests/integration/courseExportPreflightApp.test.tsx`（1–200 行的 mock 与 helper；455–503 行的两个现有用例）

## Exact targets

| 位置 | 改动 |
|---|---|
| `emitHtml`（:244–266）、`emitWebPackage`（:268–283）、`emitPptx`（:285–307）、`emitPdf`（:309–349） | 各增加一个参数 `snapshot: CourseDeliverySnapshot`，函数体内删除对 `requireSnapshot(...)` 的调用，全部改用参数；`emitDocx` 不预检，保持不变 |
| `continuePreflightExport`（:470–475） | 调用四个 emit 时传入 `pending.snapshot` |
| `exportLargeHtmlAsWebPackage`（:516–519） | 改为 `cancelLargeHtml(); exportCourse('web-package')`，使网页包目标重新走预检 |
| `locatePreflightItem`（:485–489） | 先读 `portsRef.current.readCanonicalSnapshot()`，若为空或 `snapshotIdentity(current)` 与 `pendingExportRef.current?.identity` 不一致，则 `portsRef.current.reportError('导出预检结果已过期：工程已修改，请重新执行导出预检。')` 并 `clearPreflight()`，不调用 `navigateFinding`；一致时保持原行为 |
| `requireSnapshot`（:223–227） | 只保留给仍需要它的调用方（当前只有 `openPreview` 通过 `readCanonicalSnapshot` 直接判空）；若无调用方则删除 |

允许新建：无（三条新测试写进现有文件）。

## Write scope

只允许修改 `src/renderer/app/useCourseDelivery.ts` 与 `tests/integration/courseExportPreflightApp.test.tsx`；`src/renderer/App.tsx` 仅限签名变化导致编译失败时的最小同步。禁止修改任何格式 producer、Published wire、Player host、Main/Preload、Store。

## Execution

1. 在 `tests/integration/courseExportPreflightApp.test.tsx` 的 `describe('ARCH-4 V9 HTML/Web export preflight')` 内新增三条红测试。先在文件顶部按现有 `vi.hoisted` 模式增加 `fontProbe = vi.hoisted(() => ({ gate: null as Promise<void> | null }))`，并 `vi.mock('../../src/renderer/export/bundledFontEmbedding', ...)`：`prepareBundledFontEmbedding` 先 `await fontProbe.gate`（为 null 时不等待），再调用原实现；`afterEach` 把 `fontProbe.gate` 置回 null。
   - `it('re-runs preflight for the web package when a large single HTML is redirected')`。arrange：`loadBlankCourse()`，`sizeProbe.forceWarning = true`，`render(<App />)`。act：点 `export-single-html`；等到 `单 HTML 导出预检` 对话框；点 `继续导出`；等到 `单 HTML 文件较大` 对话框；点 `导出网页包（推荐）`。assert：`await screen.findByRole('alertdialog', { name: '网页包 导出预检' })` 可见，此时 `api.exportWebPackage` 未被调用；再点 `继续导出`，`waitFor(() => expect(api.exportWebPackage).toHaveBeenCalledOnce())`。
   - `it('exports the snapshot that passed preflight even if the document changes before emit')`。arrange：`loadBlankCourse()`，记录 `selectActiveCourseProjectDocument(useEditorStore.getState()).title` 为 `original`；建一个手动 deferred 赋给 `fontProbe.gate`；`render(<App />)`。act：点 `export-single-html`；等到预检对话框；点 `继续导出`；`await` 一个宏任务；`useEditorStore.getState().renameProject('预检后改名')`；resolve deferred。assert：`waitFor(() => expect(api.exportHtml).toHaveBeenCalledOnce())`；`deliveryProbe.publishedStandalone.mock.calls[0][0].project.title` 等于 `original`。
   - `it('refuses to locate a preflight finding after the document changed')`。arrange：`loadCourseWithRemoteBackground()`，`render(<App />)`。act：点 `export-single-html-online`；等到预检对话框并看到 `online-remote-asset`；`useEditorStore.getState().renameProject('定位前改名')`；点该 finding 的 `定位` 按钮。assert：`await screen.findByText(/导出预检结果已过期/)` 可见；`screen.queryByText(/已定位导出预检问题/)` 为 null；预检对话框已关闭。
   运行 `npx vitest run tests/integration/courseExportPreflightApp.test.tsx`，三条必须失败，失败原因分别是：没有出现第二个预检对话框；导出的标题是 `预检后改名`；出现了 `已定位导出预检问题`。粘贴输出。
2. 按 Exact targets 修改 hook。
3. 再运行第 1 步命令，全文件通过；粘贴。
4. `npm run typecheck`。
5. 运行 Focused validation 第一条。
6. 结构事实：`grep -c "requireSnapshot(" src/renderer/app/useCourseDelivery.ts` 不大于 2（定义与至多一处调用）；`grep -cE "emit(Html|WebPackage|Pptx|Pdf)\(" src/renderer/app/useCourseDelivery.ts` 中每处调用都带 `pending.snapshot` 或函数定义处带 `snapshot: CourseDeliverySnapshot`（粘贴 `grep -nE` 输出）；`grep -c "exportCourse('web-package')" src/renderer/app/useCourseDelivery.ts` 为 1；`grep -cE "useEditorStore|from '\.\./store/" src/renderer/app/useCourseDelivery.ts` 为 0。

## Stop conditions

- 第 1 步的三条测试有任一在修改前就通过。
- 修复需要改任何格式 producer、Published wire、`ExportPreflightDialog.tsx` 或 `ExportSizeWarningDialog.tsx`。
- 修复后 `coursePdfExportApp.test.tsx` 或本文件其他用例变红。

## Acceptance

- 三条新测试有完整的红→绿证据。
- 预检、继续导出、发出三步使用同一份 `pending.snapshot`；大文件改网页包必经 `web-package` 预检；过期 finding 不导航且给出可操作错误。
- PM-19、PM-20、PM-21、PM-23、PM-25 的 focused 测试通过。

## Focused validation

- `npx vitest run tests/integration/courseExportPreflightApp.test.tsx tests/integration/coursePdfExportApp.test.tsx tests/unit/coursePlayerTryRunFit.test.ts tests/unit/readModelBoundary.test.ts`
- `npm run typecheck`

## 2026-09-03 完成记录

本节点已按上述执行版完成并提交：三条新测试红→绿（失败原因与执行版第 1 步预期一致），`requireSnapshot` 因无调用方而删除。执行版未覆盖的一处补充：`continuePreflightExport` 在 `readCanonicalSnapshot()` 为空时原本依赖 emit 内的 `requireSnapshot` 报 `courseDeliveryUnavailable`；改为发出 `pending.snapshot` 后，该分支改为在 `continuePreflightExport` 内直接 `clearPreflight()` 并以 `runBusy` 抛出同一错误，保住既有用例 "fails explicitly when V9 sources disappear after … preflight" 的 fail-loud 契约，不导出过期快照。

## Rollback / handoff

单一提交，整体回滚。交接按指南第 6 节格式。
