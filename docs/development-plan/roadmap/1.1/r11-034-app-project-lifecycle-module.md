# r11-034-app-project-lifecycle-module｜App 打开、保存与 Recovery 形成生命周期模块

- Release / Dependencies: 1.1 / r11-025-editor-store-v9-only, r11-051-v9-archive-only
- Write locks: `app-save-recovery`, `workspace-properties`
- Inventory access: `read`
- Preservation: PM-01–PM-02, PM-06, PM-10–PM-13, PM-26

## Outcome / current evidence

`App.tsx` 中工程新建/打开/最近项目、save/Save As、dirty/close、draft prepare/ack 与 Recovery schedule/offer/clear 迁入单一 `useCourseProjectLifecycle` 模块。该模块只消费 canonical V9 persistence snapshot 与明确 desktop/store ports，不返回完整 Store，也不处理 Preview/Export。

## Read first

- `src/renderer/App.tsx`
- `src/renderer/project/courseProjectIo.ts`
- `src/renderer/project/recoveryWriteCoordinator.ts`
- `src/renderer/authoring/courseAuthoringSession.ts`
- `src/renderer/authoring/editorTransaction.ts`
- `tests/integration/draftSaveTransaction.test.tsx`

## Exact targets

| Responsibility | New owner | Required invariant |
|---|---|---|
| new/open/recent/load/close | `src/renderer/app/useCourseProjectLifecycle.ts` | invalid open 不污染当前工程/最近项目 |
| save/Save As/single-flight | 同上 | 保存已提交草稿；保存中编辑仍 dirty；Save As 新路径 |
| draft prepare/ack | 同上，通过窄 authoring port | 只确认实际落盘 revision |
| Recovery schedule/offer/clear | 同上，通过现有 coordinator | stale/cancel 不覆盖新 revision |
| `App.tsx` | 只渲染 shell、调用 hook 返回的 commands/status | 不实现 archive/save/recovery effect |

## Write scope

只允许修改 `src/renderer/App.tsx`、现有 project/recovery/authoring port 文件，并新增 `src/renderer/app/useCourseProjectLifecycle.ts`；只允许更新 `tests/integration/draftSaveTransaction.test.tsx`、`tests/unit/courseDraftPersistence.test.ts`、`tests/unit/recoveryWriteCoordinator.test.ts`、`tests/unit/courseProjectIo.test.ts`、`tests/unit/readModelBoundary.test.ts`。禁止修改 Schema、导出/Preview、Main/Preload IPC wire、Store writer、共享 inventory 或新增第二 persistence coordinator。

## Execution

1. 固定新建/打开/最近项目、save/Save As、活动草稿、single-flight、保存中继续编辑、关闭 dirty、Recovery debounce/cancel/offer/clear 的当前行为。
2. 定义 `CourseProjectLifecyclePorts`：读取 canonical persistence snapshot、prepare/ack draft、desktop open/save/recent、recovery coordinator、commit app status、report error；每项是窄函数，不传 Store/API bag。
3. 先迁 open/recent/load，再迁 save/Save As，最后迁 Recovery；每个纵切在同一提交从 `App.tsx` 删除对应 state/effect/handler/import。
4. hook 只返回 UI 需要的 status 与 commands；不返回 document、Store、Main API 或格式 builder。
5. 保持 session generation/project identity/revision 检查；任何迟到 load/save/recovery 结果先核对创建时 identity，失败零错写。
6. 收紧 boundary test：App lifecycle 模块不得 import root Store、Preview/Export builder 或旧 Project/V8 adapter。

## Stop conditions

- 需要改变 V9 archive wire、Main/Preload IPC 或保存/恢复语义。
- hook 只能通过完整 Store/Preload module bag 工作。
- 迁移期间必须同时保留 App 与 hook 两个 save/recovery effect。

## Acceptance

- `App.tsx` 不含 archive build、save single-flight、draft ack 或 Recovery effect 实现；新模块不 import root Store/Preview/Export。
- 活动草稿先提交；磁盘失败不清 dirty；保存期间新编辑仍 dirty；Save As 不覆盖原文件且新 identity 不复制本地会话。
- stale load/save/recovery 不改当前工程；打开无效工程不污染最近项目。
- 新建、打开、保存、关闭重开、恢复和 Undo/Redo 行为不降级；原 App 职责真实消失而非 wrapper/re-export。

## Focused validation

- `npx vitest run tests/integration/draftSaveTransaction.test.tsx tests/unit/courseDraftPersistence.test.ts tests/unit/recoveryWriteCoordinator.test.ts tests/unit/courseProjectIo.test.ts tests/unit/readModelBoundary.test.ts`
- `npm run typecheck`

## Rollback / handoff

按 open、save 或 recovery 的完整纵切回滚，不能保留两个 effect。交接列出未迁职责、创建时 identity 和失败的行为断言。
