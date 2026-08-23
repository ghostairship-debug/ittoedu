# IttoEdu 架构稳定化、模块解耦与项目知识系统执行方案

> 计划版本：2.0.0
>
> 正式激活日期：2026-08-24
>
> 产品 Owner 决定：**立即进入架构稳定化，不再把教师 `accepted` 作为技术施工前置。**
>
> 治理关系：根 [`COURSEWARE_DEVELOPMENT_PLAN.md`](../../COURSEWARE_DEVELOPMENT_PLAN.md) 仍是唯一长期总纲；本目录是其下**唯一激活的详细执行子计划**。
>
> 核查基线：产品源码以 `690411d4a101b4020134712108262bddf08e0d2e` 为起点；`dbe518e` 在其上加入旧方案、三份评估，并刷新了三份 `artifacts/ai-capabilities/*` 生成物，未修改产品源码。
>
> 当前状态：**active / 从 ARCH-0A 开始自动推进。**

## 1. 激活与取代关系

本计划已经由产品 Owner 正式激活。它保留详细方案，但消除多份计划同时发号施令的问题：

- 根 `COURSEWARE_DEVELOPMENT_PLAN.md` 决定产品方向、当前主线和发布状态；
- 本目录决定稳定化如何分阶段实施，是当前唯一详细执行子计划；
- `ITTOEDU_ARCHITECTURE_EXECUTION_PLAN_20260821/` 已从当前工作树移除，原文由 Git 历史保留；
- 根目录三份 2026-08-21 评估报告已吸收并移除，原文只在 Git 历史中作为冻结审阅证据；
- `docs/tasks/editor-1.0/` 保留已完成任务和验收证据，但不再作为新架构任务板；
- 教师 `accepted` 继续决定产品结果和发布结论，不阻止内部稳定化、知识索引、模块解耦和 Legacy 迁移。

任何新 Agent 应从根总纲进入本目录，不得再从旧 dated plan、旧 P/T/Q/F/G 卡或三份评估报告领取任务。

## 2. 最终目标：让软件做减法

本轮不是减少方案细节，也不是删除产品能力；目标是减少软件内部重复机制：

- 一个可写的 Course Project V9 作者工程真相；
- 一套稳定 authoring identity、transaction 和 history 语义；
- 减少 V8-shaped projection、Legacy producer、重复 session/history 和 raw Store consumers；
- App、Workspace、Properties 从业务实现降为组合、路由和反馈；
- Slide、Flow、Spatial 保持各自正确的数据模型，只统一公共合同；
- 组件、Runtime、互动、媒体、全局层、教师控制器等能力保留，不以低频为由删除；
- 不借重构扩张新的产品模式、重型平台或第二份数据真相。

衡量进展看重复 writer/consumer/history 是否减少、核心流程是否更稳定，而不是看新增目录、文档或抽象数量。

## 3. 三条实施主线

### 3.1 项目知识索引是必要基础设施

repo-index + Context Pack 用来让自动执行 Agent 读取正确的小型上下文、定位真实 consumer，并在代码变化后检查新鲜度。它是开发侧基础设施，不进入产品运行时。

V1 保持轻量：静态生成事实、少量人工语义、确定性查询和 Markdown Context Pack；不建设图数据库、向量数据库、Watcher、常驻服务或函数级完整调用图。repo-index 未落地前使用 Bootstrap，不因工具缺失停止 ARCH-0A。

### 3.2 模块解耦是施工主体

执行顺序是先建立无环边界和最小窄入口，立即用一个完整纵切证明 transaction/history；证明通过后再扩大到跨 Surface Features、三种 Surfaces 和交付链。不得在核心设计尚未证明前先迁一大片外围消费者，不得用一次性搬目录代替职责迁移，也不得把完整 Zustand Store Hook 包装成 Facade。

### 3.3 自动多智能体持续推进

Owner 不需要逐卡盯进度。Stage Integrator 根据当前阶段、依赖、热点和 Context Pack 生成 S1/S2 卡；Worker 一次执行一张卡；多个 Agent 只在文件防火墙和热点 owner 不冲突时并行；Integrator 自动汇总验证、消费者剩余数、风险和下一张可领取任务。

只有改变冻结合同、扩大产品范围、引入重要依赖、产生不可逆数据风险或安全边界变化时，才暂停并请求 Owner 决策。普通拆分、测试、迁移、文档同步和阶段调度自动完成。

## 4. 详细但单一权威的文档体系

详细方案全部保留，但每份文档只承担一种职责。

| 文档角色 | 内容 | 维护规则 |
|---|---|---|
| 当前权威 | Foundation、Knowledge、Modules、Execution、Development、当前约束/风险/术语 | 人工维护；一个事实只有一个权威落点 |
| 生成视图 | `PACKAGE_MANIFEST.md`、Reading Matrix、Feature Matrix、Source Evidence Index | 从权威元数据生成；不得手工形成第二份状态真相 |
| 冻结证据 | `VALIDATION_REPORT.md`、Review Findings Disposition；旧 dated plan 与三份根评估在 Git 历史 | 保留当时基线和裁决；默认不进入 Worker 阅读集 |
| 模板 | `50-templates/` | 只定义任务、ADR、基线、Handoff 和 Legacy 记录格式，不携带当前事实 |

权威分工：

```text
根总纲                 产品方向、激活路线、发布状态
本 README              详细子计划入口、权威关系、执行顺序
模块文档               当前事实、Owner、边界、Must Preserve
阶段文档               Goal、依赖、退出门禁
任务卡                 单次范围、状态、验证、回滚
自动任务板             从任务卡生成的进度视图，不可手改
冻结证据               解释历史，不发出当前任务
```

