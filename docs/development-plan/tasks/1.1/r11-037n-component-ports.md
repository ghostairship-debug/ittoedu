# r11-037n-component-ports 组件Authoring使用自己的窄ports

- Status / Owner: queued /
- Outcome / Evidence: 组件 Authoring 使用自己的窄 ports，不再依赖 FeatureAuthoringPorts 泛型聚合。
- Write scope: `src/renderer/components/commitComponentPackageAuthoring.ts`、`src/renderer/store/editorStore.ts`、必要的直接测试类型
- Write locks: none
- Acceptance: ports 成员只覆盖组件作者实际需要的 ports.* 调用；root 分别传对象；目标测试通过。
- Validation: `npx vitest run tests/integration/courseComponentPackageReplacementVerticalSlice.test.ts tests/integration/componentPackageReplacementRace.test.tsx` 与 `npm run typecheck`。
