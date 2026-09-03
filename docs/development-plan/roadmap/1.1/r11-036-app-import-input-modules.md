# r11-036-app-import-input-modules｜App 素材/组件导入与全局输入路由解耦

- Release / Dependencies: 1.1 / r11-014-media-design-component-consumers, r11-025-editor-store-v9-only
- Write locks: `editor-store-history`, `workspace-properties`
- Inventory access: `read`
- Preservation: PM-01, PM-03–PM-15, PM-17

## Outcome / current evidence

`App.tsx` 的媒体导入/替换、Component 包导入/替换和全局键盘 action 分别进入 `useMediaImport`、`useComponentLibrary`、`useEditorKeyboardRouter`。每个模块捕获 canonical target/revision 并调用现有 document+resource transaction 或统一 action snapshot，不暴露 raw Store/module bag。

## Read first

- `src/renderer/App.tsx`
- `src/renderer/media/`
- `src/renderer/components/`
- `src/renderer/authoring/editorTransaction.ts`
- `src/renderer/store/editorStore.ts`
- `tests/unit/editorActionRouting.test.ts`

## Exact targets

| New module | Owns | Does not own |
|---|---|---|
| `src/renderer/app/useMediaImport.ts` | choose/read/import/replace request 与 canonical transaction 编排 | asset hash/dedupe 规则副本、Surface placement |
| `src/renderer/app/useComponentLibrary.ts` | package import/validate/register/replace request 编排 | Catalog/Package 领域实现、Surface carrier |
| `src/renderer/app/useEditorKeyboardRouter.ts` | Delete/Copy/Paste/Duplicate/Nudge/Undo/Redo action snapshot 与焦点守卫 | Surface command 实现、IME draft、raw key side effect |
| `App.tsx` | 只把 UI 事件交给三个 hook | 媒体/组件/键盘 Surface 分支 |

## Write scope

只允许修改 `src/renderer/App.tsx`、现有 media/component/action routing adapters，并新增三个 Exact target；只允许更新 `tests/unit/assetTransactions.test.ts`、`tests/unit/editorActionRouting.test.ts`、`tests/integration/mixedCrossSurfaceHistory.test.tsx`、`tests/unit/readModelBoundary.test.ts`。禁止修改 Schema、Catalog/asset identity 语义、Surface command、Main file IPC、共享 inventory 或建立通用 app service container。

## Execution

1. 固定素材导入/替换/孤立清理、Component 包导入/替换/回滚，以及 Delete/Copy/Paste/Duplicate/Nudge/Undo/Redo 的焦点、IME、Mixed 与 History 行为。
2. 为每个 hook 定义最小 ports：dialog/read bytes、canonical target snapshot、domain validate/plan、transaction commit、feedback；不传完整 Store/Preload API。
3. 先迁 media，再迁 component；捕获操作开始时 target/revision，读取/校验完成后重验，document+resource 同成同败。
4. 迁 keyboard router；它只做事件规范化、焦点/IME guard 与 action snapshot，真正 Surface command 仍由正式 owner 执行。
5. 每迁一组，在同一提交删除 App 中对应 imports/state/effects/handlers/switch；收紧 boundary test。

## Stop conditions

- 需要改变 asset/component identity、Surface carrier、键盘可见行为或 IPC wire。
- hook 只能直接调用 `useEditorStore.getState/setState` 或复制领域 planner。
- App 与 hook 同时保留相同导入/键盘分支。

## Acceptance

- 三个 hook 不 import root Store、不返回通用 module bag；`App.tsx` 不保留媒体/组件 planner 或按 Surface 分叉的键盘业务规则。
- 媒体与组件捕获 canonical target/revision，通过唯一 document+resource transaction 提交；stale/cancel/failure 零部分写入，一次 Undo 精确恢复。
- 键盘焦点/IME、Slide/Flow/Spatial/Mixed 的 Delete/Copy/Paste/Duplicate/Nudge/Undo/Redo 行为不变。
- 原 App 迁出职责真实删除，无 facade/re-export/双 handler。

## Focused validation

- `npx vitest run tests/unit/assetTransactions.test.ts tests/unit/editorActionRouting.test.ts tests/integration/mixedCrossSurfaceHistory.test.tsx tests/unit/readModelBoundary.test.ts`
- `npm run typecheck`

## Rollback / handoff

按 media、component 或 keyboard 的完整纵切回滚；不得保留新旧两条提交路径。交接列出缺少的窄 domain/desktop port 与失败断言。
