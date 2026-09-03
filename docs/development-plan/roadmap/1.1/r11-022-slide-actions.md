# r11-022-slide-actions｜Slide 动作完全走 V9 command/history

- Release / Dependencies: 1.1 / r11-020-slide-effective-read-model
- Write locks: `editor-store-history`
- Inventory access: read
- Preservation: PM-03, PM-08–PM-09, PM-12–PM-15

## Outcome / current evidence

Slide 的复制、粘贴、重复、删除、重排和批量 Delete 从同一 V9 输入形成一次原子提交、一次选区更新和一条资源感知历史，不再经过旧 clipboard/history/project 镜像。

## Read first

- `src/renderer/course/v9SlideActionCommands.ts`
- `src/renderer/course/v9SlideClipboard.ts`
- `src/renderer/course/slideEditorCommands.ts`
- `src/renderer/course/courseReferenceCleanup.ts`
- `src/renderer/authoring/resourceAwareAuthoringHistory.ts`
- `tests/unit/unifiedDeleteTransaction.test.ts`

## Write scope

允许修改 Slide action/clipboard command、引用清理、资源感知历史适配、选择更新和直接测试。禁止修改 V9 Schema、Flow/Spatial 动作、Store 其他行为、导出、创建兼容双轨或把拒绝改成部分成功。

## Execution

1. 为单选/多选、global/surface/scene owner、Component/Runtime/asset 引用记录当前动作结果。
2. 所有动作从 canonical V9 document 与创建时 target 计算完整 plan；执行前验证 owner、revision、locked、引用和资源 delta。
3. Delete 同步清理 presentation overrides/order、互动引用、Runtime nodeBindings 和孤立资源规则；任何拒绝零写入。
4. 一次动作只提交一次 document+resource transaction 并在成功后更新 selection。
5. 删除旧 clipboard/history 镜像的直接 consumer；不在本任务删除旧 Store 字段。交接列出预期减少的 LEG endpoint 与精确查询，不修改共享 inventory。

## Stop conditions

- command 无法从单一输入原子计算。
- 需要对不同 owner 分多次写入或保留双 History。
- 删除会留下引用悬挂或误删仍被其他 owner 使用的资源。

## Acceptance

- 复制/粘贴/重复/重排/统一 Delete 在受支持 owner 上行为不变并可 Undo/Redo。
- 拒绝和 stale 均零写入；成功时 revision 精确增加一次。
- action 路径不读/写旧 project、clipboard 或 history 镜像。

## Focused validation

- `npx vitest run tests/unit/v9SlideActionCommands.test.ts tests/unit/unifiedDeleteTransaction.test.ts tests/unit/crossSurfaceResourceHistory.test.ts`
- `npm run typecheck`

## Rollback / handoff

整体回滚一个动作纵切，恢复其单一旧路径；不得同时保留新旧 writer。交接列出尚未迁移的动作及 LEG endpoint。
