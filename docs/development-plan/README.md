# 开发执行方案入口

> 治理关系：根目录 [`COURSEWARE_DEVELOPMENT_PLAN.md`](../../COURSEWARE_DEVELOPMENT_PLAN.md) 是仓库唯一开发总纲；本目录是其下唯一详细执行子计划。历史阶段文档（ARCH-0A～ARCH-5 合同、评估、模板与已终态任务卡）已于 2026-08-25 文档整合中移除，原文由 Git 历史保留。
>
> 当前状态与下一可领取项只看自动生成的 [`TASK_BOARD.md`](TASK_BOARD.md)。

## 本目录文件

| 文件 | 职责 |
|---|---|
| [ARCHITECTURE_CONTRACT.md](ARCHITECTURE_CONTRACT.md) | 什么不能坏/本轮必须兑现：25 组架构不变量、状态七分类、模块 Owner、carrier、桌面权限隔离与声明式网络边界 |
| [WORKING_PROTOCOL.md](WORKING_PROTOCOL.md) | 怎么干活（精简生产模式）：默认直达路径、S0/S1/S2、三态任务卡、Reviewer 风险触发器、并发三层、验证同 SHA 去重、Done 定义、Legacy 删除八问 |
| [TASK_CARD_TEMPLATE.md](TASK_CARD_TEMPLATE.md) | 7 字段 Ready 任务卡模板，仅 S2/并发/热点/跨会话需要（与 `scripts/generate-task-board.ts` 同步） |
| [REPAIR_PLAN.md](REPAIR_PLAN.md) | 当前活动路线：工程修复、作者代码权限隔离、远程资源/API 基础、V8 测试产物清退与投影退出 |
| [TASK_BOARD.md](TASK_BOARD.md) | 生成的活跃任务摘要（`npm run generate:task-board`，不可手改；完成即删卡） |
| `tasks/` | 建卡任务的卡文件；当前修复波使用 `tasks/repair/` |
| `inventories/legacy-consumers.json` | Legacy consumer 台账（被 repo-index semantic 与测试消费，删除状态唯一真相） |
| `inventories/FEATURE_CONSUMER_OWNER_LEDGER.md` | ARCH-0A 时期的 Feature/consumer/owner 清单（被 repo-index 引用） |
| `baselines/ARCH_0_PERFORMANCE.md` | 性能对照基线（同机同夹具 median/P95 口径，PRJ 性能修复的对照来源） |

## 目标

把已有能力变成真正可用、稳定、可维护的软件——软件做减法：一个可写 Course Project V9 真相、一套稳定 authoring identity/transaction/history 语义、更少的重复 writer/consumer/session、App/Workspace/Properties 从业务实现降为组合与路由。衡量进展看重复机制是否减少、核心流程是否更稳，不看新增目录、文档或抽象数量。

长期目标（G1–G6）：教师能力不降级；核心链路高可用（编辑→保存→重开→预览→导出）；唯一可写工程真相；无环模块边界；AI 按需认知（小上下文可定位正确入口）；单人 Owner + 自动多智能体可维护。

## 不可协商的产品与协议边界

- Course Project V9 软冻结；additive 可选字段必须独立合同提交；不恢复 V8 导入、不建 V10。
- 不从 Player DOM/Canvas、Phaser proxy 或 Published payload 反建作者工程。
- 不删除或禁用已有高级编辑能力；隐藏能力必须可发现、可保存、可撤销。
- `globalLayerItems`、`surfaceLayerItems`、教师控制器和三种 Surface 能力保留。
- 自动化最多证明 `engineering candidate`；真实视觉、互动和教师确认决定 `art candidate` / `accepted`。
- repo-index 不进入产品运行时，不建图数据库、向量库、Watcher 或常驻服务。
- 不借重构扩建重型平台或第二份数据真相；Owner 已明确准入的远程资源/API 只做最小纵切，不预建 Provider 插件框架；不在缺少真实行为或 consumer 证据时大拆 `editorStore.ts` / `Workspace.tsx` / `PropertiesTab.tsx`。

## 历史纪要

ARCH-0A/0B（治理与 repo-index）、ARCH-1（首个事务纵切）、ARCH-2（跨 Surface 公共能力）、ARCH-3（Surface 模块化）、ARCH-4（交付链收口）、ARCH-5（清理与最终候选）以及 2026-08-24 深度审计的 29 项稳定化已全部终态收口，结论上限 `engineering candidate`（打包与性能测量按 Owner 决定豁免，记录为未执行项）。阶段合同、门禁报告与全部已终态任务卡由 Git 历史保存。
