# r11-000-authority-contracts｜锁定 1.1 执行权威

- Release / Dependencies: 1.1 / none
- Write locks: `contracts-schema`
- Inventory access: none
- Preservation: PM-01–PM-28

## Outcome / current evidence

执行时的总纲、架构合同、V9 兼容策略与路线 manifest 对 1.1 零降级、V8 清零范围、Table/Chart 例外、AI 时序、发布制品和信任边界没有冲突。当前路线已经记录 Owner 决策；本任务只在漂移时修正权威文档，不重做产品实现。

## Integrator audit / re-entry（2026-09-03）

接手审计运行 `npm run check:development-roadmap` 时报告 25 个路径问题；本次计划纠偏后当前仍有 13 项，均须按归属处理。现有 checker 把可执行命令、Read first、历史说明和“应删除的旧路径”一律当作当前入口，既报出真实 stale command，也误伤合法删除说明。本节点重新验收路线裁判：逐项分类当前报告的全部引用，修复真实 focused/evidence command 与链接；checker 只对声称当前可执行或可读取的路径强制存在，仍允许历史说明与删除目标引用已不存在的文件。不得全局放宽为“不检查测试路径”。若修正裁判后只剩 `PRESERVATION_MATRIX.md` / preservation map 中真实 stale evidence，本节点精确交给 r11-001，不以越界修改 evidence 冒充完成。

## Read first

- `COURSEWARE_DEVELOPMENT_PLAN.md`
- `AGENTS.md`
- `docs/development-plan/ARCHITECTURE_CONTRACT.md`
- `docs/contracts/V9_COMPATIBILITY_POLICY.md`
- `docs/development-plan/roadmap/manifest.json`
- `docs/development-plan/roadmap/PRESERVATION_MATRIX.md`

## Write scope

允许修改上述权威文档、本路线的链接/manifest 元数据、`scripts/check-development-roadmap.ts` 与其直接回归测试 `tests/unit/developmentRoadmap.test.ts`；只有固定入口本身错误时才可更新 `package.json` 中现有 `check:development-roadmap` script。禁止修改 `src/**`、产品行为测试、生成制品、任务板或创建 Ready 任务卡；禁止引入 V10、V8 导入、安装包承诺或更改已锁定 Owner 决策。

## Execution

1. 读取当前 HEAD 和工作树，只记录事实，不要求 clean worktree。
2. 逐项比对六份权威材料，确认路线 manifest 不含执行状态。
3. 若文字冲突但决策清楚，只在唯一权威处写全文，其他位置改为指针。
4. 若源码事实已使某项决定不可执行，停止并提交冲突证据给 Owner；不得自行改决定。
5. 对引用分类建回归：Focused validation / evidence command 中不存在的测试必须失败；Read first 或正式链接失效必须失败；历史说明与明确 deletion target 可引用已删除文件而不失败。
6. 运行路线检查并检查 diff 只含权威同步与最窄 checker/test 修正；列出仍失败的每个精确路径及唯一 Owner。只有 r11-001 所有的 preservation stale evidence 可以作为本节点退出时的已知后继红灯，其他 checker 语义或路线引用问题必须在本节点闭合。

## Stop conditions

- 需要改变用户已锁定的发布、AI、信任或 Schema 决策。
- 发现正式 Schema 与路线目标无法兼容。
- 需要修改产品代码才能让文档“看起来一致”。

## Acceptance

- 不再出现“AI 统一延后到 2.0 以后”或把未来能力写成当前能力的冲突。
- 1.1 明确零降级、零旧 consumer、V9 wire 不变；1.2 的 Table/Chart 例外单独登记。
- manifest 只有稳定依赖元数据，任务状态仍只来自任务板。
- checker 语义回归通过：不存在的真实命令路径会稳定失败，删除目标 prose 不会被误判为可执行入口；除精确列给 r11-001 的 preservation stale evidence 外，`check:development-roadmap` 不再有本节点所有的失败。
- r11-001 在 r11-002 启动前必须把上述 stale evidence 闭合并使完整 `check:development-roadmap` 通过；r11-000 的局部 checker 通过不得被写成整条路线门已绿。

## Focused validation

- `npm run check:development-roadmap`
- `npx vitest run tests/unit/developmentRoadmap.test.ts`
- `npm run check:task-board`
- `git diff --check`

## Rollback / handoff

回滚本任务的权威文档 diff；不回滚用户已有工作。报告每个冲突的权威位置及裁决结果，然后停止。
