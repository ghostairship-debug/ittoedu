# 静态计划包文档清单、角色与完整性说明

> 本静态计划包共 57 份 Markdown（包含本清单）。
>
> 根 COURSEWARE_DEVELOPMENT_PLAN.md 是唯一总纲；本目录是唯一详细执行子计划。
>
> 清单按实际文件重建，文件移动后必须同步刷新并通过链接检查。

执行期状态和证据不属于这 57 份静态计划文件：`TASK_BOARD.md` 是从任务卡生成的只读视图，`tasks/` 是任务状态真相，`baselines/` 与 `inventories/` 是运行证据/台账。它们分别按任务、基线和 Legacy 协议维护，不追加到本静态清单，也不得反向成为第二份计划。

## 1. 分组计数

| 分组 | 数量 |
|---|---:|
| root | 4 |
| 00-foundation | 7 |
| 10-knowledge-system | 5 |
| 20-modules | 12 |
| 30-execution | 10 |
| 40-development | 6 |
| 50-templates | 7 |
| 90-appendix | 6 |

## 2. 文档角色

| 角色 | 内容 | 维护规则 |
|---|---|---|
| 当前权威 | foundation、knowledge、modules、execution、development、current/target/risk/glossary | 人工维护；一个事实一个落点 |
| 生成视图 | 本清单、Reading Matrix、Feature Matrix、Source Evidence Index | repo-index 落地后自动生成，不承载独立状态 |
| 冻结证据 | Revision Summary、Validation Report、Review Findings Disposition | 记录整合依据，不派发当前任务 |
| 模板 | 50-templates | 只定义格式，不携带当前状态 |

## 3. 推荐入口

- 总体方向与权威关系：README.md；
- 当前事实：00-foundation/02_CURRENT_FACTS_AND_STATUS.md；
- 模块边界：20-modules/00_MODULE_MAP_AND_OWNERS.md；
- 阶段路线：30-execution/00_ROADMAP_AND_GATES.md；
- 自动执行：40-development/00_SINGLE_MAINTAINER_AI_WORKFLOW.md；
- 最小验证：40-development/03_VALIDATION_STRATEGY.md。

## 4. 全部静态计划文件

