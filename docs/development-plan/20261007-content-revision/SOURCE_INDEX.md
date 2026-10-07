# 来源、口径与当前事实

本包核对基线为 afc65c9e4d713a9d362768f34e017789fad265ae。2026-10-06 至本次计划生成，产品源/脚本/测试/package/lock 未因本轮报告和计划改变；计划不声称产品问题已修或新行为已验证。开工遇到新修改时核受影响闭包即可。

## 仓库内证据

| 来源 | 位置与用途 |
|---|---|
| 产品前提重审报告 | [2026-10-07 报告](../../archive/local/evidence/20261007-product-audit/reports/2026-10-07_果铃产品前提重审报告.md)，承接教师首发、统一能力、AI/软件分工 |
| 前次完整收敛报告 | [2026-10-06 报告](../../archive/local/evidence/20261007-product-audit/reports/2026-10-06_果铃审计收敛报告.md)，查原主张、50主题、原边界和证据 |
| 新131条记录 | [product-findings.json](../../archive/local/evidence/20261007-product-audit/records/product-findings.json)，含126条源码确认记录（含正向事实）与5条部分确认 |
| 旧641来源记录 | [audit-claims.json](../../archive/local/evidence/20261007-product-audit/records/audit-claims.json)，逐条来源、判断和证据，不用旧推测直接升级缺陷 |
| 原20份输入 | [inputs 目录](../../archive/local/evidence/20261007-product-audit/inputs/)，7份主 Markdown、Codex HTML、Astra JSON及11份附录；重复载体不是新问题 |
| 完整执行覆盖 | [COVERAGE.json](COVERAGE.json)，50/131/641及20细项逐条处置和工作包；不需要每位叶 Agent 全量重读大报告 |
| 本轮独立计划审查 | [REVIEW_RESULT](REVIEW_RESULT.md)，两位独立reviewer的原记录按同一归档根保存，结论只覆盖计划 |

上述报告/原件是本机归档，沿用仓库已忽略的 docs/archive/local，不移动或改写桌面原件。主计划与完整紧凑覆盖在正式开发目录，可随仓库流转；转到其他机器缺本地归档时，先依本包直接路径/当前源码开工，确需旧实验原件再取，不把归档搬运当每叶前置门。

## 有效开发入口

- [当前状态](../CURRENT_STATUS.md)：正式实现、已验证与剩余边界。
- [开发入口](../README.md)、[工作协议](../WORKING_PROTOCOL.md)、[任务板](../TASK_BOARD.md)：真实协调与最小验证，不恢复历史卡。
- [架构合同](../ARCHITECTURE_CONTRACT.md)：涉及 Schema、正式写入、资源、运行和保存时补读相关条目。
- [原模型与并发分配](../component-platform-refactor/BASELINE_FIRST_V10_EXECUTION_PLAN.md)：沿用 Root / Astra I、A / Sol 实现与测试 / Luna E 的职责，不重新执行历史工作包。

AGENTS.md 不因本包改变。已确认产品方向与当前 Owner 原则优先于历史防御性门、固定模板和全矩阵排期；真实授权、正式 writer 和费用路径仍按当前入口。

## 模型配置资料

官方[模型文档](https://learn.chatgpt.com/docs/models)与[子 Agent 配置文档](https://learn.chatgpt.com/docs/agent-configuration/subagents)已在本轮查阅，用于确认模型标识及显式 model / reasoning_effort 分配方式。模型/强度沿用 Owner 要求的旧分配，而非据文档推测速度、价格或产品供应商目录。模型配置可用性以执行工具的实际支持为准，产品 API 模型目录在对应授权探针时实时核对。

## 本次检查边界

本次只生成和独立审查计划文档，核覆盖计数、引用、写域、依赖、模型分配及入口一致性。没有运行产品构建/测试、真实模型、GUI、浏览器动作或修改产品代码。工作包/验证中的命令、候选新路径和真实动作均是后续执行安排，不能当本次证据。
