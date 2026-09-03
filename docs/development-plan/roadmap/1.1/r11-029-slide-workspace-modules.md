# r11-029-slide-workspace-modules｜Slide Workspace、动态目标与画布控制器解耦

- Release / Dependencies: 1.1 / r11-022-slide-actions, r11-027-flow-authoring-modules, r11-028-spatial-authoring-modules, r11-033-runtime-authoring-preview-v2
- Write locks: `workspace-properties`
- Inventory access: `read`
- Preservation: PM-01, PM-03, PM-06–PM-09, PM-12, PM-14–PM-18

## Outcome / current evidence

`Workspace.tsx` 收敛为 exactly-one Surface router；Slide 画布 authoring、Runtime/Component target overlay 与 try-run 接线进入独立模块，`workspaceSlideAuthoring.ts` 只通过注入的 V9 backend/command port 工作，不保留 candidate/V8 fallback。

## Integrator audit / reopened（2026-09-03）

`SlideLocationWorkspace` 与三个 Surface shell 是可保留成果；但 `Workspace.tsx` 仍读取 Slide live snapshot、构造 raw Store command facade，并内联 Spatial、Flow、Slide connector/controller。`SlideLocationWorkspace` 还把 snapshot 与 commands 拼成兼容 `liveStore`。这直接违反 exactly-one router 和“不传完整 Store/State”的退出条件。本次只迁出 connector 与接线责任，不重写 Surface UI、Published host 或 try-run 语义。

## Read first

- `src/renderer/ui/Workspace.tsx`
- `src/renderer/ui/workspaceSlideAuthoring.ts`
- `src/renderer/ui/coursePlayerTryRun.ts`
- `src/renderer/ui/workspaces/FlowLocationWorkspace.tsx`
- `src/renderer/ui/workspaces/SpatialLocationWorkspace.tsx`
- `src/renderer/store/slideBackendPort.ts`
- `src/renderer/phaser/`
- `tests/unit/v9SlideViewportAdapter.test.ts`

## Exact targets

| Target | Owns | Negative boundary |
|---|---|---|
| `src/renderer/ui/workspaces/SlideLocationWorkspace.tsx` | Slide canvas、selection/hit、transform、command/try-run wiring | Flow/Spatial internals、root Store |
| `src/renderer/ui/workspaces/SlideDynamicAuthoringOverlay.tsx` | Runtime/Component target overlay、ACK/barrier/error UI | Runtime registry/host 实现、第二 session manager |
| `src/renderer/ui/workspaces/FlowWorkspaceConnector.tsx`（planned） | 把命名 Flow selectors/027 command port 接到既有 Flow leaf | Flow command 算法、session host、persist、Slide/Spatial internals、完整 Store |
| `src/renderer/ui/workspaces/SpatialWorkspaceConnector.tsx`（planned） | 把命名 Spatial selectors/028 command port 接到既有 Spatial leaf | Spatial command 算法、session host get/set、persist、Slide/Flow internals、完整 Store |
| `src/renderer/ui/workspaces/WorkspaceRouteContext.ts`（planned） | exactly-one session 与各 Surface 命名 view/command port | 完整 `EditorState`、raw Store、Surface 业务实现 |
| `workspaceSlideAuthoring.ts` | 注入式 V9 authoring controller | `readCandidate`、`runCandidate`、`v8Fallback`、raw Store |
| `Workspace.tsx` | 根据活动 session 路由 Slide/Flow/Spatial | Player protocol、Surface command、旧 Project/Scene |

## Write scope

只允许修改 `Workspace.tsx`、`workspaceSlideAuthoring.ts`、`src/renderer/ui/workspaces/**` 中各 Surface 的窄 connector、`WorkspaceRouteContext.ts` 与现有 Slide viewport/preview 适配器，并保留 Exact targets；027/028 已定义的 Flow/Spatial leaf read model 与 command contract 只接线、不重写。只允许更新列出的 route/Surface 集成测试。connector 可以使用 `useEditorStore(selector)` 或注入的窄 port，但不得调用 `.getState/.setState`、接收完整 `EditorState`、用 object-rest 复制全 state、持有 module-global mutable bind，或实现具体 Surface command/session host/persist。`Workspace.tsx` 的既有 CRLF 噪声在本节点随实际修改清理。禁止修改 Published wire、Runtime/Component host、Flow/Spatial 语义、Store writer 或共享 inventory。

