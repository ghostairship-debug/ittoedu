# 正式激活摘要与设计裁决

> 版本：2.0.0
>
> Owner 决定日期：2026-08-24
>
> 状态：**本目录已激活为根 `COURSEWARE_DEVELOPMENT_PLAN.md` 下唯一详细执行子计划。**

## 1. Owner 的最终决定

产品 Owner 已明确决定：

- 立即进入架构稳定化，不等待教师 `accepted` 才开始技术施工；
- 教师 `accepted` 仍是产品结果和发布门禁，不能由自动化代替；
- 详细开发方案继续保留，目标是让软件内部做减法，不是让方案失去细节；
- 项目知识索引是自动开发所需基础设施；
- 模块解耦、唯一作者真相和 Legacy consumer 迁移是施工主体；
- 日常工作由 Stage Integrator + 多个 Worker Agent 自动推进，Owner 只处理真正的产品、合同、安全和不可逆决策；
- 任务验证采用最小充分验证，完整验证集中在阶段门禁。

ARCH-0A 现在负责传播和落实该决定，不再重复询问“是否提前稳定化”。

## 2. 计划权威与取代关系

- 根 `COURSEWARE_DEVELOPMENT_PLAN.md` 继续是唯一长期总纲；
- `docs/development-plan/` 是当前唯一详细执行子计划；
- `ITTOEDU_ARCHITECTURE_EXECUTION_PLAN_20260821/` 已被本计划取代并从当前工作树移除，原文由 Git 历史保留；
- 根目录三份 2026-08-21 评估报告已被吸收并移除，只在 Git 历史中作冻结证据；
- `docs/tasks/editor-1.0/` 保留历史任务和验收证据，不再作为新架构任务板；
- 历史 P/T/Q/F/G 编号不得重新领取或复用。

## 3. 已吸收的材料

本版不是只改措辞，而是综合了：

1. 原 2026-08-21 架构执行方案；
2. 严格并行评估中的 B0/H 系列问题；
3. 126 条详细评估；
4. 12 项补充评估；
5. 2026-08-23 修订包；
6. 2026-08-23～24 对修订包开展的并行事实、架构、任务派发、文档完整性与复杂度复核。

基线说明已纠正：`dbe518e` 不只是增加文档，还刷新了三份 `artifacts/ai-capabilities/*` 生成物；产品源码仍以其父提交 `690411d` 为核查起点。

## 4. 保留的技术方向

- 唯一可写 V9 作者工程真相；
- 按 Feature 纵向解耦；
- Slide / Flow / Spatial 只统一公共合同，不统一内部模型；
- Flow 稿纸保留 `FlowBlock` / `FlowComponentBlock`；
- 演化 `CourseAuthoringSession`，不新建平行导航真相；
- 组件四子域：Catalog、工程包、实例、Authoring；
- 轻量、确定性的 repo-index + Context Pack；
- 先建最小窄边界、立即完成一个完整纵切，再扩大到公共能力、三 Surface、交付链和清理；
- Legacy 先迁消费者、后删除实现；
- 小任务目标验证、阶段扩大验证、最终完整验证。

## 5. 软件做减法的判断标准

本计划不以新增目录和抽象数量衡量成功。每个阶段必须证明至少一项减少：

- 可写数据真相减少；
- Legacy writer/consumer 减少；
- 重复 session/history/snapshot 减少；
- raw Store 和 deep import consumer 减少；
- App/Workspace/Properties 中的业务职责减少；
- AI 为一个任务读取的无关文件和历史文档减少；
- 保存、撤销、预览或导出的竞态和 fallback 减少。

若一个任务只增加 Facade、Adapter、文档或目录，却没有减少 owner 混乱、消费者或风险，不算完成。

## 6. 详细方案的单一权威分层