摘要只能链接权威内容，不复制维护状态。任务状态只写在任务卡，任务板、依赖图和阶段完成度自动生成。

## 5. 已吸收的审阅材料与关键裁决

本版吸收：

- 2026-08-21 严格并行评估；
- 126 条详细评估；
- 12 项补充评估；
- 2026-08-23 修订包；
- 2026-08-23～24 本轮并行复核发现的文档、确定性、任务派发和复杂度问题。

当前裁决包括：

1. 阶段统一使用 `ARCH-0A/0B` 与 `ARCH-1`～`ARCH-5`，不复用历史 P/T/Q/F/G 编号。
2. Flow 稿纸继续使用 `FlowBlock` / `FlowComponentBlock`；只有 Flow 浮层、Slide、Spatial、global/surface shared 使用 `LayerItem`。
3. Core 不依赖具体 Surface/Feature；App/use-case composition 负责跨域组合。
4. 演化现有 `CourseAuthoringSession`，不新造平行 `ActiveEditor` 真相。
5. repo-index 严格生成物不得由 HEAD、当前时间、绝对路径或机器信息造成自过期；HEAD 只进入非严格运行时诊断。
6. TypeScript 7 索引器先验证 `typescript/unstable/sync` 薄适配层，不默认引入第二套 TypeScript 或 ts-morph。
7. Save、Published V2、Try-run、Full Preview、HTML/Web 主路径标为 `existing/preserve`；迁移重点是真实 Legacy consumer。
8. 非合同任务可读取合同作为证据，但默认不得修改合同；合同目录应是 Read-only，而不是不可读取。
9. 后期阶段保留详细 Epic 合同；精确任务卡在阶段开始前由最新源码、索引和消费者矩阵生成。
10. 代码工作区、简洁模式新入口等产品扩张不作为稳定化必经项；现有能力只做保护和统一底层命令。

## 6. 不可协商的产品与协议边界

- Course Project V9 Schema 继续软冻结；已有字段、判别器和语义不得改，additive 可选字段必须独立合同提交。
- 不恢复 V8 工程导入，不借内部重构创建 V10。
- 不从 Player DOM/Canvas、Phaser proxy 或 Published payload 反建作者工程。
- 不删除或禁用已有高级编辑能力；隐藏能力必须可发现、可保存、可撤销。
- `globalLayerItems`、`surfaceLayerItems`、教师控制器和三种 Surface 能力继续保留。
- 自动化最多证明 `engineering candidate`；真实视觉、互动和教师确认决定 `art candidate` / `accepted`。
- repo-index 不进入产品运行时，不成为新的重型维护平台。

## 7. 激活后的执行顺序

```text
ARCH-0A  治理入口、合法 V9 基线、代表课件与事实矩阵
    ∥
ARCH-0B  repo-index MVP、Context Pack 与自动任务板基础
    ↓
ARCH-1   无环边界 + 一个完整 transaction/history 纵切
    ↓
ARCH-2   Media / Components / Runtime / Layers / Diagnostics 公共能力
    ↓
ARCH-3   Slide / Flow / Spatial 纵向模块化
    ↓
ARCH-4   Preview / Player / Export 与 Legacy consumer 迁移
    ↓
ARCH-5   consumer 归零、清理、完整验证与人工结果复核
```

Owner 已经决定立即稳定化；ARCH-0A 不再重新询问是否启动，只负责传播决定、冻结旧入口、记录基线并生成第一批可领取任务。ARCH-0A 与 ARCH-0B 并行；两者最小安全门通过前不广泛派工。禁止跳过它们直接大拆 `editorStore.ts`、`Workspace.tsx` 或 `PropertiesTab.tsx`。

## 8. 验证预算

- 每张任务只运行 1–3 个目标测试、必要静态检查和一个最小真实流程；
- S2 或阶段热点接入由 Integrator 扩大到相关 typecheck、integration、desktop/Player/export smoke；
- 阶段收口只运行覆盖本阶段风险的相关检查；三份代表工程只用于产品代码阶段；全仓 `verify`、完整 E2E 和打包只在最终候选或明确的跨系统高风险门运行；
- 自动化通过不等于用户结果通过；pipeline、engineering、outcome 分开报告；
- 失败先判断是基线问题还是本任务回归，不用重试次数掩盖不稳定。

## 9. 最小阅读与自动派发

- 先读本 README 和 [阅读矩阵](00-foundation/00_READING_MATRIX.md)；
- 每张卡只补读一个主模块文档、必要合同和一份 Context Pack；
- repo-index 尚未建立时使用 [索引前 Bootstrap](10-knowledge-system/00_SCOPE_DECISION_AND_BOOTSTRAP.md)；
- 当前事实、目标状态和迁移期例外分别读取；
- 默认不读旧 dated plan、三份评估全文或全部 Editor 1.0 历史卡；
- 方案与源码冲突时以合同、源码和可复现结果为准，并修正文档，不按旧文字强改代码。

## 10. 交付结果

本计划完成时应同时得到：

- 可确定生成和检查的项目知识索引；
- 清晰、无环、可自动检查的模块边界；
- 持续下降的 Legacy writer/consumer/history 数量；
- 可自动领取、验证、回滚和续跑的任务体系；
- 保存、恢复、撤销、预览、Player 和导出稳定的代表工程；
- 更少重复机制、更低维护成本，而不是更多平台和更多平行真相。