## Execution

1. 固定 Phaser hit/框选/transform、Text/Formula、Runtime/Component target、Controller、当前 location/state、ACK/barrier/stale/destroy 和 try-run fit。
2. 把 Slide root 所需 view、selection、backend、commands、dynamic target、try-run 与 feedback 写成显式 props/ports；不传完整 Store/State。
3. 抽 `SlideDynamicAuthoringOverlay`，保持现有 host lifecycle，只迁 UI target/ACK/error 接线。
4. 抽 `SlideLocationWorkspace`，把 canvas effects/handlers 从 root 移走；`workspaceSlideAuthoring.ts` 改为只接收 `SlideAuthoringBackend` 与 command port，并删除 candidate/V8 fallback 及 module-global mutable bind。本节点拥有该 bind 的清理，r11-037 不再代领。
5. `Workspace.tsx` 最终只从窄 route context 检查活动 session、选择一个 Surface connector、展示 sessionless 错误；不得调用 raw Store、创建 snapshot/command facade、view builder、try-run mount、authoring host 或 Surface effect。
6. 删除 `liveStore` 等兼容完整对象；若 leaf 仍需要完整 Store/State，停止并把所需 view/command 收窄，不在 connector 换名复制 Facade。
7. 收紧 ratchet：除证明三个 leaf import 存在外，还必须让 raw Store、Surface command、view builder、try-run mount 和 root adapter helper 的最小违规 fixture 失败；不新增 preview payload/session manager。

## Stop conditions

- 需要新建第二 preview/session manager、修改 Published V2/Runtime/Component 协议或恢复旧 candidate。
- Flow/Spatial 模块必须重新内联到 root 才能路由。
- 原 `Workspace.tsx` 仍保留同一 Slide/Runtime/Component handler/effect。

## Acceptance

- `Workspace.tsx` 只做 exactly-one Surface 路由和 sessionless 可行动错误，不 import旧 Project/Scene、Player protocol 或 Surface commands。
- `Workspace.tsx` 无 `useEditorStore.getState/setState`、Surface snapshot/command facade、authoring host、view/try-run builder 或 Surface-specific effect；每个 connector 只接收本 Surface 窄 port。
- `workspaceSlideAuthoring.ts` 无 candidate/V8 fallback、raw Store 或完整 `EditorState`；新模块不是 re-export，原 root 的相关 imports/state/effects/branches 实际消失。
- Published authoring 仍只有现有 mount → try-run lifecycle；Phaser、动态载体、Controller、ACK/stale/destroy 与视觉/互动行为不变。
- Slide/Flow/Spatial/Mixed 的切换、保存、Undo/Redo、当前页试运行保持。
- route adapter/connector 只消费命名 selector、单 owner view 与 typed command port；无完整 State/document、raw Store、object-rest 全量复制、跨 owner mutation/persist 或 module-global bind。
- `Workspace.tsx` 无 CRLF/trailing-whitespace 噪声。

## Focused validation

- `npx vitest run tests/unit/v9SlideViewportAdapter.test.ts tests/unit/coursePlayerTryRunFit.test.ts tests/unit/serializedSessionMount.test.ts tests/unit/readModelBoundary.test.ts tests/unit/flowWorkspace.test.tsx tests/unit/flowProductIntegration.test.tsx tests/unit/spatialWorkspaceAuthoring.test.ts tests/unit/spatialProductIntegration.test.tsx`
- `npm run typecheck`

## Rollback / handoff

按 dynamic overlay 或 Slide workspace 的完整纵切回滚；不得恢复 candidate 双轨。交接列出 root 尚持有的精确职责和阻塞的现有 port。
