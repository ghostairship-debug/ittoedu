# r11-037u-teacher-controller-injection 教师控制器显式注入解耦

- Status / Owner: queued /
- Outcome / Evidence: 删除教师控制器的模块级 bind/service locator；两个工厂的 ports 改为必填。
- Write scope: `src/renderer/authoring/v9TeacherControllerAuthoring.ts`、`src/renderer/store/editorStore.ts`、`src/renderer/ui/workspaces/SlideLocationWorkspace.tsx`、`tests/unit/teacherControllerAuthoringBounds.test.ts`、`tests/unit/teacherControllerAuthoringOwnership.test.tsx`、`tests/unit/teacherControllerRuntimeSession.test.ts`、`tests/unit/v9GlobalLayerUiAdapter.test.tsx`
- Write locks: none
- Acceptance: 删除 boundTeacherControllerAuthoringPorts 模块级变量和 bind 函数；工厂 ports 改为必填；测试与工作台显式传参；目标测试通过。
- Validation: `npx vitest run tests/unit/teacherControllerAuthoringBounds.test.ts tests/unit/teacherControllerAuthoringOwnership.test.tsx tests/unit/teacherControllerRuntimeSession.test.ts` 与 `npm run typecheck`。
