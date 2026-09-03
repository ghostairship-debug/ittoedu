# r11-037aa-slide-workspace-connector-port Slide Workspace 窄连接器

- Status / Owner: queued / Codex
- Outcome / Evidence: `readModelBoundary.test.ts` 在当前基线证实 `SlideWorkspaceConnector.tsx` 仍 import 完整 `EditorState` 并直接从 root Store 组装跨 Owner 状态/动作；将其改为消费命名 selector 与窄 Workspace ports，不改 Slide 编辑、Preview/Try-run 或历史行为。
- Write scope: `src/renderer/ui/workspace/SlideWorkspaceConnector.tsx`、其必要的最近 Owner selector/port 文件（禁止向 `editorStore.ts` 添加业务实现）、`tests/unit/readModelBoundary.test.ts` 与 Slide Workspace 最近层行为测试，以及本卡与任务板。
- Write locks: editor-store-history, workspace-properties
- Acceptance: Connector 不 import 完整 `EditorState`，不使用 raw get/set；仅通过命名 selector/窄 port 组装 Workspace；结构检查与 Slide Workspace 行为测试通过。
- Validation: `npx vitest run tests/unit/readModelBoundary.test.ts tests/unit/slideWorkspacePorts.test.tsx tests/unit/v9SlideProductIntegration.test.tsx` 与 `npm run typecheck`。
