# r11-037i-slide-persist-owner 把 Slide persist 逻辑下沉收敛至 slideAuthoringSlice

- Status / Owner: queued /
- Outcome / Evidence: 把 Slide persist 逻辑完全收敛在 slideAuthoringSlice，消除 root 冗余实现。
- Write scope: `src/renderer/store/editorStore.ts`、`src/renderer/store/slices/slideAuthoringSlice.ts` 及关联单测
- Write locks: none
- Acceptance: Slide persist 由 slideAuthoringSlice 完全驱动，editorStore.ts 中无重复包装或未使用的 persist helper；目标测试通过。
- Validation: `npx vitest run tests/unit/slideAuthoringBackend.test.ts tests/unit/v9SlideProductIntegration.test.tsx` 与 `npm run typecheck`。
