# r11-002-legacy-inventory-zero-check｜刷新唯一 Legacy 台账与零门

- Release / Dependencies: 1.1 / r11-001-preservation-baseline
- Write locks: `contracts-schema`, `legacy-inventory`
- Inventory access: write
- Preservation: PM-01–PM-28

## Outcome / current evidence

`docs/development-plan/inventories/legacy-consumers.json` 精确反映本任务固定的 product candidate，并由同一只读 scanner 提供 ratchet、ready-for-delete、final-zero 三种模式；不创建路径 allowlist。创建 `check:legacy-inventory`、`check:legacy-ready`、`check:legacy-zero` 三个 package script。当前台账仍含 active/retained consumer，只有 ratchet 应通过，后两者必须以确定的 debt 类别失败。

## Integrator audit / reopened（2026-09-03）

现有 scanner 不能作为 053/060 裁判：ratchet 把 confirmed endpoint 降为整路径放行；ready/zero 没有强制当前 candidate identity，也没有把实际 `newConsumers` / token hits 作为零条件；每条 legacy target 只有一个模糊 path，无法区分“文件必须消失”和“文件保留但旧 symbol 必须消失”。因此即使 inventory 被清空，live token、同路径新增旧 symbol、Schema 8 archive 或生成物仍可能误通过。本节点重新打开，当前 208 confirmed 只作为保守债务快照，不作为 scanner 正确性的证明。

本轮实现已把上述裁判升级为 `legacy-consumers-v3`：除固定 token 外，每个 `file-absent` target 都派生 record-local `target-reference:<expectationId>`，按精确 source path + target 扫描相对路径、repo-relative 路径、`@/` alias、TS/JS 对等扩展和 import/export/dynamic/mock/config/package-script 字符串；注释、同名 `.json` 与 lookalike 不计。当前固定候选登记 379 个 relation，其中 162 个是 target-reference endpoint；扫描观测 172 个 reference hit，ratchet 无 new/unmatched，ready/zero 以 234 个 confirmed observation 与 23 个 symbol definition 诚实失败。

## Read first

- `docs/development-plan/inventories/legacy-consumers.json`
- `tests/unit/editor10ForbiddenTokens.test.ts`
- `tests/unit/readModelBoundary.test.ts`
- `src/shared/projectTypes.ts`
- `src/shared/projectSchema.ts`
- `src/renderer/export/buildExportPayload.ts`

## Write scope

允许更新唯一 inventory、固定入口 `scripts/check-legacy-consumers.ts`、`package.json` 中恰好三个 `check:legacy-inventory` / `check:legacy-ready` / `check:legacy-zero` script、`tests/unit/legacyInventoryChecker.test.ts`、现有两个棘轮测试，以及实现 scanner 的最窄辅助代码。允许为每个 target 增加严格的 `file-absent` / `symbol-absent` deletion expectation 和 scanner version/identity 字段；禁止新建第二份 allowlist、删除 consumer、改产品代码、修改其他 package script、把 confirmed 降为 unknown 来减数。

## Execution

