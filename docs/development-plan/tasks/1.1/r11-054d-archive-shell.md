# r11-054d-archive-shell Archive 空壳删除

- Status / Owner: blocked / Integrator
- Outcome / Evidence: 精确删除最后一个零消费者的 V8 archive 空壳；Course Project V9 archive codec 保持唯一可打开工程路径，旧版本继续 fail-loud。
- Write scope: `src/renderer/project/projectArchive.ts`、`docs/development-plan/inventories/legacy-consumers.json`、本卡、后继卡与任务板。
- Write locks: legacy-inventory
- Acceptance: 精确路径不存在；全部 file-absent targets 已消失；台账只含 removed 记录且 ready 模式 targetDefinitions/legacyModulesPresent 均为 0。
- Validation: `npx vitest run tests/unit/courseProjectArchive.test.ts`、`npm run typecheck`、`npm run check:legacy-ready`。
