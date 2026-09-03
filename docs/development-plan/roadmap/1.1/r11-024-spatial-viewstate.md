# r11-024-spatial-viewstate｜Spatial 视图只读 V9 session

- Release / Dependencies: 1.1 / r11-013-shared-native-consumers
- Write locks: `workspace-properties`
- Inventory access: read
- Preservation: PM-05–PM-06, PM-08–PM-09, PM-12, PM-17

## Outcome / current evidence

Spatial Workspace、world items、camera、path、relation、semantic zoom、导航和 selection 只从活动 V9 Spatial session 与 `SpatialEditorView` 读取；会话相机仍不进入 Course Project、History 或保存物。

## Read first

- `src/renderer/course/spatialEditorView.ts`
- `src/renderer/ui/Workspace.tsx`
- `src/renderer/ui/SpatialCameraPanel.tsx`
- `src/renderer/ui/SpatialPathEditor.tsx`
- `src/renderer/course/courseTreeView.ts`
- `tests/unit/spatialCameraSession.test.tsx`

## Exact targets

| Target | Required replacement | Forbidden change |
|---|---|---|
| `buildSpatialEditorView` / `composeSpatialEditorLocation` | 活动 V9 document + location + session camera 产生 deep-readonly view | 不把 session camera 写回 document/History |
| `createSpatialWorldViewTransform` / viewport overlay transform | 保持 world/viewport 两坐标系和 zoom 语义 | 不用 DOM/Phaser proxy 反建工程 |
| `Workspace` Spatial branch | world/global/surface items、selection、hit 与 media 从 typed view/session 读取 | 不与 Flow/Slide selection 合并 |
| `SpatialCameraPanel` / `SpatialPathEditor` / course tree camera nodes | 使用稳定 frame/path/relation/layer identity | 不用数组下标、label 或 hitId 作命令 target |

## Write scope

只允许修改表中实现文件及 `tests/unit/spatialCameraSession.test.tsx`、`tests/unit/spatialWorkspaceAuthoring.test.ts`、`tests/unit/spatialWorldViewTransform.test.ts` 的直接用例。禁止修改 Flow、Spatial command/Schema、Store writer、共享 inventory或持久化相机。

## Execution

1. 在目标测试固定 world/global/surface item、session camera、path/relation、semantic zoom、selection、Mixed 导航与 sessionless 的当前结果。
2. 补齐 `SpatialEditorView` 的稳定 identity、owner、coordinate space、camera/frame、path/relation 与可见性只读字段；不复制整份 project。
3. 依次切换 Workspace Spatial branch、Camera panel、Path editor、Tree camera nodes；每切一个 consumer 先跑对应目标测试。
4. 保持 world/viewport 坐标变换、细线命中、media、controller、camera session 与现有 try-run；所有写入仍走既有 Spatial command。
5. 删除这些 target 对旧 Store/project read 的调用；交接列出 LEG ID、旧 path#symbol、replacement 与零查询，不修改共享 inventory。

## Stop conditions

- 需要持久化 session camera、DOM id、数组下标或 hitId。
- 需要把 Spatial carrier/selection 与 Flow 或 Slide 抹平。
- world transform、path/relation、semantic zoom、Mixed 导航或 try-run 结果改变。

## Acceptance

- Spatial/Mixed 的编辑、导航、选择、camera、path/relation、semantic zoom 与 try-run 结果不变。
- 表中 target 不读取旧 Project/Scene；sessionless fail-loud 且不 fallback。
- typed view 无 writer/History/持久化出口；精确 LEG handoff 可重现。

## Focused validation

- `npx vitest run tests/unit/spatialCameraSession.test.tsx tests/unit/spatialWorkspaceAuthoring.test.ts tests/unit/spatialWorldViewTransform.test.ts`
- `npm run typecheck`

## Rollback / handoff

整体回滚 Spatial view consumer 切换，不触碰 Flow。交接列出仍读旧 project 的精确 Spatial path#symbol、失败断言和首个前置缺口。
