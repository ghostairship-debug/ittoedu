> 历史快照：原路径 docs/development-plan/README.md，截至2026-10-27收口前。旧流程与排期不再作为当前规则；正文仅修复归档后的相对链接。原始字节见 output/development-closeout-20261027/preimage/ 对应路径，现行治理见 [DEVELOPMENT](../../../DEVELOPMENT.md)。

# 开发入口

主执行者先读[当前状态](../../development-plan/CURRENT_STATUS.md)和用户指定范围；已注入的 AGENTS 无需重读。合同、历史和证据按相关动作取用，不顺序通读全部资料。

Owner最新授权（10月26日）：接续上一轮正式产品开发、尝试原生多Agent并发，完成收口后继续已批准的高价值小批；保全未提交成果，不commit、push或发布。

本批已交付[产品接续收口与R1参考入口](../../development-plan/20261026-product-execution/RESULT.md)：大HTML旧点击问题确认为自动化iframe坐标换算；S1/P1/S2、正式采用和原有共编证据完成复核。能力4/4、采用集成12/12、必要Main构建及四次真实MCP读取通过。H/G0原稿失败、G1返工和全部时间口径保留；十分钟首次合格与相对合格裸HTML速度仍未达成。任务卡仅以queued保留余项，本批写锁释放。Root加三个原生子Agent实际并发、子会话连接挂起后的降级及主会话两次文本读取内部错误见结果，不重复恢复已完成修复。

前轮授权（10月24—25日，历史记录）：按[架构与统一选中边界回归修复方案](../../development-plan/20261024-regression-boundary-repair/PLAN.md)执行，包含图片简易编辑面板、Flow定位方式直接显示及低频操作放“更多”。以下旧授权和各旧结果的提交描述仅保留历史时点；当前以顶部10月26日指令为准。

Owner 10月25日最新HTML修复已完成：[统一控件、就近AI及预览命中](../../development-plan/20261025-html-edit-repair/RESULT.md)。第2项已用同一原件、同一Windows原生鼠标路径复现并修正空白命中死循环；共用快捷条／AI和遮挡描框已接通。直接26/26、真实Agent浏览器2/2、Main保存冷开1/1、类型及独审通过；未重启用户窗口，未commit／push／发布。

此前[Python开发载体及属性草稿核实修复](../../development-plan/20261025-draft-compute-repair/RESULT.md)已完成。CA246 Root原环境1/1通过；3条旧属性失败已逐项核实，文字两种真实丢稿已修、数值／公式无需改产品，直接44/44、Root实际右侧栏、类型及独审通过。此前[AI格式与核心路径](../../development-plan/20261025-format-core-repair/RESULT.md)和[页面卡片与模式纠正](../../development-plan/20261025-targeted-followup/RESULT.md)继续有效。新的UI、模式或操作路径仍先确认，未commit／push／发布；历史全量及物理输入法未验边界保留。

