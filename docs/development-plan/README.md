# 开发入口

链接按职责取用，不顺序通读全部文档。已注入的 AGENTS 无需重读。

启动：主执行者读当前指定入口、当前状态和必要问题段落，直接实施和自检；调用其他执行者时只提供相关范围、源码与约束。任务板在实际协调前查，合同和历史证据按需读取。

| 用途 | 入口 |
|---|---|
| 2026-10-14 审计修复（A05/A08及方法分发已闭环） | [11个方案包](20261014-audit-remediation/README.md)、[执行顺序](20261014-audit-remediation/EXECUTION_PLAN.md)及[报告覆盖](20261014-audit-remediation/REPORT_COVERAGE.md)。短作者入口/依赖COW、当前路径回执、真实Electron保存冷开和同稿标准HTML断网结果见[根结果最前节](../../果铃软件与创作修复结果-2026-10-12.md)。A10实际质量未签，A11未触发，A06总冷开边界及先前有效证据保留 |
| 软件与创作修复及 2026-10-13 高优先级收口 | [启动提示词](../../果铃软件与创作修复-Codex执行提示词-2026-10-12.md)、[软件方案全部 1—28 节](../../联网搜索解耦与多后端接入方案-2026-10-12.md)及[互动演示创作方案](../../互动演示创作方案-2026-10-12.md)为规格；当前混合出口、框架交付验收及剩余条件见[逐项结果最前段](../../果铃软件与创作修复结果-2026-10-12.md)和[独审](../../output/repair-hybrid-publish/review.md)。旧 v2、R01—R08、H1—H6 有效实现与证据保留，不另派相交任务；未覆盖的历史范围不自动关闭 |
| 2026-10-12 创作与播放 v2 历史范围 | [v2/R01—R08 原范围](../../创作与播放链路独立修复方案-2026-10-12.md)与[原执行提示词](../../创作与播放链路修复-Codex执行提示词-2026-10-12.md)：已有成果及有效证据保留；本轮重叠残余由上方两份软件/创作规格统一接续，未覆盖的其他历史范围不自动启动 |
| HTML 编译合成与创作设计提升历史目标 | [原执行方案 §15](20261010-workbench-consolidated/EXECUTION_PLAN.md#html-publish-authoring)：H1—H6 原目标与授权历史保留，重叠残余已纳入本轮软件方案 §21—28，不另派相交任务；具体实现与验收状态见本轮逐项结果 |
| 当前界面纠偏与剩余原生验收（已授权实施） | [唯一执行方案 §14.8](20261010-workbench-consolidated/EXECUTION_PLAN.md#workbench-ui-correction)：统一“果铃｜”顶栏和紧凑自适应工具、导入/导出相邻、进入保文字、试运行归工具区；新建文件夹→MD→TXT→工程且PPT统一内容导入；纠正Flow/Spatial/布局/属性/模型默认页；补标签对齐、果铃AI聊天、窄引用条与滚动下拉，/为Skill＋常用操作、@为工作空间文件及当前文档/选区。既有§14候选与有效单EXE行为保留，已生成聊天参考图并实施候选，接续新单EXE实际原生/编辑验收；已有引用显式展示，左右新边缘按钮继续暂缓 |
| 本轮执行规格与结果 | [2026年10月10日方案](20261010-workbench-consolidated/EXECUTION_PLAN.md)与[实施结果](20261010-workbench-consolidated/IMPLEMENTATION_RESULT.md)：W1—W4 代码已实施，实机验收范围见结果；[完整方案包](20261010-workbench-consolidated/README.md)保留为实施前快照，不启动旧任务 |
| 后续 Portable 修复 | [修复结果](20261010-portable-sharp-diagnosis/REPAIR_RESULT.md)：Owner追加授权后，启动隔离、错误分类、独立解包目录和专项验收入口已实施；Windows制品/故障机仍未实测。[原诊断](20261010-portable-sharp-diagnosis/DIAGNOSIS.md)保留为历史，其中 `unpackDirName: false` 建议的勘误见修复结果 |
| 最新 Windows 构建与 Git 交付 | [构建交付记录](20261010-portable-sharp-diagnosis/BUILD_DELIVERY.md)：新 Portable + 完整目录版 ZIP 已生成，实际文件/原生依赖/同批身份核对完成；本轮成果提交并同步远端 main，Windows 运行仍为0/10 |
| 当前基线、阶段与剩余 | [CURRENT_STATUS](CURRENT_STATUS.md) |
| 既有产品计划与基线证据 | [核心体验统一实施包](20261008-core-experience-unified/README.md)：保留 §9＋§10 目标和原证据；与本轮方案冲突的规则以本轮为准，不自动派发旧范围 |
| 作者模型、费用与三路创作约束 | [核心体验原执行指令](20261007-content-revision/CORE_EXPERIENCE_EXECUTION_PROMPT.md)，这些约束保留；开发组织按工作协议 |
| 问题选择与直接定位 | [问题概览](20261007-content-revision/CORE_EXPERIENCE_ISSUES.md#startup-overview)，只展开本批 |
| 核心体验统一解决方案 | [统一方案](20261007-content-revision/CORE_EXPERIENCE_UNIFIED_SOLUTION.md)，含 Owner 决定、七批职责与原 HTML/Runtime 编辑闭环；决策依据，不是第二执行入口 |
| 实际任务与写域 | [TASK_BOARD](TASK_BOARD.md)，按需读对应卡 |
| 执行规则 | [WORKING_PROTOCOL](WORKING_PROTOCOL.md)，按动作读相应章节 |
| 技术边界 | [ARCHITECTURE_CONTRACT](ARCHITECTURE_CONTRACT.md)，按改动读相关条目 |
| 已有结果/原始证据 | [本轮实施结果](20261007-content-revision/IMPLEMENTATION_RESULT.md)、[10月6日修复](20261006-required-fixes-result.md)、[main归并](20261006-main-consolidation.md) |

技术目标保留在[统一组件方案](component-platform-refactor/ARCHITECTURE_AND_REFACTOR_PLAN.md)；旧计划/覆盖见[内容协作包](20261007-content-revision/README.md)，历史原文见[归档](../archive/README.md)。它们不自动恢复排期或触发全量复读；机器消费的旧规格仍在 [roadmap](roadmap/README.md)。

