# r11-054a-shared-contract-shells Shared contract 空壳删除

- Status / Owner: queued / unassigned
- Outcome / Evidence: 精确删除三个零消费者的 V8 shared contract 空壳；Course Project V9 正式类型与 strict schema 保持唯一 Owner，台账产品身份与删除后树一致。
- Write scope: `src/shared/{projectTypes,projectSchema,projectSchemaTypeContract}.ts`、`docs/development-plan/inventories/legacy-consumers.json`、本卡、后继卡与任务板。
- Write locks: legacy-inventory
- Acceptance: 三个精确路径不存在；LEG-011 仍无 confirmed/unknown/reference/symbol definition；V9 contract 与 top-level strictness 替代测试通过。
- Validation: `npx vitest run tests/unit/courseProjectCoreContract.test.ts tests/unit/courseProjectTopLevelFields.test.ts`、`npm run typecheck`、`npm run check:legacy-ready`。
