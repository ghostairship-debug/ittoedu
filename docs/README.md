# 文档导航

本文只负责回答“现在应读哪一份文档”。实现、协议或路线发生变化时，优先更新下列权威文档，不再新增同主题的临时计划稿。

## 当前使用

| 目的 | 权威入口 |
|---|---|
| 产品概览、启动、架构与命令 | [根目录 README](../README.md) |
| 教师和课件作者操作 | [用户指南](USER_GUIDE.md) |
| 当前唯一开发总纲 | [COURSEWARE_DEVELOPMENT_PLAN.md](../COURSEWARE_DEVELOPMENT_PLAN.md)（13.0：立即稳定化、统一架构、渐进解耦、自动多智能体执行） |
| 详细架构、知识索引、阶段与验证 | [最终详细执行方案](development-plan/README.md) |
| Course Project V9 合同、兼容政策与架构边界 | [COURSE_PROJECT_V9.md](contracts/COURSE_PROJECT_V9.md)、[V9_COMPATIBILITY_POLICY.md](contracts/V9_COMPATIBILITY_POLICY.md)、[EDITOR_1_0_ARCHITECTURE_BOUNDARY.md](contracts/EDITOR_1_0_ARCHITECTURE_BOUNDARY.md) |
| 当前阶段与任务规则 | [执行路线](development-plan/30-execution/00_ROADMAP_AND_GATES.md)、[自动执行工作流](development-plan/40-development/00_SINGLE_MAINTAINER_AI_WORKFLOW.md) |
| 历史 Editor 1.0 任务证据（不得领取） | [冻结索引](tasks/editor-1.0/00_INDEX.md) |
| repo-index 落地前的新 Agent 入口 | [PROJECT_COGNITION_INDEX.md](../PROJECT_COGNITION_INDEX.md) |
| AI 教学策划 | [`orchestrate-courseware`](../.agents/skills/orchestrate-courseware/SKILL.md) |
| AI 构建 Course Project V9 | [`build-courseware-project`](../.agents/skills/build-courseware-project/SKILL.md) |
| Runtime API 2 | [场景与全局自由运行时开发指南](RUNTIME_AUTHORING.md) |
| Component API 4 | [互动组件开发指南](COMPONENT_AUTHORING.md) |
| 当前发布输入 | Published Course V2 合同与 [Player / Preview / Export 方案](development-plan/20-modules/08_PLAYER_PREVIEW_EXPORT.md) |
| Legacy PublishedLesson V1 证据 | [PublishedLesson V1](PUBLISHED_LESSON_V1.md)（仅供迁移核查） |
| 机器发现当前契约 | [`artifacts/ai-capabilities/index.json`](../artifacts/ai-capabilities/index.json)（`protocols.project` 为 9） |
| 无界面自检课件工程 | `npm run --silent validate:course-project -- <file.h5lesson>`（`validate:project` 为同一入口） |

当前主干只接受 Course Project V9、Published Course V2、Runtime API 2/3 与 Component API 4。开发稳定化已激活，不等待教师 `accepted`；`accepted` 仍只表示产品 Owner 对具体结果的最终确认。编排 Skill 先确认中等策划再写呈现脚本（脚本选定表面）；确认后 Builder 盘点资产并用真实产品 API 写 V9。教师工作流不使用 Hash、审批或 Evidence 清单。

[AI 互动课件 Skill 设计](AI_COURSEWARE_SKILL_DESIGN.md)、[通用编排规范](AI_COURSEWARE_ORCHESTRATION.md)、[创作接入规范](AI_COURSEWARE_AUTHORING.md) 是 2026-08-13 的人类审阅背景，其中 Project V8 Builder、Hash 审批和 `implementation-ready` 描述已过时；机器执行以当前两个 Skill 为准。

## 历史证据（不是当前执行入口）

| 文档 | 性质 |
|---|---|
| [内部正式版 1.0 里程碑 0 冻结记录](INTERNAL_1_0_MILESTONE_0.md) | 2026-08-07 协议断代依据；当时目标是 Project V8 |
| [课件工作流 W1 验证记录（2026-08-13）](reviews/COURSEWARE_WORKFLOW_W1_VERIFICATION_20260813.md) | 当时薄编排、V8 Builder 与自动化数字；不是当前基线 |
| [W3 Windows / 离线可移植性验证记录（2026-08-13）](reviews/W3_WINDOWS_PORTABILITY_VERIFICATION_20260813.md) | 同机隔离 `engineering candidate` |
| [AI-native 编辑器基建验证记录（2026-08-12）](reviews/AI_NATIVE_EDITOR_FOUNDATION_VERIFICATION_20260812.md) | 身份断代前的 P0–P4 基线 |
| [R0 公式作者编辑技术决策](reviews/FORMULA_AUTHORING_R0_DECISION_20260811.md) | 公式输入路线的有效决策记录 |
| [声明式课程状态与导航守卫 RFC](reviews/DECLARATIVE_COURSE_STATE_RFC_20260812.md) | 研究提案，不是当前能力 |
| [Unified Authoring Blueprint RFC](reviews/UNIFIED_AUTHORING_BLUEPRINT_RFC_20260813.md) | 研究提案，不是当前产品能力 |
| [产品身份断代与 Headless 自检验证记录](reviews/PRODUCT_IDENTITY_RENAME_VERIFICATION_20260812.md) | 2026-08-12 整体基线 |
| [组件库收敛验证记录](reviews/COMPONENT_LIBRARY_CONSOLIDATION_VERIFICATION_20260813.md) | 当时组件事实 |

可选的相邻仓库 `../courseware-cases` 保存历史课例；它不属于当前核心仓，缺失时从 Git 历史定位。更早的 Editor 1.6/1.7、Project V7 由 Git 标签 `internal-prototype-1.7.0` 保存。V8→V9 重建任务包已从仓库删除，证据在 Git 历史。

## 维护规则

1. 当前能力只写入 README、用户指南和对应协议指南。
2. 当前路线只写入根目录总纲与 `docs/development-plan/`；实时任务状态只来自最终计划任务卡和自动任务板。
3. 一次性技术选择保留为短决策记录；测试结果保留为带日期的证据报告。
4. 历史数字必须标明日期，不得称为“当前基线”。
5. `docs/tasks/editor-1.0/**` 与旧评估只作历史证据，不再写入当前状态或派工信息。
6. 工作流与 Skill 的当前事实只能写入对应权威规范，不从聊天或旧评审稿补写。