1. 从 inventory 的每条 confirmed endpoint 出发验证静态引用、动态字符串/IPC、Player/Preview/Export、build/fixture/release、持久化与测试 consumer；在 `baseline` 中写入变更前固定的 `reconciledProductCommit`、`reconciledScope` 与排除 inventory、`artifacts/release-evidence/v1.1/**` 的 `reconciledProductTreeDigest`。tree digest 是内容身份；commit 记录产生该 product tree 的最近产品提交，允许当前 HEAD 只多 inventory/evidence-only 后继提交，避免提交自引用。
2. 新发现 consumer 必须加入对应现有 record 或建立有六要素的新 record；不要只写扫描 token。
3. 每条记录写明 replacement、退出条件和可复现查询；裸 `ProjectDocument` 子串不得把 `CourseProjectDocument` 算作旧 token。
4. 实现一个只读 `scripts/check-legacy-consumers.ts`，从唯一 inventory 读取范围和记录，按 LEG ID、category、精确 `path#symbol` / query 稳定输出 JSON/文本，不写台账。`file-absent` target 的外部模块/配置引用必须以 record-local `target-reference:<expectationId>` 进入同一 confirmed relation；来源本身是另一个旧 target 时仍不得豁免。ratchet 校验 frozen upper bound 的 scanner/scope 身份并允许已登记 endpoint 只减不增，但不能把整条 path 作为 allowlist；ready/zero 必须强制当前 product digest、scope 与 scanner version 同 inventory 一致，并先拒绝 stale/new/unmatched hit，再判断 unknown/known debt。
5. 对 inventory 已登记旧目标文件或旧 symbol 自身的定义命中统一分类为 `target-definition`，不得误计为 consumer、new 或 unmatched。ready 中，`file-absent` 目标的 `target-definition` 可以尚在；zero 中同一命中稳定失败为 `legacy-module-present`。`symbol-absent` 目标允许宿主文件保留，但精确 symbol/query 必须为零。
6. ready 要求 confirmed/unknown/new/unmatched 与全部 target-reference 为零并只允许上述 `file-absent` target-definition 债务；zero 还要求允许的 scanner/inventory/release-evidence 自描述以外，旧模块、独立旧 token、Schema 8 作者样本、`.h5lesson` 内 `project.json`、fixture 与正式生成物全部为零。`artifacts/release-evidence/v1.1/**` 从 product digest 排除以避免报告自引用，其他 artifacts 仍在扫描范围。
7. scanner 提供 schema 2 structured JSON，包含 candidate identity、scanner version、scope/exclusions、唯一 inventory 的 schema version 与 canonical content digest、每个 LEG 计数、record/expectation identity、new/unmatched hits、target-definition、target-reference、target expectation 与失败类别，供 r11-060 原样消费。`tokenHits` 保持只统计旧 token，target reference 使用独立计数。inventory digest 由 scanner 对当前 JSON 的规范化内容计算，不写回 inventory，避免自引用；因为 inventory 不在 product digest 中，后续任何 inventory-only 变化仍会使旧报告失效。zero mode 支持 `--report <path>`：仅在扫描成功时原子写入同一 structured scanner report；内容不得掺入 contracts/capabilities/examples 等第二类发布检查，也不让 release gate 手抄或解析终端文本。
8. 使边界测试读取 inventory 的结构/状态，阻止新增旧 import、writer、fixture 和 release consumer；测试内联源码或固定最小 fixture至少覆盖 ratchet success、known debt、ready success、zero success、stale ready/zero、同已登记 path 新 symbol/新 target、confirmed=0 但 live token/reference 残留、target 已删但 dynamic import 仍在、target A 引用 target B、relative/alias/repo path/扩展/config command、行内/块/HTML comment、同名 JSON、target-definition 在 ready/zero 的差异、removed target 回流、file/symbol expectation、Schema 8 `.h5lesson`、malformed counts 与合法复合名称，区分债务失败与 scanner 崩溃。
9. 定义后续迁移协议：lane 不修改共享 JSON，只可让实际 consumer 相对 reconciled 集合减少，并在交接列出 LEG ID、旧 path#symbol、replacement 与精确查询；scanner 输出的每个实际 consumer 必须分类并排队到 r11-013/020/026/029/033/037/040/041/052 等现有 Owner，但不得越过该节点在稳定 DAG 中的前置依赖。发现漏记、新增或需要把 unknown 当零时立即停止并返回本任务刷新，不得继续迁移、建立匿名清债阶段或删除。
10. 固定 inventory status enum，沿用现有 `active-debt`、`reachability-unproven`、`retained-compatibility`、`dead-candidate`、`removed`；零 consumer 只写 `zeroReferenceEvidence.state = "zero"`，不发明 `removed-zero`。当前阶段 ready/zero 应诚实退出非零，不能把“检查器可运行”写成“已清零”。

## Stop conditions

- consumer 的运行时可达性无法证明，需要删除代码来“试”。
- 某条 retained compatibility 仍服务受支持行为但没有替代路径。
- 检查器只能靠高误报的子串扫描工作。

## Acceptance

- inventory 是唯一 consumer 清单且可由机器重现计数。
- `reconciledProductCommit`、scope、tree digest 与当前 product candidate 扫描相符；tree digest 是 ready/zero 的当前内容身份，commit 是最近产品提交的审计指针。后续迁移前明确 frozen identity 是 ratchet 安全上界而非自动追随工作树的事实。
- 当前非零债务被诚实列出；新增旧 consumer 会使目标测试失败。
- 零门排除 Markdown/Git 历史/node_modules/cache，但覆盖正式生成制品与 fixture。
- `package.json` 恰有三个 mode 入口且都调用同一 scanner；当前候选 ratchet 通过，ready/zero 以 debt 类别非零；测试内联源码或固定最小 fixture 的成功/失败矩阵全部符合模式合同。
- ratchet 按精确 endpoint 工作；ready/zero 对 current identity、new/unmatched token 和真实零命中强制失败，不能通过清空 inventory、复用 stale digest 或整路径放行制造绿灯。
- target-definition 不被计为 consumer/new/unmatched；`file-absent` 在 ready 与 zero 的差异、`symbol-absent` 保留宿主文件的语义都有固定反例。
- `file-absent` 外部引用按精确 source + target 进入唯一台账；目标文件删除、同 source 新 target、跨 target import、动态/config 字符串均不能误过 ready/zero，注释与同名 JSON 不误报。
- target 的 file/symbol deletion expectation、inventory 汇总计数与 records 明细由 schema/checker一致验证；`--report` 原子写绑定 inventory schema/digest 与 record/expectation identity 的纯 scanner structured JSON，足以让 r11-060 复用而不另写扫描逻辑。

## Focused validation

- `npx vitest run tests/unit/legacyInventoryChecker.test.ts tests/unit/editor10ForbiddenTokens.test.ts tests/unit/readModelBoundary.test.ts`
- `npm run check:legacy-inventory`
- `npm run typecheck`

## Rollback / handoff

回滚 inventory 与棘轮实现到本任务前；不得回滚用户文件。交接按 LEG ID 列出 confirmed endpoint、替代 owner 和首个可执行迁移节点。
