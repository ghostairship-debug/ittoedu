# repair-leg-005a-remove-unreachable-source-null-pdf-raster 删除不可达 PDF source-null Runtime 回退

- Status / Owner: active / codex/repair-leg-005a
- Risk / Hotspot: S2 / app-save-recovery
- Outcome / Why now: `f3fd31f` 已证明正常 V9 新建、打开、Mixed 切换、替换与恢复始终保持恰好一个活动 V9 文档；PDF 预检后若该 source 消失，产品应明确报“PDF 导出不可用”，不应再从 `state.project` 构造 V8 payload 并启动 Legacy Runtime raster。只删除这条不可达分支，同时保留合法纯 Slide 的正常 raster、Mixed V2、PPTX capture 与 PDF 预检。
- Write scope / Baseline: baseline `26b0438da0a67e841970cc67ce1806458637683d`；仅允许窄改 `src/renderer/App.tsx`、删除 `src/renderer/export/renderSceneImages.ts` 中唯一服务该分支的 `renderProjectSceneImagesWithRuntime`，更新 `tests/integration/coursePdfExportApp.test.tsx` 及受该符号删除影响的 inert test mocks；禁止修改 Store、main/preload/IPC、Schema、Published producer/contracts、正常 `renderProjectSceneImages`、`playerCapture.ts`、PPTX、PDF preflight 或 generated 输出。
- Acceptance: 正常 Mixed 仍只走 Published V2 PDF；正常纯 Slide 仍以 `renderProjectSceneImages(..., 1.5)` 成功导出；非纯 Slide 缺 `pdf-html` 仍 fail closed；预检后 source 消失时显示“PDF 导出不可用”，不调用任何 raster renderer 或 `exportPdf`；`renderProjectSceneImagesWithRuntime` 在 `src/tests/scripts/examples` 精确归零。
- Focused validation: `npx vitest run tests/unit/v9SlideBackendSelection.test.ts tests/unit/coursePrintArtifacts.test.ts tests/integration/coursePdfExportApp.test.tsx`；renderer typecheck；`git grep -n 'renderProjectSceneImagesWithRuntime' -- src tests scripts examples` 无结果；`git diff --check`。
- S2 safety / rollback: 只删除正常 V9 生命周期不可达的 source-null 分支；若需要改变纯 Slide raster、Mixed V2、PPTX、preflight、Store 生命周期或导出语义，立即停止并拆卡。回滚起点为 baseline。
