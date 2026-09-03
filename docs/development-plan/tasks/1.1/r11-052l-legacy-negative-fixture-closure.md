# r11-052l-legacy-negative-fixture-closure Legacy 否定断言与导航夹具收口

- Status / Owner: queued / unassigned
- Outcome / Evidence: 清理不再代表产品依赖的旧符号字面量与 repo-index 旧 Owner 夹具，同时保留 V8 拒绝、架构禁止项、旧工具不安装等负向保障；静态扫描不再把这些保护性断言误计为产品 consumer。
- Write scope: `tests/unit/architectureDependencyRatchet.test.ts`、`tests/unit/courseProjectCoreContract.test.ts`、`tests/unit/courseProjectTopLevelFields.test.ts`、`tests/unit/coursewareSkillsInstaller.test.ts`、`tests/unit/spatialWorkspaceAuthoring.test.ts`、`tests/e2e/componentCatalogMatrix.spec.ts`、`tests/e2e/editor.spec.ts`、`scripts/repo-index/fixtures/adapter/src/index.ts`、对应 repo-index 测试、本卡与任务板。禁止修改产品行为、scanner、inventory、timeout/retry 或放宽 V8 拒绝。
- Write locks: none
- Acceptance: 负向断言仍校验同一禁止项但不保留连续 legacy token；repo-index 夹具改指向正式 V9 Owner；旧 V8 常量不再作为 V9 顶层字段测试依赖；相关测试通过。
- Validation: `npx vitest run tests/unit/architectureDependencyRatchet.test.ts tests/unit/courseProjectCoreContract.test.ts tests/unit/courseProjectTopLevelFields.test.ts tests/unit/coursewareSkillsInstaller.test.ts tests/unit/spatialWorkspaceAuthoring.test.ts tests/unit/repoIndexGenerator.test.ts tests/unit/repoIndexSemantic.test.ts tests/unit/repoIndexTypeScriptAdapter.test.ts`、`npm run typecheck`。
