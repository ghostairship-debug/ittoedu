# r11-020-v8-projection-owner-return 移除 live V8 投影类型

- Status / Owner: queued / Codex
- Outcome / Evidence: 消除 r11-053 扫描证实的 live V9 Editor/Player consumer 对 V8-only `GlobalLayerItem`、`GlobalLayerVisibility` 与 `ExternalComponentNode` 的类型依赖，改用 Course Project V9 / Published V2 / Component V4 已有的窄输入类型；不恢复 SceneNode 投影或新建兼容联合。
- Write scope: `src/player/globalLayerVisibility.ts`、仍直接 import V8-only 三类型的 live `src/renderer/**` caller、`src/player/surfaces/publishedComponentMount.ts`、`src/renderer/components/ComponentAuthoringTargetRegistry.ts` 及它们的直接测试，以及本卡与任务板。禁止修改 V8-only Player/Export/Shared 模块、Schema wire、scanner 或 inventory。
- Write locks: workspace-properties, published-producer
- Acceptance: live V9/Published 路径不再 import `GlobalLayerItem`、`GlobalLayerVisibility` 或 `ExternalComponentNode`；位置可见性、预览重建、组件 identity/props 与历史语义不变；不引入 V8/V9 union。
- Validation: `npx vitest run tests/unit/v9GlobalLayerUiAdapter.test.tsx tests/unit/slidePreviewRebuildKey.test.ts tests/unit/publishedComponentMount.test.ts tests/unit/componentAuthoringTargetRegistry.test.ts tests/unit/componentTextEditSession.test.ts` 与 `npm run typecheck`。
