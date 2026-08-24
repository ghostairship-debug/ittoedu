# Task Evidence Handoff

> Handoff 只保存证据；由任务卡 Result Evidence 自动生成只读视图，不单独维护状态。只输出适用字段，未命中的维度直接省略，不制造 `N/A` 清单。

- Task ID / phase:
- Baseline / Context Pack or Bootstrap evidence（实际使用时）:
- Goal result:
- Files/symbols changed（有变更时）:
- Behavior or document before/after:
- Validation commands/results:
- Representative project/manual result or reused evidence key（只有对应证据被本卡使失效或 class 明确要求时）:
- Consumers migrated/remaining（只有 consumer 发生变化时）:
- Budget/lock deviations（只有发生偏差且已更新任务卡时）:
- Findings not fixed（存在时）:
- Semantic index impact: none | canonical-update
- Generated refresh: defer-to-wave-gate | not-required
- Actual change commit（改产品代码时即 product commit）:
- Separate integration commit（只有真实独立回滚边界时）:
- Rollback commit/path（适用时）:
- Next allowed task:
