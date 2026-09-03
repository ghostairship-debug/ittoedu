# r11-037p-root-action-delegation root store 中四类 Feature actions 委托收口

- Status / Owner: queued /
- Outcome / Evidence: 将 root store 中四类 Feature actions（Runtime、Media、Component、Interaction）全部从 inline 闭包简化为纯粹的 slice/action 委托；消除重复顶层实现。
- Write scope: `src/renderer/store/editorStore.ts`
- Write locks: none
- Acceptance: root store 返回对象中 Feature actions 纯委托，无重复逻辑；目标测试通过。
- Validation: `npx vitest run tests/integration/courseRuntimeSourceAuthoringVerticalSlice.test.tsx tests/integration/courseInteractionAuthoringVerticalSlice.test.ts tests/integration/courseComponentPackageReplacementVerticalSlice.test.ts tests/integration/courseMediaLibraryImportVerticalSlice.test.ts` 与 `npm run typecheck`。