| 层 | 作用 | 规则 |
|---|---|---|
| 当前权威 | Foundation、Knowledge、Modules、Execution、Development、当前约束/风险/术语 | 一个事实只有一个权威落点 |
| 生成视图 | Manifest、Reading Matrix、Feature Matrix、Source Evidence Index、后续任务板 | 从权威数据生成，不手工维护第二份状态 |
| 冻结证据 | Validation Report、Review Disposition；旧方案与三份根评估的 Git 历史 | 解释历史，不发出当前任务 |
| 模板 | ADR、Baseline、Task Card、Handoff、Legacy Record | 只规定格式，不携带当前事实 |

模块文档拥有边界，阶段文档拥有 Gate，任务卡拥有单次范围和状态，自动任务板只显示任务卡结果。

## 7. 对原阻断项的裁决

| 原问题 | 当前裁决 |
|---|---|
| 新 P0–P6 与旧任务撞名 | 全部改为 `ARCH-*`，历史编号不复用 |
| accepted 被当成技术前置 | Owner 已决定立即稳定化；accepted 只约束产品结果和发布 |
| Flow 组件一律 LayerItem | 使用 Surface-specific carrier；Flow 稿纸使用 `FlowComponentBlock` |
| Core 与 Surface/Feature 双向依赖 | shared/domain → Core ports → adapters → app composition |
| 新增 ActiveEditor 平行真相 | 演化 `CourseAuthoringSession`，Surface selection 保持局部 |
| transaction 缺 stale target | 显式 projectId/revision/sessionGeneration/location/scope/itemIds |
| generated HEAD 自过期 | HEAD 不写入严格 committed 生成物，只作运行时诊断 |
| generatedAt 破坏确定性 | 严格生成物不写当前时间 |
| TS7 传统 Compiler API 假设 | `typescript/unstable/sync` spike + 单一薄适配层 |
| 合同目录默认不可读 | 非合同任务默认 Read-only，可取证但不得修改 |
| 已完成能力被重复建设 | 每项标 existing/preserve/partial/missing/legacy-consumer |
| Facade 暴露完整 Store | 只导出窄 selector、typed hook、command、port |
| 后期标题冒充任务卡 | Epic 保留细节；阶段开始前自动生成精确 S2 卡 |
| 当前事实与目标混写 | current-must-preserve / target-acceptance / transitional-allowance 分层 |
| repo:context 尚未存在 | 建成前使用 Bootstrap，ARCH-0B 后切换默认流程 |
| HTML/Web/Player 被写成单链 | 明确 V2 主路径 + Legacy fallback，并按 consumer 退役 |

## 8. 本版新增的执行裁决

- repo-index 是必要开发基础设施，但 V1 保持轻量，不升级为知识平台项目；
- 任务卡是状态单一真相，任务板、依赖图和阶段进度自动生成；
- 多 Agent 只并行无热点冲突的任务，热点由单一 owner 串行接入；
- 代码工作区、简洁模式新入口等产品扩张不属于稳定化必经路线；
- ARCH-0A/0B 先生成真实可领取卡和任务级依赖，再进入产品代码迁移；
- 评估处置要可追踪到原 Finding，不能只用主题摘要冒充逐项闭环；
- 当前源码、合同和可复现结果高于任何索引、评估或历史计划。

## 9. 本版刻意不做

- 不创建 V10；
- 不一次性重写 Store、Workspace 或 Properties；
- 不按文件行数机械切碎代码；
- 不为所有小修创建永久任务文档；
- 不自动推断全部业务 reads/writes；
- 不把 DeveloperTab 强制升级成第三个持久化模式；
- 不在真实消费者清零前删除 `state.project`、投影或 Legacy Player；
- 不把完整 `verify` 放进每张任务卡；
- 不建设图数据库、向量数据库、Daemon、Watcher 或函数级完整调用图；
- 不让旧 dated plan、历史任务或评估报告继续充当当前入口。

## 10. 启动结论

本计划已从“待评估修订包”转为“正式激活的详细执行子计划”。下一步由 ARCH-0A 与 ARCH-0B 并行：一条传播根导航、冻结旧入口、记录合法 V9 基线并重算事实/消费者/Owner；另一条建设知识索引与 Context Pack。两条安全门通过后，系统从 ARCH-1 图片替换完整纵切开始自动推进模块解耦与 Legacy 迁移。
