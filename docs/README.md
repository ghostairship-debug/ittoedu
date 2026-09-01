# 文档导航

本文只负责回答"现在应读哪一份文档"。实现、协议或路线发生变化时，优先更新下列权威文档，不再新增同主题的临时计划稿。

## 当前使用

| 目的 | 权威入口 |
|---|---|
| 产品概览、启动、架构与命令 | [根目录 README](../README.md) |
| 教师和课件作者操作 | [用户指南](USER_GUIDE.md) |
| 当前唯一开发总纲 | [COURSEWARE_DEVELOPMENT_PLAN.md](../COURSEWARE_DEVELOPMENT_PLAN.md) |
| 详细执行规则 | [docs/development-plan/](development-plan/README.md)；当前派工只看根计划与任务板 |
| Course Project V9 合同、兼容政策与架构边界 | [COURSE_PROJECT_V9.md](contracts/COURSE_PROJECT_V9.md)、[V9_COMPATIBILITY_POLICY.md](contracts/V9_COMPATIBILITY_POLICY.md)、[EDITOR_1_0_ARCHITECTURE_BOUNDARY.md](contracts/EDITOR_1_0_ARCHITECTURE_BOUNDARY.md) |
| 当前任务状态 | [自动任务板](development-plan/TASK_BOARD.md)（由任务卡生成，不可手改） |
| AI 教学策划 | [`orchestrate-courseware`](../.agents/skills/orchestrate-courseware/SKILL.md) |
| AI 构建 Course Project V9 | [`build-courseware-project`](../.agents/skills/build-courseware-project/SKILL.md) |
| Runtime API 2 | [场景与全局自由运行时开发指南](RUNTIME_AUTHORING.md) |
| Component API 4 | [互动组件开发指南](COMPONENT_AUTHORING.md) |
| 单 HTML / 网页包发布输入格式 | [PublishedLesson V1](PUBLISHED_LESSON_V1.md) 与 `src/shared/contracts/published-course-v2/` |
| 机器发现当前契约 | [`artifacts/ai-capabilities/index.json`](../artifacts/ai-capabilities/index.json)（`protocols.project` 为 9） |
| 无界面自检课件工程 | `npm run --silent validate:course-project -- <file.h5lesson>`（`validate:project` 为同一入口） |
| 开发定位 | 默认直接读源码、合同与目标测试；需要缩小上下文时可先显式 `npm run repo:index`，再用 `npm run repo:context -- --feature <名称>`（可选本地缓存） |

当前主干只接受 Course Project V9、Published Course V2、Runtime API 2/3 与 Component API 4。`accepted` 只表示产品 Owner 对具体结果的最终确认。编排 Skill 先确认中等策划再写呈现脚本（脚本选定表面）；确认后 Builder 盘点资产并用真实产品 API 写 V9。教师工作流不使用 Hash、审批或 Evidence 清单。

## 历史证据

历史任务卡、评审记录与 V8 时代的 AI 创作规范已于 2026-08-25 从当前文档入口移除；已提交过的原文可由 Git 历史读取。产品不打开或导入 V8 `.h5lesson`；仓库仅保留与产品兼容承诺无关的隔离 archive/parser/rejection 测试工具。更早的 Editor 1.6/1.7、Project V7 由 Git 标签 `internal-prototype-1.7.0` 保存。

## 维护规则

1. 当前能力只写入 README、用户指南和对应协议指南。
2. 当前路线只写入根目录总纲与 `docs/development-plan/`；实时任务状态只来自任务卡和自动任务板。
3. 一次性技术选择保留为短决策记录；测试结果保留为带日期的证据报告，过期后随整合移除、由 Git 历史保存。
4. 历史数字必须标明日期，不得称为"当前基线"。
5. 工作流与 Skill 的当前事实只能写入对应权威规范，不从聊天或旧评审稿补写。