| 路径 | 标题 |
|---|---|
| 00-foundation/00_READING_MATRIX.md | 文档阅读矩阵 |
| 00-foundation/01_AUTHORITY_ACTIVATION_AND_BASELINE.md | 权威关系、已激活路线与基线策略 |
| 00-foundation/02_CURRENT_FACTS_AND_STATUS.md | 当前仓库事实、成熟度与真实缺口 |
| 00-foundation/03_GOALS_PRINCIPLES_NON_GOALS.md | 目标、原则与非目标 |
| 00-foundation/04_TARGET_ARCHITECTURE_AND_DEPENDENCY_DAG.md | 目标架构、依赖 DAG 与目录方向 |
| 00-foundation/05_CAPABILITY_MODES_AND_CODE_WORKSPACE.md | 简洁编辑、专业编辑与现有 DeveloperTab |
| 00-foundation/06_FEATURE_MATRIX.md | Feature Matrix：当前状态、Canonical Carrier 与目标 Owner |
| 10-knowledge-system/00_SCOPE_DECISION_AND_BOOTSTRAP.md | 项目知识系统：范围、裁决与索引前 Bootstrap |
| 10-knowledge-system/01_DATA_MODEL_PROVENANCE_AND_FILES.md | repo-index 数据模型、Provenance 与文件布局 |
| 10-knowledge-system/02_TS7_GENERATOR_AND_ADAPTER.md | TypeScript 7 索引生成器与薄适配层 |
| 10-knowledge-system/03_DETERMINISM_FRESHNESS_AND_GIT.md | 确定性、新鲜度与 Git 策略 |
| 10-knowledge-system/04_QUERY_CONTEXT_PACK_AND_QUALITY.md | 查询、Context Pack 与质量门禁 |
| 20-modules/00_MODULE_MAP_AND_OWNERS.md | 模块地图、Owner 与跨切用例 |
| 20-modules/01_EDITOR_CORE_STATE_TRANSACTION_HISTORY.md | Editor Core：状态分类、事务、历史与过期目标 |
| 20-modules/02_APP_PERSISTENCE_IPC_SECURITY_RECOVERY.md | App Shell、保存恢复、IPC、安全与主进程边界 |
| 20-modules/03_SURFACE_CARRIERS_AND_PLACEMENT.md | Slide、Flow、Spatial 的 Carrier、Placement 与共同边界 |
| 20-modules/04_COMPONENTS.md | 组件体系：Catalog、工程包、实例与 Authoring |
| 20-modules/05_RUNTIME_INTERACTIONS_AUTOMATION.md | Runtime、互动规则、动画模板与 Automation |
| 20-modules/06_MEDIA_ASSETS_AND_SIDECARS.md | 媒体、AssetMeta、Sidecar 与资源历史 |
| 20-modules/07_GLOBAL_LAYERS_AND_TEACHER_CONTROLLER.md | 全局层、Surface 共享层、有效图层与教师控制器 |
| 20-modules/08_PLAYER_PREVIEW_EXPORT.md | Published Producer、Player、Try-run、Preview 与 Export |
| 20-modules/09_DIAGNOSTICS_AND_ANALYSIS.md | 结构诊断、作者分析、导出预检与错误呈现 |
| 20-modules/10_UI_COMPOSITION_AND_CODE_WORKSPACE.md | UI Composition、Workspace、Properties 与现有 DeveloperTab |
| 20-modules/11_CURRENT_TO_TARGET_OWNER_MAP.md | 当前目录到目标 Owner 的迁移地图 |
| 30-execution/00_ROADMAP_AND_GATES.md | 稳定化路线、阶段门禁与停止权 |
| 30-execution/01_ARCH_0A_GOVERNANCE_AND_REBASE.md | ARCH-0A：治理、合法 V9 基线与事实重算 |
| 30-execution/02_ARCH_0B_REPO_INDEX_MVP.md | ARCH-0B：轻量 repo-index 与 Context Pack 安全门禁 |
| 30-execution/03_ARCH_1_BOUNDARIES_AND_FIRST_VERTICAL_SLICE.md | ARCH-1：无环边界与第一个完整纵切 |
| 30-execution/04_ARCH_2_CROSS_SURFACE_FEATURES.md | ARCH-2：跨 Surface 公共能力解耦 |
| 30-execution/05_ARCH_3_SURFACE_MODULARIZATION.md | ARCH-3：Slide、Flow、Spatial 纵向模块化 |
| 30-execution/06_ARCH_4_DELIVERY_AND_LEGACY.md | ARCH-4：Preview、Player、Export 与 Legacy consumer 迁移 |
| 30-execution/07_ARCH_5_CLEANUP_AND_FINAL_ACCEPTANCE.md | ARCH-5：证明后清理与最终结果复核 |
| 30-execution/08_DEPENDENCIES_PARALLELISM_AND_HOTSPOTS.md | 依赖 DAG、三 Worker 并行与热点排他 |
| 30-execution/09_LEGACY_CLEANUP_AND_DELETION_PROOF.md | Legacy consumer 台账与删除证明 |
| 40-development/00_SINGLE_MAINTAINER_AI_WORKFLOW.md | 一协调者 + 三智能体无人值守工作流 |
| 40-development/01_TASK_RISK_TIERS_AND_PROTOCOL.md | 任务风险、状态真相与可派发协议 |
| 40-development/02_FILE_FIREWALL_AND_CHANGE_BUDGET.md | 文件防火墙、读取权与变更预算 |
| 40-development/03_VALIDATION_STRATEGY.md | 最小充分验证策略 |
| 40-development/04_DONE_ROLLBACK_HANDOFF.md | Done、自动回滚与证据交接 |
| 40-development/05_DOCUMENT_AND_INDEX_MAINTENANCE.md | 唯一真相、文档与索引维护 |
| 50-templates/ADR_TEMPLATE.md | ADR-XXX：标题 |
| 50-templates/BASELINE_CAPTURE_TEMPLATE.md | Pre-stabilization Baseline |
| 50-templates/HANDOFF_TEMPLATE.md | Task Evidence Handoff |
| 50-templates/LEGACY_CONSUMER_RECORD_TEMPLATE.md | Legacy Consumer Record |
| 50-templates/S0_SIMPLE_FIX_TASK_CARD_TEMPLATE.md | S0 局部小修任务卡 |
| 50-templates/S1_TASK_CARD_TEMPLATE.md | S1 普通跨文件任务卡 |
| 50-templates/S2_MIGRATION_TASK_CARD_TEMPLATE.md | S2 高风险迁移任务卡 |
| 90-appendix/00_CURRENT_MUST_PRESERVE.md | Current Must Preserve：当前已经成立的硬约束 |
| 90-appendix/01_TARGET_AND_TRANSITIONAL_RULES.md | Target Acceptance 与 Transitional Allowances |
| 90-appendix/02_RISK_REGISTER.md | 风险登记册 |
| 90-appendix/03_GLOSSARY_AND_TERM_STATUS.md | 术语与状态 |
| 90-appendix/04_REVIEW_FINDINGS_DISPOSITION.md | 三份评估问题处理追踪 |
| 90-appendix/05_SOURCE_EVIDENCE_INDEX.md | 关键事实证据索引 |
| PACKAGE_MANIFEST.md | 文档清单、角色与完整性说明 |
| README.md | IttoEdu 架构稳定化、模块解耦与项目知识系统执行方案 |
| REVISION_SUMMARY.md | 正式激活摘要与设计裁决 |
| VALIDATION_REPORT.md | 最终计划整合验证报告 |