| 用途 | 唯一入口或直接依据 |
|---|---|
| 当前实现、剩余与交付边界 | [CURRENT_STATUS](../../development-plan/CURRENT_STATUS.md)；最新为[10月26日产品接续与参考入口](../../development-plan/20261026-product-execution/RESULT.md)。此前[HTML统一编辑与命中修复](../../development-plan/20261025-html-edit-repair/RESULT.md)、[Python及草稿](../../development-plan/20261025-draft-compute-repair/RESULT.md)、[格式／核心路径](../../development-plan/20261025-format-core-repair/RESULT.md)、[页面卡片／旧模式](../../development-plan/20261025-targeted-followup/RESULT.md)及[边界修复](../../development-plan/20261024-regression-boundary-repair/RESULT.md)继续有效。其他性能／作品目标各自条件保留 |
| HTML统一编辑与命中（10月25日，实施完成） | 共用快捷条／格式动作及就近AI已恢复；完全遮挡不画框，部分露出保留。第2项原生鼠标修前／修后确认空白命中死循环，非大小限制；直接26/26、实际Agent浏览器2/2、Main格式保存冷开1/1、三套类型及独审通过。见[结果与证据边界](../../development-plan/20261025-html-edit-repair/RESULT.md)。原件／profile保留，未重启用户窗口或commit／push／发布。 |
| Python开发载体及属性草稿（10月25日，实施完成） | CA246 Root原配置真实Worker／Python完整1/1通过、0skip；文字拒接纳虚报成功及IME失焦丢稿已修。3条旧属性失败逐项核实；直接44/44、Root实际RightSidebar、类型及独审通过。原正确保护及历史失败保留，见[综合结果](../../development-plan/20261025-draft-compute-repair/RESULT.md)。未新增UI／模式／路径，未commit、push或发布。 |
| AI格式与核心编辑路径（10月25日，实施完成） | 高层整对象实际字号／颜色、旧realm ACK抢选及旧鼠标记录吞up已修；完整工具／冷开16/16，实际格式呈现、Source完整浏览器及关闭保稿组合链通过，三套类型及独审完成。Python对照、当时CA246与3条GUI旧失败记录见[原结果](../../development-plan/20261025-format-core-repair/RESULT.md)；后续裁定见上行，不回写历史。未commit、push或发布。 |
| 页面卡片及剩余问题定向后续（10月25日） | 卡片删除布局按Owner标注实施；后台HTML夹具最终4/4，生产activity未改；取消前置模式选择的方向已纠正，Worker未决。AI格式与选中／拖动／关闭保稿仅[定位及方案](../../development-plan/20261025-targeted-followup/RESULT.md)，不得当成已实施或全仓通过。未commit、push或发布。 |
| 已执行批次的原规格 | [软件方案全部 §1—28](../联网搜索解耦与多后端接入方案-2026-10-12.md)、[互动演示创作方案](../互动演示创作方案-2026-10-12.md)、[历史启动提示词](../果铃软件与创作修复-Codex执行提示词-2026-10-12.md)；原批次已于10月13日收口，不再自动执行 |
| 唯一开发结果与证据 | [软件与创作修复结果](../../development-plan/SOFTWARE_AUTHORING_RESULT.md)；最新关闭、Markdown、HTML／GLX 编辑和统一编辑复核结果在前，早期阶段按原日期读取 |
| 实际接续任务 | [TASK_BOARD](../../development-plan/TASK_BOARD.md)及对应卡；queued 不自动启动，未实施候选不计完成 |
| 架构与统一选中边界回归修复（10月24—25日，本轮已交付） | 已确认入口恢复、图片面板、Flow定位／更多及画布专业控件边界已集成，关键浏览器4/4、必要类型及独审完成。原30条／5条及同次起终点比较见[综合结果](../../development-plan/20261024-regression-boundary-repair/RESULT.md)；冻结样本14条新增稳定中12条已审补正后定点通过，2条未决，Worker及全量证据限制保留。未commit、push或发布。 |
| 架构优化批次（10月24日，已收口） | [原方案§15](../../../output/architecture-audit-20261024/IMPLEMENTATION_PLAN.md#architecture-batch-closeout)为原批次逐包状态与重启条件；选中实施、试验和维护已收口，其他广义方向条件性暂缓。架构批次已提交推送为 `7952cc24`；历史红例的新结论见下一行，不回写原统计。 |
| 架构审查后续维护（10月24日，遗留项已收口） | [最新四项结果](../../development-plan/20261024-engine-interaction-closeout/RESULT.md)：暂停复位进入规则修复、教师按钮夹具维护、取消归属错误码补齐与 steer 终态预期维护完成；Engine 57／57、互动 7／7、直接取消消费者及三段类型检查通过。[前轮结果](../../development-plan/20261024-architecture-review-followup/RESULT.md)保留回执、规则规划与 Flow 清理及原失败统计。 |
| 资源、运行性能与动画基础（2026-10-24） | [修复报告](../../../output/resource-runtime-repair-20261024/REPORT.md)、[性能对照](../../../output/resource-runtime-repair-20261024/PERFORMANCE.md)、[接口变化](../../../output/resource-runtime-repair-20261024/SOFTWARE_CHANGES.md)、[创作交接](../../../output/resource-runtime-repair-20261024/CREATIVE_HANDOFF.md)；GLX 17.50→8.43MB、正式HTML 29.53→16.39MB。原件只读，本轮独立本地提交，前一轮dirty保留，不push/发布 |
| 统一选中、整体拖动与双击编辑（2026-10-24，历史实施） | [原结果及纠正说明](../../development-plan/20261024-unified-selection-editing/RESULT.md)、[原方案](../../development-plan/20261024-unified-selection-editing/PLAN.md)；原5项浏览器、代表保存冷开及离线证据按其范围保留，未确认UI扩改已由最新边界方案纠正。旧整提描述仅属历史，本轮不commit；完整Electron／Owner接受边界保留 |
| 编辑阻断与体验回退修复（2026-10-23，收口） | [唯一结果及A01–A20／B01–B21覆盖](../../development-plan/20261023-editing-regressions/RESULT.md)；P1–P9软件修复与独审完成，指定GLX、大小HTML副本实际编辑／保存／新进程冷开、最终工具栏视觉及相关类型／构建通过。性能与外部条件边界保留；实施时未提交，本地提交沿下文最新授权 |
| 审计整合与组件／Flow重构（2026-10-23，已完成） | [唯一结果与证据](../../development-plan/20261023-audit-refactor/RESULT.md)；审计归并、B1–B8裁决、混排／插入／发现／分栏及恢复／运行／输出已实施并独审，真实模型接力、人工状态保留、保存新进程冷开与正式compiled离线互动通过；无可比基线，不签普遍提速，实施时未提交，本地提交沿下文最新授权 |
| 关闭、Markdown 与 HTML／GLX 编辑（2026-10-22） | [最新修复结果](../../development-plan/20261022-responsiveness-editing/RESULT.md)；同版本准备与恢复稿去重、原位编辑和实际手柄、试运行隔离、保存与冷开均有直接证据，性能数字按各自条件读取 |
| 统一编辑体验与性能收敛（2026-10-22，已实施） | [复核修复闭环](../../development-plan/20261022-unified-edit-performance/REPAIR_RESULT.md)为最终入口；[先期实施结果](../../development-plan/20261022-unified-edit-performance/IMPLEMENTATION_RESULT.md)保留旧条件。大 HTML 同样本保存 8.697→7.130 秒，不与旧 14.499 秒混作同一对照；条件优化、物理 IME 与 Owner 接受等边界保留 |
| 通用GLX作品与三表面容器化（2026-10-20） | [实施结果及A01—A18](../../development-plan/20261020-glx-work-containers/IMPLEMENTATION_RESULT.md)、[下一轮能力交接](../../development-plan/20261020-glx-work-containers/CAPABILITY_HANDOFF.md)；Project 11／Published 4／API5，现行10只在读入边界转换，成熟人工编辑与保存链复用；不自动启动首件创作或发行 |
| 创作边界修复（2026-10-20，已实施） | [实施结果](../../development-plan/20261020-creation-boundary-repair/IMPLEMENTATION_RESULT.md)及[下一轮能力交接](../../development-plan/20261020-creation-boundary-repair/CAPABILITY_HANDOFF.md)；后续已修16×5MiB投影内存放大，原失败保留，未启动完整创作或参考库 |
| 下一步修改方向（未实施） | [内容接入与联动创作修改方向](../../development-plan/内容接入与联动创作修改方向-2026-10-17.md)：吸收 Pro 评估与本轮核查，区分接线、表达和持续编辑，不自动启动产品或作者运行 |
| 本轮创作质量与执行链路方案（2026-10-20，软件已实施） | [创作质量与执行链路修复方案](../../development-plan/创作质量与执行链路修复方案-2026-10-19.md)：A—G可实施软件项已落地，整体质量/效率仍按[实际结果](../../development-plan/SOFTWARE_AUTHORING_RESULT.md#result-creation-quality-execution-20261020)接续；语音文件生成与旧版浏览器TTS分别判断，不把新增供应方当整体前置 |
| 执行规则与技术边界 | [WORKING_PROTOCOL](../../development-plan/WORKING_PROTOCOL.md)按动作取章；[ARCHITECTURE_CONTRACT](../../development-plan/ARCHITECTURE_CONTRACT.md)只读改动命中条目 |
| 观察／摘要／背景装配／Source回显防回退 | `npm run test:authoring-regressions`：冻结真实首稿＋默认主题测量装配、观察报告进入模型与摘要、按窗口预算分包、Source旧回显/同值反馈，以及新构建的真实Electron点击／输入／翻页和雨量40联动。相关路径变化时使用；不调用供应商，不重跑整课作者。 |
| 10月14日审计修复的具体包 | [11包索引](../../development-plan/20261014-audit-remediation/README.md)、[执行方案](../../development-plan/20261014-audit-remediation/EXECUTION_PLAN.md)、[原报告覆盖](../../development-plan/20261014-audit-remediation/REPORT_COVERAGE.md)；完成状态以当前结果为准，不重派已完成包 |
| 操作、创作与格式 | [文档导航](../../README.md)、[用户指南](../../USER_GUIDE.md)；内容任务按 AGENTS 选 Skill，产品开发不加载教学方法 |
| 历史方案、旧验收与恢复 | [归档索引](../README.md)；旧实现/未完成目标保留，原启动指令不自动恢复 |

使用当前源码与直接消费者定位，保全人工布局及原件。10月23日卫生整理提交已完成（`63992093a`）；10月24日资源、运行性能与动画基础按Owner明确要求独立本地提交，前一轮交互dirty保留。各实施RESULT的未提交描述保留为当时事实。push／Portable／发布／部署继续暂停。独立review、模型费用及未知副作用沿各自现行授权，不因导航更新扩大。

原根目录开发总纲已并入本页，ROADMAP并入当前状态；旧ENTRYPOINTS并入文档导航。10月12日原两份方案及启动提示词已按完成状态归档，结果记录迁入本目录；10月23日本次按Owner卫生整理指令，将组件／Flow方案、编辑回退方案、已执行工作流及启动提示词完整迁入[归档](../README.md#2026-10-23-文档整合与本地提交)，原裁决与授权保留。当前工作从本页／当前状态及Owner指定入口进入，不重复执行历史批次。

10月24日资源、运行性能与动画基础的本地commit授权属于前轮历史时点。当前以本文顶部10月26日授权为准：不commit、push、打Portable、发布或部署，保留其他创作工程与已有成果；旧批次不因历史入口自动恢复。

旧 v2／R01—R08／H1—H6 和10月10日 §14.8 等入口已归入历史导航；已执行原规格只供追溯，现有差额按当前状态和用户目标接续。架构目标仍见[统一组件方案](../../development-plan/component-platform-refactor/ARCHITECTURE_AND_REFACTOR_PLAN.md)，机器消费的旧规格仍在[roadmap](../../development-plan/roadmap/README.md)。原入口完整快照见[归档](../20261017-开发状态与任务交接快照.md#entry-snapshot)。
