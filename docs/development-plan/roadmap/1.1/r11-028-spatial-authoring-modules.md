# r11-028-spatial-authoring-modules｜Spatial Workspace 与属性形成独立模块

- Release / Dependencies: 1.1 / r11-024-spatial-viewstate
- Write locks: `workspace-properties`
- Inventory access: `read`
- Preservation: PM-05–PM-09, PM-12–PM-17

## Outcome / current evidence

Spatial world/camera/path/relation/selection 与 Properties 从 `Workspace.tsx` / `PropertiesTab.tsx` 迁入独立 Surface 模块，只消费 `SpatialEditorView`、session camera 和现有 Spatial commands；root 不再持有 Spatial hit、gesture、try-run 或属性规则。

### 2026-09-03 reopened evidence

Spatial leaf 已迁出一部分 UI，但 `SpatialLocationWorkspace` 仍接收 `SpatialWorldAuthoringHost.getSession/setSession`，`Workspace` 继续组合 whole-session world command 与 persist。本节点必须改为 `SpatialLocationWorkspaceCommandPort` 的 typed atomic commands；world/content/camera/path/relation planner 归 Spatial command owner，叶子只拥有 gesture/controller 接线，stale target 零写入。

## Read first

- `src/renderer/ui/Workspace.tsx`
- `src/renderer/ui/PropertiesTab.tsx`
- `src/renderer/ui/SpatialCameraPanel.tsx`
- `src/renderer/ui/SpatialPathEditor.tsx`
- `src/renderer/course/spatialEditorView.ts`
- `tests/unit/spatialWorkspaceAuthoring.test.ts`

## Exact targets

| Target | Required content | Must not own |
|---|---|---|
| `src/renderer/ui/workspaces/SpatialLocationWorkspace.tsx` | world/viewport composition、hit/selection、camera/path/relation wiring | Course Store、whole-session host/get/set、Flow/Slide selection、persisted session camera |
| `src/renderer/ui/properties/SpatialPropertiesPanel.tsx` | world item/camera/path/relation typed properties | DOM/Phaser proxy conversion、other Surface commands |
| `Workspace.tsx` | 只选择 `SpatialLocationWorkspace` 并传入 view/ports | Spatial gesture/effect/transform 规则 |
| `PropertiesTab.tsx` | 只路由 Spatial properties context | Spatial 字段/命令实现 |

## Write scope

只允许修改表中四个 UI、`src/renderer/course/spatialEditorView.ts`、现有 Spatial command owner 与直接 Spatial panel，并新增两个目标文件；只允许更新 `tests/unit/spatialWorkspaceAuthoring.test.ts`、`tests/unit/spatialCameraSession.test.tsx`、`tests/unit/spatialWorldViewTransform.test.ts`、`tests/unit/readModelBoundary.test.ts` 及最窄 stale target 测试。禁止修改 Schema、Flow/Slide 模块、session camera 持久化、共享 inventory 或创建通用 Surface service。

## Execution

1. 固定 world/global/surface item、world/viewport transform、session camera、path/relation、semantic zoom、selection、Mixed 导航和 try-run 行为。
2. 定义 `SpatialLocationWorkspaceProps` 与 `SpatialLocationWorkspaceCommandPort`：readonly `SpatialEditorView`、session camera、stable targets、typed atomic commands、try-run callback 和 feedback；不包含 Store/whole document/`SpatialWorldAuthoringHost`/session get-set。
3. 迁移 world rendering/hit/gesture，再迁移 camera/path/relation；每组迁移同一提交删除 root 的对应 state/effect/import。
4. 抽 `SpatialPropertiesPanel`，只消费判别后的 Spatial context；保留现有 stable identity 与 coordinate-space 显式类型。
5. 在 read-model ratchet 禁止新模块读取旧 Project/Scene、其他 Surface selection、root Store 或把 camera 写回 document。

## Stop conditions

- 需要持久化 session camera、使用 DOM id/数组下标/hitId 作 target 或改变坐标语义。
- 需要统一 Flow/Slide/Spatial selection 或创建万能 Surface abstraction。
- 原 root 仍保留同一 Spatial handler/effect，形成双实现。

## Acceptance

- Spatial 模块不读取旧 Project/Scene、root Store 或其他 Surface selection；session camera 不进 CourseProject/History/save。
- `SpatialLocationWorkspace` 对 whole-session host/getSession/setSession 零命中；旧 target/revision 命令返回 stale 且 document/session/history 零写入。
- `Workspace.tsx`/`PropertiesTab.tsx` 删除 Spatial 内部 imports/state/effects/handlers，只保留 context/props 路由。
- world/viewport、camera/path/relation、semantic zoom、stable identity、编辑、保存重开、Undo/Redo、Mixed 导航和 try-run 全部不变。
- 无 re-export shell、第二 selection store 或跨 Surface command import。

## Focused validation

- `npx vitest run tests/unit/spatialWorkspaceAuthoring.test.ts tests/unit/spatialCameraSession.test.tsx tests/unit/spatialWorldViewTransform.test.ts tests/unit/readModelBoundary.test.ts`
- `npm run typecheck`

## Rollback / handoff

按 world、camera/path/relation 或 properties 纵切回滚；不得回写 session camera。交接列出仍在 root 的精确 Spatial 职责与缺失 port。
