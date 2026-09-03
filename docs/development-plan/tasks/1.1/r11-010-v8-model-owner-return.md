# r11-010-v8-model-owner-return 拆除 Course Project Model 中的 V8 所有权

- Status / Owner: queued / Codex
- Outcome / Evidence: 从 `courseProjectModel.ts` 删除已无产品入口的 V8→V9 migration 与 V8 Project/Scene type 依赖，将仍在使用的 Native/Component node→V9 LayerItem 转换收窄为非持久化 adapter input；不恢复 V8 导入。
- Write scope: `src/shared/courseProjectModel.ts`、必要的直接 type-only caller/测试、对 V8 migration 作正向要求的现有结构断言，以及本卡与任务板。禁止修改 V9 Schema wire、恢复旧导入 UI、scanner 或 inventory。
- Write locks: contracts-schema
- Acceptance: `courseProjectModel.ts` 不再 import `projectTypes.ts` / `projectSchema.ts`，不再定义 V8 migration 或 legacy compatibility error；转换器对 Native/Component 节点的 V9 LayerItem 结果不变；结构检查改为禁止 V8 migration 回流。
- Validation: `npx vitest run tests/unit/courseProjectCoreContract.test.ts tests/unit/readModelBoundary.test.ts tests/unit/architectureDependencyRatchet.test.ts` 与 `npm run typecheck`。
