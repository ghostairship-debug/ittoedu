# 开发入口

主执行者先读[当前状态](CURRENT_STATUS.md)和用户指定范围；已注入的 AGENTS 无需重读。合同、历史和证据按相关动作取用，不顺序通读全部资料。

本批架构优化已获commit／push授权，各轮“未提交”保留历史时点；仅提交本批增量，其他未提交成果及发行暂停保持。

| 用途 | 唯一入口或直接依据 |
|---|---|
| 当前实现、剩余与交付边界 | [CURRENT_STATUS](CURRENT_STATUS.md)；最新为10月24日资源、运行性能与动画基础修复，软件与作品责任、资源/加载实测及剩余长帧分别记录；前一轮交互成果与旧条件专项、创作质量／效率边界保留 |
| 已执行批次的原规格 | [软件方案全部 §1—28](../archive/联网搜索解耦与多后端接入方案-2026-10-12.md)、[互动演示创作方案](../archive/互动演示创作方案-2026-10-12.md)、[历史启动提示词](../archive/果铃软件与创作修复-Codex执行提示词-2026-10-12.md)；原批次已于10月13日收口，不再自动执行 |
| 唯一开发结果与证据 | [软件与创作修复结果](SOFTWARE_AUTHORING_RESULT.md)；最新关闭、Markdown、HTML／GLX 编辑和统一编辑复核结果在前，早期阶段按原日期读取 |
| 实际接续任务 | [TASK_BOARD](TASK_BOARD.md)及对应卡；queued 不自动启动，未实施候选不计完成 |
| 架构优化整体收口（2026-10-24，仅文档评估） | [原方案§15逐包最终状态](../../output/architecture-audit-20261024/IMPLEMENTATION_PLAN.md#architecture-batch-closeout)；本批已选范围全部收口，P5-A计量后不采用，广义P2-C／D／E、P4及P5-B／C／D未选方向按证据暂缓，无默认下一轮。原14红例中4项有后续原例关闭证据，其余10项保留准确边界；目录旧失败已由§14收口，不回写历史统计。本次未改代码／测试／配置或运行验证，现有dirty和发行暂停保持 |
| 架构服务发现与作业归属维护（2026-10-24，已收口） | [唯一结果](20261024-architecture-service-discovery/RESULT.md)；按[原方案§14](../../output/architecture-audit-20261024/IMPLEMENTATION_PLAN.md#next-round-after-positive)完成目录→只读提交／取消归属维护，原5项＋新增归属1项及真实持久接续1项共7项通过，主类型与独审通过。三个start拒绝、跨run／接续只读不可取消及零取消服务调用已证实；未发现实际越权，产品源码／权限／检查定义未改，其他包不追加，现有dirty保全，未commit／push／发布 |
| 架构正收益切片（2026-10-24，已实施） | [唯一结果](20261024-architecture-positive/RESULT.md)；[原方案§13](../../output/architecture-audit-20261024/IMPLEMENTATION_PLAN.md#positive-return-next-slices)三个切片已依次开发／验证／独审，42项相关检查及完整三段类型检查通过；双Player原生子项与隔离资产库冷开覆盖。当时2条服务目录旧失败已由后续§14收口，原统计不回写；其余包未追加，现有dirty保全，未commit／push／发布 |
| 架构第五轮（2026-10-24，Electron／e2e增量已采用） | [唯一结果](20261024-architecture-fifth-round/RESULT.md)；两套暖完整3.13／5.18秒对无改增量0.55／0.79秒，确定错误两模式同诊断、恢复通过，最终无cache执行及独审通过。原三段及主段、配置／正式emit保持；P1-C本轮范围收口，未追加其他包，现有dirty保全，未commit／push／发布 |
| 架构第四轮（2026-10-24，停止／丢ACK定性完成） | [唯一结果](20261024-architecture-fourth-round/RESULT.md)；两条夹具维护及原行为／同操作查证通过，两项选中检查、主类型及独审通过，产品源码未改。[第四轮后取舍与下一轮标准](../../output/architecture-audit-20261024/IMPLEMENTATION_PLAN.md#next-round-after-fourth)已由第五轮按范围执行；结构方向继续暂缓，不按旧红例逐项扩面，现有dirty保全，未commit／push／发布 |
| 架构第三轮（2026-10-24，P1-C采用／P5-A未采用） | [唯一结果](20261024-architecture-third-round/RESULT.md)；主配置增量有收益且诊断保持，原三段检查不减。P5-A计量后保留原实现；独审通过。[第三轮后再评估／下一轮标准](../../output/architecture-audit-20261024/IMPLEMENTATION_PLAN.md#next-round-after-third)已由第四轮按范围执行；P2-D结构迁移仍暂缓，现有dirty保全，未commit／push／发布 |
| 架构收敛第二轮（2026-10-24，已实施） | [唯一结果](20261024-architecture-second-round/RESULT.md)；P2-B与Source正确性修复完成，20项聚焦、真实输入／迟ACK与保存重开、相关类型／构建及独审通过。[原方案§10](../../output/architecture-audit-20261024/IMPLEMENTATION_PLAN.md#next-round-after-second)已由第三轮接续；广义P2-C优化未实施，现有dirty保全，未commit／push／发布 |
| 架构收敛首轮（2026-10-24，已实施） | [唯一结果与证据边界](20261024-architecture-first-round/RESULT.md)；P1-A／P1-B／P2-A／P3开发、相关最小充分验证及独审完成。[原方案§9](../../output/architecture-audit-20261024/IMPLEMENTATION_PLAN.md#next-round-after-first)的后续选择已由第二轮实际结果接续；未复验原红例及既有dirty保留，未commit／push／发布 |
| 资源、运行性能与动画基础（2026-10-24） | [修复报告](../../output/resource-runtime-repair-20261024/REPORT.md)、[性能对照](../../output/resource-runtime-repair-20261024/PERFORMANCE.md)、[接口变化](../../output/resource-runtime-repair-20261024/SOFTWARE_CHANGES.md)、[创作交接](../../output/resource-runtime-repair-20261024/CREATIVE_HANDOFF.md)；GLX 17.50→8.43MB、正式HTML 29.53→16.39MB。原件只读，本轮独立本地提交，前一轮dirty保留，不push/发布 |
| 编辑阻断与体验回退修复（2026-10-23，收口） | [唯一结果及A01–A20／B01–B21覆盖](20261023-editing-regressions/RESULT.md)；P1–P9软件修复与独审完成，指定GLX、大小HTML副本实际编辑／保存／新进程冷开、最终工具栏视觉及相关类型／构建通过。性能与外部条件边界保留；实施时未提交，本地提交沿下文最新授权 |
| 审计整合与组件／Flow重构（2026-10-23，已完成） | [唯一结果与证据](20261023-audit-refactor/RESULT.md)；审计归并、B1–B8裁决、混排／插入／发现／分栏及恢复／运行／输出已实施并独审，真实模型接力、人工状态保留、保存新进程冷开与正式compiled离线互动通过；无可比基线，不签普遍提速，实施时未提交，本地提交沿下文最新授权 |
| 关闭、Markdown 与 HTML／GLX 编辑（2026-10-22） | [最新修复结果](20261022-responsiveness-editing/RESULT.md)；同版本准备与恢复稿去重、原位编辑和实际手柄、试运行隔离、保存与冷开均有直接证据，性能数字按各自条件读取 |
| 统一编辑体验与性能收敛（2026-10-22，已实施） | [复核修复闭环](20261022-unified-edit-performance/REPAIR_RESULT.md)为最终入口；[先期实施结果](20261022-unified-edit-performance/IMPLEMENTATION_RESULT.md)保留旧条件。大 HTML 同样本保存 8.697→7.130 秒，不与旧 14.499 秒混作同一对照；条件优化、物理 IME 与 Owner 接受等边界保留 |
| 通用GLX作品与三表面容器化（2026-10-20） | [实施结果及A01—A18](20261020-glx-work-containers/IMPLEMENTATION_RESULT.md)、[下一轮能力交接](20261020-glx-work-containers/CAPABILITY_HANDOFF.md)；Project 11／Published 4／API5，现行10只在读入边界转换，成熟人工编辑与保存链复用；不自动启动首件创作或发行 |
| 创作边界修复（2026-10-20，已实施） | [实施结果](20261020-creation-boundary-repair/IMPLEMENTATION_RESULT.md)及[下一轮能力交接](20261020-creation-boundary-repair/CAPABILITY_HANDOFF.md)；后续已修16×5MiB投影内存放大，原失败保留，未启动完整创作或参考库 |
| 下一步修改方向（未实施） | [内容接入与联动创作修改方向](内容接入与联动创作修改方向-2026-10-17.md)：吸收 Pro 评估与本轮核查，区分接线、表达和持续编辑，不自动启动产品或作者运行 |
| 本轮创作质量与执行链路方案（2026-10-20，软件已实施） | [创作质量与执行链路修复方案](创作质量与执行链路修复方案-2026-10-19.md)：A—G可实施软件项已落地，整体质量/效率仍按[实际结果](SOFTWARE_AUTHORING_RESULT.md#result-creation-quality-execution-20261020)接续；语音文件生成与旧版浏览器TTS分别判断，不把新增供应方当整体前置 |
| 执行规则与技术边界 | [WORKING_PROTOCOL](WORKING_PROTOCOL.md)按动作取章；[ARCHITECTURE_CONTRACT](ARCHITECTURE_CONTRACT.md)只读改动命中条目 |
| 观察／摘要／背景装配／Source回显防回退 | `npm run test:authoring-regressions`：冻结真实首稿＋默认主题测量装配、观察报告进入模型与摘要、按窗口预算分包、Source旧回显/同值反馈，以及新构建的真实Electron点击／输入／翻页和雨量40联动。相关路径变化时使用；不调用供应商，不重跑整课作者。 |
| 10月14日审计修复的具体包 | [11包索引](20261014-audit-remediation/README.md)、[执行方案](20261014-audit-remediation/EXECUTION_PLAN.md)、[原报告覆盖](20261014-audit-remediation/REPORT_COVERAGE.md)；完成状态以当前结果为准，不重派已完成包 |
| 操作、创作与格式 | [文档导航](../README.md)、[用户指南](../USER_GUIDE.md)；内容任务按 AGENTS 选 Skill，产品开发不加载教学方法 |
| 历史方案、旧验收与恢复 | [归档索引](../archive/README.md)；旧实现/未完成目标保留，原启动指令不自动恢复 |

使用当前源码与直接消费者定位，保全人工布局及原件。10月23日卫生整理提交已完成（`63992093a`）；10月24日资源、运行性能与动画基础按Owner明确要求独立本地提交，前一轮交互dirty保留。各实施RESULT的未提交描述保留为当时事实。push／Portable／发布／部署继续暂停。独立review、模型费用及未知副作用沿各自现行授权，不因导航更新扩大。

原根目录开发总纲已并入本页，ROADMAP并入当前状态；旧ENTRYPOINTS并入文档导航。10月12日原两份方案及启动提示词已按完成状态归档，结果记录迁入本目录；10月23日本次按Owner卫生整理指令，将组件／Flow方案、编辑回退方案、已执行工作流及启动提示词完整迁入[归档](../archive/README.md#2026-10-23-文档整合与本地提交)，原裁决与授权保留。当前工作从本页／当前状态及Owner指定入口进入，不重复执行历史批次。

Owner 2026-10-24最新直接授权本轮资源、运行性能与动画基础软件修复完成后本地git commit；只提交本轮软件/报告增量，上一轮交互dirty与其他创作工程保留。此前各RESULT的未提交描述仍为当时事实，push／Portable／发布／部署继续暂停。

旧 v2／R01—R08／H1—H6 和10月10日 §14.8 等入口已归入历史导航；已执行原规格只供追溯，现有差额按当前状态和用户目标接续。架构目标仍见[统一组件方案](component-platform-refactor/ARCHITECTURE_AND_REFACTOR_PLAN.md)，机器消费的旧规格仍在[roadmap](roadmap/README.md)。原入口完整快照见[归档](../archive/20261017-开发状态与任务交接快照.md#entry-snapshot)。
