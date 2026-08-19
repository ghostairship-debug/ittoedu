# 文档导航

本文只负责回答“现在应读哪一份文档”。实现、协议或路线发生变化时，优先更新下列权威文档，不再新增同主题的临时计划稿。

## 当前使用

| 目的 | 权威入口 |
|---|---|
| 产品概览、启动、架构与命令 | [根目录 README](../README.md) |
| 教师和课件作者操作 | [用户指南](USER_GUIDE.md) |
| 当前软件路线与 Editor 1.0 收尾 | [COURSEWARE_DEVELOPMENT_PLAN.md](../COURSEWARE_DEVELOPMENT_PLAN.md)（12.10：V9 Schema 软冻结；T/P/Q/F/G 已合入；待教师 `accepted`） |
| Course Project V9 合同、兼容政策与架构边界 | [COURSE_PROJECT_V9.md](contracts/COURSE_PROJECT_V9.md)、[V9_COMPATIBILITY_POLICY.md](contracts/V9_COMPATIBILITY_POLICY.md)、[EDITOR_1_0_ARCHITECTURE_BOUNDARY.md](contracts/EDITOR_1_0_ARCHITECTURE_BOUNDARY.md) |
| 可并行执行任务（T0–T6、P1–P8、Q1–Q8、F1–F3、G0–G3 均已合入；不要重做） | [docs/tasks/editor-1.0/00_INDEX.md](tasks/editor-1.0/00_INDEX.md) |
| 第三方工人协议 | [docs/tasks/editor-1.0/02_WORKER.md](tasks/editor-1.0/02_WORKER.md) |
| 新 Agent 代码入口 | [PROJECT_COGNITION_INDEX.md](../PROJECT_COGNITION_INDEX.md) |
| AI 教学策划 | [`orchestrate-courseware`](../.agents/skills/orchestrate-courseware/SKILL.md) |
| AI 构建 Course Project V9 | [`build-courseware-project`](../.agents/skills/build-courseware-project/SKILL.md) |
| Runtime API 2 | [场景与全局自由运行时开发指南](RUNTIME_AUTHORING.md) |
| Component API 4 | [互动组件开发指南](COMPONENT_AUTHORING.md) |
| 单 HTML / 网页包发布输入 | [PublishedLesson V1](PUBLISHED_LESSON_V1.md) |
| 机器发现当前契约 | [`artifacts/ai-capabilities/index.json`](../artifacts/ai-capabilities/index.json)（`protocols.project` 为 9） |
| 无界面自检课件工程 | `npm run --silent validate:course-project -- <file.h5lesson>`（`validate:project` 为同一入口） |

当前主干只接受 Course Project V9、Published Course V2、Runtime API 2/3 与 Component API 4。编排 Skill 先确认中等策划再写呈现脚本（脚本选定表面）；确认后 Builder 盘点资产并用真实产品 API 写 V9。教师工作流不使用 Hash、审批或 Evidence 清单。自动管线最多给出 `engineering candidate`；`art candidate` 需要真实视觉/互动证据，`accepted` 必须来自明确的人类验收。

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

相邻 [`courseware-cases`](../../courseware-cases/README.md) 保存历史课例。更早的 Editor 1.6/1.7、Project V7 由 Git 标签 `internal-prototype-1.7.0` 保存。V8→V9 重建任务包已从仓库删除，证据在 Git 历史。

## 维护规则

1. 当前能力只写入 README、用户指南和对应协议指南。
2. 未来计划只写入根目录开发计划；可执行拆分只写入 `docs/tasks/editor-1.0/`。
3. 一次性技术选择保留为短决策记录；测试结果保留为带日期的证据报告。
4. 历史数字必须标明日期，不得称为“当前基线”。
5. 工作流与 Skill 的当前事实只能写入对应权威规范，不从聊天或旧评审稿补写。
