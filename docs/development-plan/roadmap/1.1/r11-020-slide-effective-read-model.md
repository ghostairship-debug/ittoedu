# r11-020-slide-effective-read-model｜Slide 使用只读 V9 effective view

- Release / Dependencies: 1.1 / r11-013-shared-native-consumers
- Write locks: `workspace-properties`
- Inventory access: read
- Preservation: PM-03, PM-07–PM-09, PM-12, PM-17

## Outcome / current evidence

Slide 画布命中、框选、选区外框和缩略图直接消费只读 V9 effective view，不为读取而构造完整 `SceneDocument` / `ProjectDocument`；写入仍只走现有 V9 command/history。

## Read first

- `src/renderer/course/effectiveLayerProjection.ts`
- `src/renderer/course/slideEditorView.ts`
- `src/renderer/phaser/v9SlideHitAdapter.ts`
- `src/renderer/ui/Workspace.tsx`
- `src/renderer/authoring/stageViewportTransform.ts`
- `src/renderer/store/slideEditorProjection.ts`

## Write scope

允许扩展现有 effective/slide read selector、V9 hit adapter、Workspace 的命中/选区适配和直接测试。禁止修改 Store writer、Properties、保存/Published、SceneNode union、Table/Chart 或建立可写 read model。

## Execution

1. 用当前测试记录 text/formula/image/video/shape/component/runtime、global/surface/scene owner、旋转、锁定和细线命中的现状。
2. 扩展现有 V9 effective view，输出稳定 authoringAddress、owner、frame、rotation、order、visibility、locked、hit policy 与最窄 content summary。
3. 让 V9 hit adapter、选择框和缩略图只读该 view；不要从 DOM/Phaser proxy 反建工程。
4. 保留临时 hitId 仅作会话命中，不让其进入持久化或 command target。
5. 写入继续调用现有 command，selection 仍是 Surface state，不创建第二真相；交接列出预期减少的 LEG endpoint 与精确查询，不修改共享 inventory。

## Stop conditions

- 需要让 read view 可写或进 History。
- 需要新增第二 selection store/session。
- 无法保持旋转、缩放、global plane 或细线命中语义。
- 当前现有 view 已完全满足 Outcome；此时以证据交回 Integrator，不做空迁移。

## Acceptance

- 命中/框选/多选/锁定/旋转边界与当前行为一致。
- 相关路径不构造完整旧 Scene/Project，也不读取 `EditorState.project`。
- read view 无 schemaVersion、writer、History 或持久化出口。

## Focused validation

- `npx vitest run tests/unit/effectiveLayerProjection.test.ts tests/unit/v9SlideBackendSelection.test.ts tests/unit/v9SlideViewportAdapter.test.ts`
- `npm run typecheck`

## Rollback / handoff

回滚本次 view/adapter 切换，保留旧 consumer 到修复完成；不得删除已证明必要的选择能力。交接列出仍读旧投影的命中 consumer。
