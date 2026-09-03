# r11-053-legacy-inventory-reconciliation｜在集成 HEAD 原子复核 Legacy 台账

- Release / Dependencies: 1.1 / r11-055-architecture-modularity-gate
- Write locks: `contracts-schema`, `legacy-inventory`
- Inventory access: write
- Preservation: PM-01–PM-28

## Outcome / current evidence

在所有迁移 lane 已集成且工作树不再变化的同一 product candidate 上，逐条重扫七类 consumer，并一次性刷新唯一 `legacy-consumers.json`。完成后 `reconciledProductCommit`、scope 与排除 inventory 自身的 product tree digest 一致，所有待删除目标均无 unknown，confirmed consumer 为零；本任务不删除任何产品或测试文件。

## Integrator audit / prior reconciliation void（2026-09-03）

2026-09-02 的 reconciliation、digest、LEG-008 结论和候选 deletion list 全部作废：之后产品树继续变化，r11-002 scanner 存在 false-pass，r11-026/029/037/052/055 也未满足退出条件。当前不具备本节点启动条件。

重新进入时必须同时满足：r11-002 的 exact endpoint/identity/zero 语义已通过回归；r11-026、029、037、052 已完成；r11-001 的 preservation map 已重绑并通过；r11-055 在同一源码与测试定义上有效通过；工作树为固定、可恢复、与 055 相同的 product closure。本节点仍只改唯一 inventory，不在任务外“顺手清 consumer”。任何 confirmed/new/unmatched/unknown 或 replacement 行为缺口都返回最近的既有 owner/052，修复后必须重跑 r11-055，再重新进入 053。

## Read first

- `docs/development-plan/inventories/legacy-consumers.json`
- `scripts/check-legacy-consumers.ts`（由 r11-002 创建；唯一承载 ratchet、ready-for-delete 与 final-zero 三种 mode）
- `tests/unit/editor10ForbiddenTokens.test.ts`
- `tests/unit/readModelBoundary.test.ts`
- r11-013–r11-055 各已完成迁移/模块化节点的实质 diff、focused check 与 LEG handoff

## Exact targets

| Owner | 必核记录 | 必核 consumer 面 | 完成证据 |
|---|---|---|---|
| Editor / History | LEG-001 | Store、Workspace、Properties、App lifecycle/delivery/import reads、缓存/history | 每个旧 path#symbol 在集成树零命中，r11-037/r11-055 的 Owner/行为证据仍有效 |
| Player / Preview | LEG-002 | Player entry、作者预览、payload/lifecycle、bundle、capture | r11-032 的 strict V2 entry 与 r11-033 的 preview parity 证据 |
| PPTX / PDF | LEG-004、LEG-005 | App branch、builder/capture、Main/Preload、release/test | 对应格式 V2 carrier 行为通过且旧调用零命中 |
| Diagnostics | LEG-006、LEG-007 | GUI、CLI、archive、各格式 adapter、capability generator | finding code/target/severity 稳定且旧 collector 零命中 |
| Archive / Tests | LEG-008、LEG-009 | product/script/release、fixture、全部直接 test consumer | V9/V2 替代或最小 fail-loud rejection 分类闭合 |
| 已移除目标 | LEG-003、LEG-010 | build/config/cache 是否回流 | 保持 removed，当前范围零回流 |
| Frozen token remainder | LEG-011 | 不属于 LEG-001–010 的独立旧 token、target-definition、Schema 8 样本与生成物 | 每个 bare token 精确归类；consumer/new/unmatched 为零，file/symbol expectation 可重现 |

## Write scope

只允许原子更新 `docs/development-plan/inventories/legacy-consumers.json`。禁止修改产品代码、测试、脚本、生成制品、矩阵、任务规格，禁止创建 delta/allowlist/第二台账，禁止删除任何旧模块。

## Execution

1. 固定集成 commit、dirty 路径和扫描范围；任一依赖任务的产品/测试路径仍变化时停止，不对移动目标做 reconciliation。
2. 对每个 LEG 记录逐项重跑 static reference、dynamic/IPC/config、Player/Preview/Export、build/fixture/release、persisted/Recovery、test、cache/async/generated/packaging 七类查询；每个 `file-absent` target 还必须重放 v3 的精确 source + target-reference 查询，包括旧 target 之间的引用，不得只信 lane handoff。
3. 新发现或漏记的 consumer 立即加入 confirmed/unknown 并使任务停止；不得通过改名、删除测试、扩大排除或把 confirmed 降为 unknown 减数。
4. 只有 endpoint 在集成树确实消失、replacement 路径存在且对应 PM 证据仍有效时，才从 confirmed 移除；保留可复现查询与 replacement。零 consumer 写入 `zeroReferenceEvidence.state = "zero"`。`file-absent` expectation 只有在目标文件实际不存在后才可写 `removed`；`symbol-absent` expectation 在精确 symbol/query 为零时可写 `removed`，宿主文件可以因现行职责继续存在。
5. 重算所有计数，写入 scanner version、scope/exclusions、固定 product closure identity 与排除 inventory/release-evidence 自身的 tree digest；执行 r11-002 交付的 ready gate并必须通过。随后只读执行同一 scanner 的 zero mode时，只允许 deletion list 中 `file-absent` 目标自身的 `target-definition` 命中导致 `legacy-module-present`；全部 target-reference 与 `symbol-absent` 目标必须已经为零。target-definition 不得计为 consumer/new/unmatched，也不得出现 stale、真实 consumer/reference、unknown、known-debt 或 scanner error。

## Stop conditions

- 任一记录仍有 confirmed/unknown consumer，或 lane handoff 与当前树不一致。
- replacement 的保存、重开、Player、导出或 PM 证据已失效。
- 需要修改扫描器、产品、测试或排除项才能让台账闭合。
- 候选不是固定集成状态，或无法给出当前 commit 身份。

## Acceptance

- 台账全部 `records`（LEG-001–LEG-011）与七类 consumer 在同一 product commit/scope/digest 可重现；计数字段与明细一致且不存在 commit 自引用。
- r11-002 的 scanner version、scope、identity 与 structured output 同当前固定候选一致；上次 reconciliation 的 digest/list 不再被引用。
- 所有待删目标的 confirmed/unknown consumer 与 target-reference 均为零、replacement 与 PM 证据有效；status 尚未伪装成 removed。
- LEG-011 的 frozen token remainder 与所有 target-definition 都被精确分类；`file-absent` / `symbol-absent` 的 status 规则按 expectation 而非“宿主文件是否一律删除”执行。
- inventory 仍是唯一台账，当前提交只包含该 JSON 的原子刷新，并精确列出交给 r11-054 的 deletion list。

## Focused validation

- `npm run check:legacy-ready`（必须通过）
- `npm run check:legacy-zero`（仅允许 deletion list 中 `file-absent` 目标文件仍在导致的 `legacy-module-present`）
- `npx vitest run tests/unit/editor10ForbiddenTokens.test.ts tests/unit/readModelBoundary.test.ts`
- `npm run typecheck`

## Rollback / handoff

只回滚本次 inventory 刷新；不得回滚 lane 产品改动。交接按固定顺序列出 deletion list 的 LEG ID、精确路径、零查询、replacement 和对应 PM 证据；r11-054 不得自行扩大清单。
