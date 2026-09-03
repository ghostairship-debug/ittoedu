# r11-042-pdf-v2-only｜PDF 只消费 Published V2 print/capture

- Release / Dependencies: 1.1 / r11-031-published-slide-player, r11-040-v9-health-preflight, r11-050-v9-fixture-foundation
- Write locks: `published-producer`
- Inventory access: read
- Preservation: PM-04–PM-09, PM-13–PM-18, PM-23, PM-25

## Outcome / current evidence

PDF 产品入口只从 V9→Published V2 print/capture plan 生成，不调用 V8 `renderProjectSceneImages` 或旧 Project/Scene；Slide/Flow/Spatial/Mixed 的当前适用语义、分页、背景、动态后备和 warning 保持。

## Read first

- `src/renderer/App.tsx` 的 PDF handler
- `src/renderer/export/course/buildCoursePrintArtifacts.ts`
- `src/renderer/export/course/flowPrintPlan.ts`
- `src/renderer/export/renderSceneImages.ts`
- `src/renderer/export/playerCapture.ts`
- `tests/unit/coursePrintArtifacts.test.ts`

## Write scope

只允许修改 App PDF use case、`buildCoursePrintArtifacts`/`flowPrintPlan`、`playerCapture` 的 V2 调用、PDF preflight adapter和三个 listed tests。禁止修改共享 inventory、旧 raster module、其他导出、删除 PDF/Surface 支持、恢复 legacy fallback、改变分页/尺寸/背景、静默跳过动态内容或修改作者工程。

## Execution

1. 对固定 Slide/Flow/Spatial/Mixed fixture 记录页数、尺寸、背景、正文、overlay/global 和动态静态结果。
2. App 只提供 canonical V9 input；print plan 以 Published V2 为唯一页面事实。
3. Flow 使用语义分页，Slide/Spatial/Mixed 使用 r11-031 V2 capture seam；dynamic carrier 走现有静态后备/可见 warning，禁止直接调用 `PlayerApp`。
4. PDF-specific facts 适配 r11-040 finding catalog；失败和 unsupported 保持可行动报告，不生成空白或伪成功 PDF。
5. 删除产品对 `renderProjectSceneImages`/旧 Project 的调用；交接列出 LEG-005 预期减少的 endpoint、replacement 与精确查询，不修改共享 inventory；模块最终删除留给 r11-054。

## Stop conditions

- 迁移导致固定 fixture 页数/布局/背景或可见内容退化。
- 需要绕过 V2 Player/capture、隐藏 warning 或删格式。
- Headless 与 GUI 使用不同课程事实。

## Acceptance

- PDF 产品路径无 V8 Project/Scene/ExportPayload consumer。
- 当前适用 Surface 的内容与 warning 语义不降级。
- 导出只读，失败不修改 document/sidecar。

## Focused validation

- `npx vitest run tests/unit/coursePrintArtifacts.test.ts tests/unit/playerCapture.test.ts tests/integration/coursePdfExportApp.test.tsx`
- `npm run typecheck`

## Rollback / handoff

回滚 PDF use case/plan 切换；不删除 legacy module。交接列出不等价的固定 fixture 与观察差异。
