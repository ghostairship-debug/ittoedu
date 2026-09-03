# r11-027-flow-authoring-modules｜Flow Workspace、文本、Overlay 与属性解耦

- Release / Dependencies: 1.1 / r11-023-flow-viewstate
- Write locks: `workspace-properties`
- Inventory access: `read`
- Preservation: PM-04, PM-06–PM-09, PM-12–PM-17

## Outcome / current evidence

`FlowWorkspace.tsx` 成为完全受控且不 import Store 的 Flow view；location shell、文本 authoring、Overlay gesture 和 Flow properties 分属明确模块。父级是唯一 Store adapter，删除本地 edit 与 store edit 双真相以及跨 Surface 命名的资源 fallback。

### 2026-09-03 reopened evidence

`FlowLocationWorkspace` 和 `FlowPropertiesPanel` 仍接收完整 `CourseProjectDocument`；`Workspace` 还会把旧 document 预计算出的 command result 交给 `flowAuthoringSlice.applyFlowCommand`，可在中间发生新编辑后覆盖当前 document。本节点改为 discriminated readonly Flow view + typed current-session command port：命令调用时重新读取当前活动 session，并按 canonical target/expectedRevision 原子执行；旧 callback 返回 known stale 且零工程写入。

## Read first

- `src/renderer/ui/FlowWorkspace.tsx`
- `src/renderer/ui/Workspace.tsx`
- `src/renderer/ui/PropertiesTab.tsx`
- `src/renderer/authoring/flowTextEdit.ts`
- `src/renderer/authoring/flowOverlayAuthoring.ts`
- `src/renderer/course/flowEditorView.ts`
- `tests/unit/flowWorkspace.test.tsx`

## Exact targets

| Target | Owns | Input/output contract |
|---|---|---|
| `src/renderer/ui/workspaces/FlowLocationWorkspace.tsx` | location shell、正文/浮层组合、view 到受控 props 适配 | 输入 discriminated readonly `FlowEditorView` + current-session typed commands；不接收 project/document |
| `src/renderer/ui/flow/useFlowTextAuthoringController.ts` | IME/draft/ref 同步与一次提交边界 | 输入受控 edit + canonical target；输出 typed commit/result |
| `src/renderer/ui/flow/FlowOverlayAuthoringLayer.tsx` | Overlay hit/gesture/frame 的 UI 接线 | 只输出现有 `FlowSharedAuthoringResult` |
| `src/renderer/ui/properties/FlowPropertiesPanel.tsx` | Flow location/block/overlay 属性 | 判别后的只读 Flow context + current-session typed commands；context 不含 project/document |
| `FlowWorkspace.tsx` | 纯受控渲染与局部 UI draft | 不 import `editorStore`，不拥有资源或工程 writer |

## Write scope

只允许修改 `Workspace.tsx`、`FlowWorkspace.tsx`、`PropertiesTab.tsx`、上述三个现有 Flow authoring/view 文件、`src/renderer/store/slices/flowAuthoringSlice.ts` 与对应 EditorState action 声明，并新增 Exact targets 四个文件；只允许更新 `tests/unit/flowEditorView.test.ts`、`tests/unit/flowWorkspace.test.tsx`、`tests/unit/flowWorkspaceMedia.test.tsx`、`tests/unit/readModelBoundary.test.ts` 及最窄 stale transaction 测试。禁止修改 Flow Schema/command 语义、Spatial/Slide 内部实现、共享 inventory 或建立通用 Surface model。

## Execution

1. 用测试固定 paragraph/heading/formula/media/component、四 plane overlay、controller、目录、Mixed 导航、try-run、保存重开与 Undo/Redo。
2. 先把 `FlowWorkspace` 所需 document view、text edit、asset files、component packages、selection 和 callbacks 写成显式 props；父级暂时适配现有 Store，但子级立即删除 Store import/raw fallback。
3. 抽 `useFlowTextAuthoringController`，让 IME/ref 只镜像同一受控 edit；删除本地 edit/store edit 双向同步，commit 仍调用 `flowTextEdit.ts` 的正式事务。
4. 抽 Overlay layer；gesture 只调用 current-session typed command port，不把预计算 `nextDocument` 返回父级持久化，不调用 `useEditorStore.setState`。
5. 抽 `FlowPropertiesPanel` 与 location shell；每抽一个 owner，就从原文件删除对应 effects/handlers/imports。
6. 删除 `slideCandidateSidecar*` 等跨 Surface resource fallback，改用显式 Course resource port；收紧 read-model ratchet。

## Stop conditions

- 需要把 FlowBlock 变成 LayerItem、建立第二 selection/edit store 或修改 Flow wire。
- IME、正文顺序、overlay plane、资源事务或 try-run 无法保持。
- 子模块只有 re-export，原 `FlowWorkspace.tsx` 仍持有 Store/gesture/text/property 实现。

## Acceptance

- `FlowWorkspace.tsx` 与四个新模块均不 import root Store；资源、组件、selection、edit 与 commands 通过显式窄 props/ports。
- 不存在 local/store edit 双真相；一次文字/Overlay/媒体操作形成一条正确 History，失败零部分写入。
- 捕获旧 callback 后发生中间编辑，再调用旧 callback 必须得到 stale 且当前 document/revision/history/sidecar 零写入。
- Flow 正文保持语义 block，Overlay/Controller/四 plane、Mixed 导航、保存重开、Undo/Redo 和 try-run 不变。
- `Workspace.tsx` 不再拥有 Flow 内部 authoring 规则；原文件迁出职责和 imports 实际消失。

## Focused validation

- `npx vitest run tests/unit/flowEditorView.test.ts tests/unit/flowWorkspace.test.tsx tests/unit/flowWorkspaceMedia.test.tsx tests/unit/readModelBoundary.test.ts`
- `npm run typecheck`

## Rollback / handoff

按 text、overlay、properties 或 location shell 的单一纵切回滚；不得恢复 raw Store fallback。交接列出仍需完整 Store 的精确 symbol 和缺少的窄 port。
