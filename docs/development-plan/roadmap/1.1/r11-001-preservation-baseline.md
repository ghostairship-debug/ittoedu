# r11-001-preservation-baseline｜建立不可降级行为基线

- Release / Dependencies: 1.1 / r11-000-authority-contracts
- Write locks: `generated-index`
- Inventory access: none
- Preservation: PM-01–PM-28

## Outcome / current evidence

在开始删除旧 consumer 前，固化不可变的 1.1 期望基线和严格 28 行机器映射，并创建供任意当前候选复算证据的 package script `check:preservation`。初始 baseline 只记录期望、fixture identity 与失效闭包；每个候选另写报告，不能覆盖迁移前证据或冒充 Owner accepted。

## Integrator audit / re-entry（2026-09-03）

PM-01–PM-28 的行为标准和固定课例身份继续有效，但当前机器映射无效：`check:preservation` 以 `malformed-map` 失败，至少 PM-15 仍引用已删除的 `courseRuntimeKernel*.test.ts`，PM-21 仍引用已删除的 `webPackageExport.test.ts`。由于 r11-002 的稳定 DAG 前置就是本节点，必须先在当前可恢复 product closure 上重绑已经存在的真实 V9/V2 evidence、input closure 与失效条件，使 preservation 与路线门恢复为绿，再允许 scanner 固化上界。不改变 PM 语义，不恢复旧测试，也不把“另一个测试存在”当作等价证明。此后 r11-052 若删除、改名或新增 replacement evidence，必须在 r11-052 同一变更更新本节点产出的 map/matrix，而不是把一个已知红门留给另一次 r11-001。

## Read first

- `docs/development-plan/roadmap/PRESERVATION_MATRIX.md`
- `docs/development-plan/WORKING_PROTOCOL.md`
- `tests/integration/architectureBaselineFlows.test.tsx`
- `tests/unit/courseProjectRoundTrip.test.ts`
- `tests/unit/courseProjectArchive.test.ts`
- `package.json`

## Write scope

只允许新增或更新 `docs/development-plan/baselines/V1_1_PRESERVATION_BASELINE.md`、`docs/development-plan/baselines/v1.1-preservation-map.json`、`docs/development-plan/roadmap/PRESERVATION_MATRIX.md` 中不改变行为标准的 evidence 引用、固定入口 `scripts/check-preservation.ts`、`package.json` 中唯一的 `check:preservation` script，以及为该入口所需的最窄目标测试。候选报告只能写 `artifacts/release-evidence/v1.1/<candidate>/preservation.json`。禁止修改产品行为、PM 语义、replacement 测试断言、其他 package script 和历史 baseline。

## Execution

1. 在 baseline 固定 `slide-heavy`、`flow-heavy`、`mixed-spatial` 三个 architecture fixture，以及 `examples/render-host-benchmark/render-host-benchmark-v9.h5lesson` / `render-host-benchmark-v2.html` 为 1.1 候选和 Owner 共用载体；记录它们的语义身份与生成命令，不把 Hash 当行为证据。
2. 建立严格 JSON 映射：恰有 PM-01–PM-28 各一行；每行只含 ID、`automated` 或 `owner-observation` 类型、精确 evidence command/observer、fixture IDs、输入闭包和失效条件。缺失、重复、未知字段、非法状态或不存在入口均为配置错误。
3. 实现 `scripts/check-preservation.ts` 并只通过 package script `check:preservation` 暴露。默认工作树模式按当前文件内容计算 closure digest、执行所有 automated 行并报告 dirty 路径，不复用改动前结果；这允许 r11-001/052 在未获 commit 授权时验证本任务声明写入范围内的 map/test 同步变更，任务自身仍须用 diff 证明没有范围外 dirty。`--require-clean` candidate mode 则拒绝 evidence closure 的任何 dirty，供 r11-061 使用。只有显式 report path 才写候选 JSON，且不得覆盖 baseline。map、matrix、checker、命令定义及其直接测试本身都属于 evidence definition closure，任一变化都会使旧结果失效。
4. 任一 automated 行失败/blocked、底层命令失败、报告损坏、候选身份不符、证据 stale 或 28/28 映射不完整时退出非零；`--require-clean` 下 relevant dirty 也退出非零。默认工作树模式发现 scope 外 dirty 时由当前任务停止，不把它写成通过报告。`owner-observation-required` 不阻断 engineering candidate，但既不是 automated pass，也不能变成 `accepted`。
5. 复用未失效证据时必须在候选报告列出来源 candidate 和闭包比较；对保存/重开、三 Surface/Mixed、Player 与适用导出使用真实 fixture/产物，不用字符串或 Hash 代替行为。
6. 先对当前工作树的已删除/改名测试逐 case核对同层 V9/V2 replacement，将每个受影响 PM 行重绑到当前真实证据；所有 `evidenceCommand`、`inputClosure` 与矩阵引用必须指向当前存在的路径。映射修复后同时通过 preservation checker 与 development-roadmap checker，才可交给 r11-002。
7. 后续 r11-052 改变任一 evidence command、测试路径或 input closure 时，由 r11-052 在同一变更更新 map/matrix 并重跑两门；若其他节点改变 evidence definition closure，则返回本节点重建，不复用旧报告。

## Stop conditions

- 固定候选存在确定性产品红灯。
- 某矩阵行没有可执行证据且需要改变产品范围才能验证。
- 必须弱化断言、删入口或跳过真实 carrier 才能得到绿灯。

## Acceptance

- PM-01–PM-28 每行有候选级状态、证据和失效条件。
- 任何缺口都显式阻断后续删除，不伪装成 pass。
- 报告不把 automation candidate 宣称为 Owner accepted。
- `package.json` 恰有一个 `check:preservation` 入口，调用固定脚本；构造一个自动项失败时命令退出非零，人工观察项未签署本身不导致自动门假失败或假通过。
- baseline 与 candidate report 分离；缺 PM、重复 PM、坏映射、stale candidate、`--require-clean` relevant dirty、底层失败六类 fixture 均退出非零且诊断类别稳定；默认工作树模式在 map/test 同步修改后按新内容重算而非误用旧报告。
- PM-15、PM-21 及所有受 r11-052 影响的行不再引用被删测试，并有逐 case replacement 证据；`check:preservation` 不再以 `malformed-map` 失败。
- map、matrix、checker、package command 与直接回归测试均纳入 evidence definition closure；`check:preservation` 和 `check:development-roadmap` 在 r11-002 启动前同时通过。

## Focused validation

- `npx vitest run tests/integration/architectureBaselineFlows.test.tsx tests/unit/courseProjectRoundTrip.test.ts tests/unit/courseProjectArchive.test.ts`
- `npx vitest run tests/unit/preservationChecker.test.ts`
- `npm run check:preservation`
- `npm run check:development-roadmap`
- `npm run check:examples`
- `npm run typecheck`

## Rollback / handoff

删除本任务新增的候选报告/生成器即可；产品代码应无 diff。交接列出尚需 Owner 观察的 PM ID，并明确要求后续 r11-052 在改变 evidence 时同任务维护 map/matrix。
