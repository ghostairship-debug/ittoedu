# 唯一真相、文档与索引维护

> Policy version: 2

## 1. 四类真相

只保留：

1. 唯一计划：目标、阶段、模块边界、门禁和升级规则；
2. 任务卡：任务实时状态、dependsOn、Owner、预算和结果；
3. Legacy consumer 台账：consumer、replacement 和 deletion gate；
4. Schema、源码和可复现测试：产品事实最高权威。

任务板和 Handoff 是任务卡的派生视图；Context Pack、验证日志是临时证据，不复制模块或阶段状态。

## 2. 何时更新

必须更新：公共合同/API、owner/依赖边界、Feature current status、Legacy replacement、阶段门禁、用户可见能力和适用范围。

不必更新：局部实现、不影响入口的重命名、普通测试修复、文案/CSS 小修。

## 3. Semantic 与 Generated

Worker 分别报告 `Semantic index impact: none | canonical-update` 与 `Generated refresh: defer-to-wave-gate | not-required`。前者决定 Feature owner/Coordinator 是否修改少量 canonical files/entrypoints/aliases/status/high-signal consumers/tests/invariants；后者承认被索引源码/测试/文档变化会使严格 source hash 过期，但只在波次门统一刷新。generated 不手工合并 JSONL；Context Pack 不提交。

一个波次最多统一运行并提交一次 canonical generated index 重建，默认在 wave-gate 收口；不在 claim、实现、review、报告和 close 各阶段重复生成或拆出生命周期提交。波次中相关输入 stale 时使用 Bootstrap，或等本波统一重建，不以逐卡 generated 修复上下文。纯文档和局部实现可以标记 `Semantic index impact: none`，但只要修改了索引输入就必须标记 `Generated refresh: defer-to-wave-gate`；这不触发逐卡生成。`TASK_BOARD.md` 是轻量状态投影，不属于该批量 index：任务状态持久提交时与卡同次生成，不另造生命周期提交。

`repo:index:quality` 只在 semantic、查询逻辑、生成器、config 或黄金任务发生变化后运行一次，或由 phase-gate/final-candidate 明确要求时各运行一次；普通产品任务只记录 deferred refresh，波次门统一生成并做 freshness/check。generated 与质量结果绑定产生它们的输入 commit，后续仅任务卡/报告变化时复用。

每张卡的 Evidence reuse / Invalidating paths 决定任务执行和 Reviewer 是否复用产品证据。差异范围只有文档或 generated 时不触发产品 unit/E2E/性能；只运行相关链接、任务板、索引 freshness 或确定性检查。

每次 PR 都按 base→current head 计算影响；没有可信的跨运行绿色证据存储时，不用 previous head→new head 跳过曾失败的产品提交。普通产品差异只补 Vitest `related` 受影响测试；测试基础设施/包配置或产品输入删除才自动触发完整产品单元套件。Playwright E2E 与 phase/final gate 由对应任务显式执行，卡片状态/结果文字本身不触发全量产品测试。任意任务卡变化都运行轻量 task-board/policy check；repo-index generator/semantic/query/config 或已纳入的 generated 视图才运行 freshness，普通产品输入的 `Generated refresh` 延后到波次门。AI capability generator 在干净 CI 只运行不依赖外部 sibling catalog 的目标测试；含目录快照的 freshness check 只在该输入真实可用的环境或最终候选执行。最终候选仍显式运行所有适用 check。

## 4. 历史材料

历史任务/评估默认不进入 AI 阅读集；不立即删除。关键决策转入当前计划或 ADR，accepted/发布证据保留，当前入口不再指向旧领取状态。

## 5. 一致性检查

计划发布前检查：Markdown 链接、阶段编号、manifest、目标文件、术语状态、规划命令未冒充现有命令、任务状态未在多处重复、consumer 台账 ID 有效。
