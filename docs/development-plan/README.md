# 开发入口

主执行者先读[当前状态](CURRENT_STATUS.md)和用户指定范围；已注入的 AGENTS 无需重读。合同、历史和证据按相关动作取用，不顺序通读全部资料。

| 用途 | 唯一入口或直接依据 |
|---|---|
| 当前实现、剩余与交付边界 | [CURRENT_STATUS](CURRENT_STATUS.md)；最新为10月20日创作边界修复与代表产品闭环，压力限制和旧质量／效率结论分别保留 |
| 已执行批次的原规格 | [软件方案全部 §1—28](../archive/联网搜索解耦与多后端接入方案-2026-10-12.md)、[互动演示创作方案](../archive/互动演示创作方案-2026-10-12.md)、[历史启动提示词](../archive/果铃软件与创作修复-Codex执行提示词-2026-10-12.md)；原批次已于10月13日收口，不再自动执行 |
| 唯一开发结果与证据 | [软件与创作修复结果](SOFTWARE_AUTHORING_RESULT.md)；最新机械装配/同题样本与后置修复在前，早期阶段按原日期读取 |
| 实际接续任务 | [TASK_BOARD](TASK_BOARD.md)及对应卡；queued 不自动启动，未实施候选不计完成 |
| 创作边界修复（2026-10-20，已实施） | [实施结果](20261020-creation-boundary-repair/IMPLEMENTATION_RESULT.md)及[下一轮能力交接](20261020-creation-boundary-repair/CAPABILITY_HANDOFF.md)；后续已修16×5MiB投影内存放大，原失败保留，未启动完整创作或参考库 |
| 下一步修改方向（未实施） | [内容接入与联动创作修改方向](内容接入与联动创作修改方向-2026-10-17.md)：吸收 Pro 评估与本轮核查，区分接线、表达和持续编辑，不自动启动产品或作者运行 |
| 本轮创作质量与执行链路方案（2026-10-20，软件已实施） | [创作质量与执行链路修复方案](创作质量与执行链路修复方案-2026-10-19.md)：A—G可实施软件项已落地，整体质量/效率仍按[实际结果](SOFTWARE_AUTHORING_RESULT.md#result-creation-quality-execution-20261020)接续；语音文件生成与旧版浏览器TTS分别判断，不把新增供应方当整体前置 |
| 执行规则与技术边界 | [WORKING_PROTOCOL](WORKING_PROTOCOL.md)按动作取章；[ARCHITECTURE_CONTRACT](ARCHITECTURE_CONTRACT.md)只读改动命中条目 |
| 观察／摘要／背景装配／Source回显防回退 | `npm run test:authoring-regressions`：冻结真实首稿＋默认主题测量装配、观察报告进入模型与摘要、按窗口预算分包、Source旧回显/同值反馈，以及新构建的真实Electron点击／输入／翻页和雨量40联动。相关路径变化时使用；不调用供应商，不重跑整课作者。 |
| 10月14日审计修复的具体包 | [11包索引](20261014-audit-remediation/README.md)、[执行方案](20261014-audit-remediation/EXECUTION_PLAN.md)、[原报告覆盖](20261014-audit-remediation/REPORT_COVERAGE.md)；完成状态以当前结果为准，不重派已完成包 |
| 操作、创作与格式 | [文档导航](../README.md)、[用户指南](../USER_GUIDE.md)；内容任务按 AGENTS 选 Skill，产品开发不加载教学方法 |
| 历史方案、旧验收与恢复 | [归档索引](../archive/README.md)；旧实现/未完成目标保留，原启动指令不自动恢复 |

当前主树包含未提交的有效成果，使用当前源码与直接消费者定位，保全人工布局及原件。独立 review、真实模型费用、未知副作用和 Git 交付沿既有边界；本轮不据导航整理启动产品开发、收费验证或发行。

原根目录开发总纲已并入本页，ROADMAP并入当前状态；旧ENTRYPOINTS并入文档导航。原两份方案及启动提示词已按完成状态归档，结果记录迁入本目录。根目录只保留README、AGENTS、CHANGELOG；当前工作从本页/当前状态进入，不重复执行历史批次。

旧 v2／R01—R08／H1—H6 和10月10日 §14.8 等入口已归入历史导航；已执行原规格只供追溯，现有差额按当前状态和用户目标接续。架构目标仍见[统一组件方案](component-platform-refactor/ARCHITECTURE_AND_REFACTOR_PLAN.md)，机器消费的旧规格仍在[roadmap](roadmap/README.md)。原入口完整快照见[归档](../archive/20261017-开发状态与任务交接快照.md#entry-snapshot)。
