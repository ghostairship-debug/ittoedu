# repair-leg-003-remove-unreachable-app-delivery-fallback 删除不可达的 App Legacy 交付回退

- Status / Owner: active / codex/repair-leg-003
- Risk / Hotspot: S2 / app-save-recovery
- Outcome / Why now: 生命周期表征 `f3fd31f` 证明正常 V9 新建、打开、Mixed 切换、替换与恢复始终恰有一个活动 V9 document；但 App 的 HTML、网页包与整课预览仍在 source-null 时构造 V8 projection/Legacy artifact，并保留仅服务该分支的桌面预览 IPC/window/protocol。
- Write scope / Baseline: baseline `f3fd31fca6fe89a867c43b39d4af38078094f6cc`；仅允许写 `src/renderer/App.tsx`、`src/shared/ipcTypes.ts`、`src/preload/index.ts`、`src/main/ipc.ts`、`src/main/index.ts`、`src/main/protocols.ts`，删除 `src/main/previewWindow.ts`，以及精确受影响的 typed DesktopAPI mocks 与窄幅 App integration test；作者不改计划、任务板或 generated 输出。不得改 Workspace/Store、PPTX/PDF、Legacy builders、脚本、Schema/producer 或 Player。
- Acceptance: 正常 V9 full preview 始终使用 renderer Published V2 session，HTML/网页包始终使用 V2 producer/preflight；异常 source-null 明确 unavailable，绝不构造 V8 payload/artifact；`openPreview` DesktopAPI、`preview:open` IPC、preview window 与只服务它的 main protocol 全部移除；当前位置预览、Workspace 编辑态 Runtime preview、PPTX/PDF、仍有真实 consumer 的 builders/scripts 行为不变。
- Focused validation: 扩展 App integration 测试覆盖 full preview 与 HTML/Web V2 选择及 source-null 明确失败；`npx vitest run tests/unit/v9SlideBackendSelection.test.ts tests/integration/courseExportPreflightApp.test.tsx <受影响 main/preload 聚焦测试>`；`npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.electron.json --noEmit`；`git diff --check`。
- S2 safety / rollback: source-null 必须显式失败，不能恢复隐蔽 V8 回退；保留 `buildStandaloneHtml`、`buildExportPayload`、`buildWebPackageFromProjectAsync`、Workspace authoring preview、PPTX/PDF、脚本及 `courseware-preview-bootstrap` iframe 协议。若发现支持范围内合法 source-null 旅程或 desktop preview 的其它真实 product caller，停止并报告，不扩大任务。
