# r11-023-flow-viewstate｜Flow 视图只读 V9 session

- Release / Dependencies: 1.1 / r11-013-shared-native-consumers
- Write locks: `workspace-properties`
- Inventory access: read
- Preservation: PM-04, PM-06, PM-08–PM-09, PM-12, PM-17

## Outcome / current evidence

Flow Workspace、课程树、导航、正文选择和 overlay view state 只从活动 V9 Flow session 与 `FlowEditorView` 读取，不借旧 `ProjectDocument` 填充 UI；Flow 正文仍是语义合成边界，不退化为绝对定位 Layer 集合。

## Read first

- `src/renderer/course/flowEditorView.ts`
- `src/renderer/course/courseTreeView.ts`
- `src/renderer/ui/FlowWorkspace.tsx`
- `src/renderer/ui/Workspace.tsx`
- `src/renderer/store/editorStore.ts`
- `tests/unit/flowEditorView.test.ts`

## Exact targets

| Target | Required replacement | Forbidden change |
|---|---|---|
| `buildFlowEditorView` / `composeFlowEditorLocation` | 活动 `CourseProjectDocument` + location ID 产生 deep-readonly Flow view | 不返回 writer、History 或旧 Project/Scene |
| `listFlowCourseTreePages` / `buildCourseTreeView` 的 Flow branch | 使用稳定 surface/location/block identity | 不用数组下标或 DOM ID 作持久身份 |
| `FlowWorkspace` 的正文、overlay、selection reads | 只读 `FlowEditorView` 与 Flow local selection | 不把 FlowBlock 转成 LayerItem，不建第二 selection store |
| `Workspace` 的 Flow 分派 | sessionless 显示现有可行动错误 | 不 fallback 到 `EditorState.project` |

## Write scope

只允许修改上述四个实现文件和 `tests/unit/flowEditorView.test.ts`、`tests/unit/flowWorkspace.test.tsx`、`tests/unit/courseTreeView.test.ts` 中的直接用例。禁止修改 Spatial、Flow command/Schema、Store writer、共享 inventory 或删除 Flow 能力。

## Execution

1. 在目标测试固定正文 paragraph/formula/media/component、overlay、课程树、Mixed 导航与 sessionless 的当前结果。
2. 补齐 `FlowEditorView` 只读字段：稳定 identity、正文/outline、overlay owner/order/visibility/lock 与 active location；不复制整份 project。
3. 依次切换课程树、FlowWorkspace、Workspace Flow 分派；每切一个 consumer 先跑对应目标测试。
4. 保持正文语义排版、overlay authoring address、selection local owner 和现有 try-run 入口；写入仍调用既有 Flow command。
5. 删除这些 target 对旧 Store/project read 的调用；交接列出 LEG ID、旧 path#symbol、replacement 与零查询，不修改共享 inventory。

## Stop conditions

- 需要把 FlowBlock 变成 LayerItem、把 selection/scroll 写入工程或新增通用 Surface model。
- 无活动 session 时只能靠旧 project 恢复界面。
- 正文顺序、overlay owner、Mixed 导航、try-run 或编辑结果改变。

## Acceptance

- Flow/Mixed 的编辑、导航、选择、课程树和 try-run 与基线一致。
- 表中 target 不读取旧 Project/Scene；sessionless fail-loud 且不创建 fallback state。
- Flow view deep-readonly、无 writer/History/持久化出口；精确 LEG handoff 可重现。

## Focused validation

- `npx vitest run tests/unit/flowEditorView.test.ts tests/unit/flowWorkspace.test.tsx tests/unit/courseTreeView.test.ts`
- `npm run typecheck`

## Rollback / handoff

整体回滚 Flow view consumer 切换，不触碰 Spatial。交接列出仍读旧 project 的精确 Flow path#symbol、失败断言和首个前置缺口。
