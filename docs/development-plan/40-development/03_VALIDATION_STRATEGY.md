# 最小充分验证策略

正确性优先，但验证按风险集中，避免每个 Worker 重复完整发布流程。

> Policy version: 2。Validation ceiling 是该任务允许执行的最高等级，不是要求把低等级和高等级全部重复一遍；Validation budget 是执行前硬预算，预计超出时先拆卡或重分类。

## 0. Task class 与固定验证上限

| Task class | 固定 ceiling | 允许内容 |
| --- | --- | --- |
| `docs` | V0 | 文档、链接、任务板/索引 freshness；不跑产品套件 |
| `implementation` | V1 | 1–3 个最相关目标检查；自动化未直接观察结果时才补一个最小行为；S2 热点接入另建 integration 卡 |
| `integration` | V2 | 受影响类型/集成验证，最多一条明确命名的 E2E |
| `wave-gate` | V2 | 受影响回归与 0–6 条本波关键 E2E，通常不超过 3 条；不跑全量 E2E |
| `phase-gate` | V3 | 每个修改产品代码的 ARCH 最多一次完整阶段验证 |
| `final-candidate` | V4 | 最终发布候选一次完整验证与产物复核 |

Policy v2 任务卡必须使用表中与 Task class 对应的固定 ceiling；ceiling 不是逐层累加清单，实际只运行足以覆盖当前风险的子集。需要更高 ceiling 时先重分类；预计超出时间预算时先拆卡或更新预算和理由，不得运行后补理由。

## V0：任务卫生

每张卡：工作树/未跟踪文件、diff check、范围与预算、用户/generated 差异夹带检查。纯文档关闭只检查相关链接、task-board/index freshness 和文档检查，不重跑产品测试。

## V1：Worker 目标验证

每张卡从下列项目中选择覆盖当前风险的最小组合，不是 AND 清单：

- 1–3 个最相关单元/静态/interaction/schema/fixture 检查；
- 自动化不能直接观察用户结果时，一个任务特定最小人工行为；
- 存在已知失败且修复目标依赖它时，characterization 对照。

Worker 不运行无关全量 test/e2e/desktop/verify。

普通产品提交的 CI 使用 Vitest `related` 静态依赖选择作为补充防线，不把它冒充任务卡命名的行为测试；测试基础设施/包配置或产品输入删除才自动运行完整产品单元套件。Playwright spec/config 只由明确的 V2/V3/V4 卡执行，不送进 Vitest 制造 0-test 假绿。动态读取和行为 ratchet 仍由任务卡的明确目标测试覆盖。

普通 implementation 卡禁止无过滤的 `npm test`、完整 `npm run test:e2e`、`verify`、desktop 打包和完整性能矩阵。架构 ratchet 优先断言行为边界、禁止依赖和精确 deletion gate；除明确删除目标外，不用构造器数量、源码文本切片或固定符号出现次数锁死合法重构。

## V2：Coordinator 接入与波次验证

每个 integration commit 按影响运行：

- 受影响 TypeScript 项目的 typecheck；
- 相关 unit + integration；
- 单张 integration 卡对 UI/IPC/save/export 变化最多运行一条明确命名的 desktop/E2E smoke；
- 只在用户链路或 fixture 证据被本提交使失效时运行对应代表工程流程；
- contracts/ai-capabilities/index check（仅在有影响时）。

S2 不能累积到阶段末才首次做相关类型或集成验证。

wave-gate 复用本波 implementation/integration 证据，只补受影响回归和 0–6 条贯穿核心用户链路的 E2E，通常不超过 3 条。若本波没有使任何 E2E 证据失效，可以是 0 条；否则优先覆盖 author → save/reopen → preview/play/export 的新增或高风险链路，不用大量无关 E2E 代替缺失的关键行为。

## V3：阶段一次完整阶段验证

V3 是阶段 ceiling，不是固定完整清单。阶段收口先复用本阶段同一 product commit 上仍有效的 implementation/integration/wave 证据，只补被跨系统接入或 Invalidating paths 使失效的 typecheck、unit/integration、相关 E2E、代表工程、适用导出、索引/consumer 检查。完整产品 unit/integration 只在测试基础设施、包配置、产品输入删除或本阶段风险横跨大部分系统时运行；全量 Electron E2E 仍留给确有跨系统风险的 V3 或 V4。性能矩阵只在本阶段命中性能 Invalidating paths 时运行。同一 ARCH 至多运行一次广域套件，同一命令序列已经完成的构建不重复执行；关键用户链路缺失时先补最小 E2E，而不是再跑一遍既有全量套件。

ARCH-0A/0B 或其他阶段若只修改治理、文档、索引生成器或查询工具，只运行链接、路径、确定性、黄金任务、相关 typecheck/unit 和生成/check；不运行三份产品代表工程、产品 E2E 或桌面打包。只有阶段实际改动产品代码时，才进入 V3。

## V4：最终候选一次完整验证

ARCH-5 显式运行合同、能力、索引、typecheck、unit/integration/e2e 和 desktop build；必要时增加 release、Windows portability 和 component catalog。完整流程只在最终候选运行一次。若 V3 证据与 final-candidate 是同一 product commit 且未命中 Invalidating paths，V4 复用它并只补发布产物特有检查，不重复相同构建和套件；性能证据也遵循同一失效规则。

## 5. Characterization（按需）

S1/S2 迁移或边界不清时，迁移前锁定成功行为、已知失败和受影响的 async/stale、history、save/reopen、preview/export、keyboard/focus/IME/DnD/gesture。S0 只需复现卡中的局部事实，不建 characterization 阶段或额外卡。测试描述用户/协议行为，不只断言文件和内部实现。

## 6. 性能

ARCH-0A 固定环境、fixture、样本和 median/P95 口径。任何等级都不因“进入门禁”自动重跑性能：只有改动直接命中热路、测量工具/口径、性能 fixture、运行/构建环境或任务卡声明的性能 Invalidating paths 时，才运行对应热路测量或一次完整矩阵。否则复用最近有效证据。超过约定阈值时先定位；只有需要能力缩水才能恢复时才升级用户。

## 7. Flaky 与失败归因

- 原命令重跑一次；
- 可复现则由当前任务修；
- 随机则隔离并建卡，不提高 retry 或弱化断言；
- baseline 已红必须与当前 diff 比较；
- 不在产品卡顺手重写测试框架。

## 8. Evidence reuse 与 Reviewer

- Ready 时 Evidence reuse 只定义复用规则；Result evidence 才以实际 change commit（改产品代码时即 product commit）、命令、结果和环境为键绑定证据。任务卡的 Invalidating paths 决定后续是否复用。
- 只改任务卡、报告、task-board 或 generated 且未命中 Invalidating paths 时，不重跑产品套件；只执行对应文档/index check。
- Reviewer 不为“独立性”重复同一套件。S0 implementation 不强制 Reviewer；第一 Reviewer 查 diff、反例和边界，第二 Reviewer 只在双热点或首轮 finding 时启用，并负责不同风险面。
- 一个失败只按其影响使相关证据失效，不把 focused failure 自动升级成全量验证。

## 9. 结果分层

自动化绿是 pipeline pass；迁移边界与 consumer 证据满足是 engineering pass；代表工程真实可用是 outcome pass；教师明确确认才是 accepted。
