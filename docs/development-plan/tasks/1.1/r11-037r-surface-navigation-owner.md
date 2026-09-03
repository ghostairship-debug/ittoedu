# r11-037r-surface-navigation-owner Surface特有导航分支迁回对应slice

- Status / Owner: queued /
- Outcome / Evidence: 把 setSpatialGraphSelection、Flow block 激活和 Surface 特有导航分支迁回对应 slice；crossSurfaceCommands 仅保留通用路由。
- Write scope: `src/renderer/composition/crossSurfaceCommands.ts`、`src/renderer/store/slices/flowAuthoringSlice.ts`、`src/renderer/store/slices/spatialAuthoringSlice.ts`、`src/renderer/store/editorStore.ts`
- Write locks: none
- Acceptance: Surface 特有导航分支归位对应 slice，通用路由不越权处理具体 session；目标测试通过。
- Validation: `npx vitest run tests/unit/surfaceNavigation.test.ts tests/unit/spatialCommands.test.ts` 与 `npm run typecheck`。
