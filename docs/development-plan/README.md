# 开发文档入口

> **2026-10-06 正式承载已归并到 `D:/果铃工作台` 的 `main`。** 已验证候选 `125d52fd` 已快进合入；旧工作树、未提交成果和验证资料先保全再清理。当前范围、归档恢复入口及验证见[主线归并记录](20261006-main-consolidation.md)，上一批实际能力与剩余问题见[修复结果](20261006-required-fixes-result.md)。以下 2026-10-05 迁移路径是当时承载，不能再作为当前启动目录。

> **2026-10-05 唯一当前方案：** [稳定基线恢复与 V10 渐进替换完整并发计划](component-platform-refactor/BASELINE_FIRST_V10_EXECUTION_PLAN.md)。先保全当前成果、恢复 V10 前成熟完整前端，再沿既有解耦端口渐进替换；每个 UI 模块修改前明确合同必要性或已证问题。方案由 Root 撰写、Astra 技术审阅，Luna 不参与计划设计或正文。
>
> **2026-10-05 Owner 已授权本计划全部产品实施。** B0 已完整保全冻结候选，当前迁移承载为 `D:/果铃恢复候选/20261005-v10-migration`，从 027d 成熟前端渐进接入现 V10 模块。真实模型调用暂不授权，发布继续暂停。原 N/L 目标全部保留，实际工程与 UI 证据按对应范围记录。
>
> 实际协调状态只看自动生成的[任务板](TASK_BOARD.md)。方案保存不创建产品任务卡，不表示派发、通过或 Owner 接受。

## 权威文件

接手时先确定[任务板](TASK_BOARD.md)的实际写锁，再读总方案相关章节和执行计划对应任务，按需读取合同、直接源码与目标测试。N00a 数据贯通与 N00b 可替换编辑探针分开；独立叶子立即并行，不等待所有纯类型冻结或 GJS 成败。不要求每位执行者通读全部方案和历史任务。

| 文件 | 唯一职责 |
|---|---|
| [统一组件总方案](component-platform-refactor/ARCHITECTURE_AND_REFACTOR_PLAN.md) | 当前产品与架构目标、职责、边界和取舍 |
| [稳定基线恢复与 V10 渐进替换计划](component-platform-refactor/BASELINE_FIRST_V10_EXECUTION_PLAN.md) | 当前唯一执行方案：基线保全、完整前端复用、逐模块动机、精确 owner、DAG 与真实 UI 切换证据 |
| [原执行计划与历史任务索引](component-platform-refactor/EXECUTION_PLAN.md) | 原 N/L 目标和历史拆解，新计划映射其完整范围；旧阶段起跑不自动执行 |
| [旧创作管线补充方案](component-platform-refactor/AUTHORING_PIPELINE_UNIFICATION_EXECUTION_PLAN.md) | 历史问题与接口材料，不作为当前起跑安排 |
| [旧成熟 UI 接入补充方案](component-platform-refactor/UI_REINTEGRATION_EXECUTION_PLAN.md) | 成熟模块与端口复用材料，当前 owner 与顺序由新计划确定 |
| [Luna 机械执行入口](component-platform-refactor/LUNA_EXECUTION_PROMPT.md) | 确定命令的机械执行边界；开发计划和技术取舍归 Root/Astra，当前不启动执行 |
| [旧开发总纲](../../COURSEWARE_DEVELOPMENT_PLAN.md) | 1.x 产品决定与路线的历史依据，已被当前方案取代 |
| [架构合同](ARCHITECTURE_CONTRACT.md) | 已确定的技术不变量及当前实现边界；新字段随直接 producer／consumer 实施收口 |
| [工作协议](WORKING_PROTOCOL.md) | 默认开发闭环、停止条件、敏感变更、协调、验证、Git 与完成定义 |
| [任务板](TASK_BOARD.md) | 当前 queued / active / blocked 任务摘要；由脚本生成，不可手改 |
| [任务卡模板](TASK_CARD_TEMPLATE.md) | 仅多执行者、重叠写入、跨会话、交接或阻断时使用的 6 字段模板 |
| [旧版本路线](roadmap/README.md) | 历史 1.2→2.0 DAG 与规格，不恢复为当前排期 |
| [1.9 完整实施方案](R19_FRONTEND_SPECIAL_IMPLEMENTATION_PLAN.md) | 历史 F00–F08 分包与 050/051/060 收口依据，不自动恢复待办 |
| [V3.1 设计说明](../../双形态UI设计/00-设计说明.md) | 历史视觉参考，未涉及的有效工作台行为继续复用 |

进一步看 [ARCHITECTURE_CONTRACT](ARCHITECTURE_CONTRACT.md) 与 [WORKING_PROTOCOL](WORKING_PROTOCOL.md) 入口。

## 实现状态与历史依据

- 目标仍为独立 Project V10、Published V3、Component API 5；现 V10 候选与冻结增量保留。成熟原版及新候选分开，以新计划的实际承载和证据为准，不因文档称完整软件已恢复。
- 稳定基线恢复、渐进替换及本批必做修复已集成到 main；工程候选、独立 review、真实 UI/MCP 与保存/冷开/导出证据只覆盖各自已记录范围。旧成果已保存在 Git 归档引用和本地归档目录，不恢复为产品 writer。存量类型/测试维护债与历史 native 根因未完全验证继续如实保留；发布继续暂停。
- [上一轮统一内容方案与记录](unified-content-architecture/README.md)：U/W 实施范围与证据，不能再标成整体“未授权提案”，也不能视为本轮新架构通过。
- [果铃 2.0 收敛稿](../archive/2026-09-convergence/果铃2.0收敛方案.md)与 [GPTpro 执行包](../../GPTpro方案/guoling_2_0_execution_plan/00_README.md)：已归档的路线、接口背景及复用实现索引；仅在直接相关时读取。

## 1.9 历史文档分工

| 文档组 | 应如何使用 |
|---|---|
| [共用编辑方案](R19_SHARED_DOCUMENT_EDITOR_IMPLEMENTATION_PLAN.md)及正文／文件合同 | 已有能力的实现依据与分项证据；新派工以统一组件执行计划为准 |
| [U01–U10 任务包](R19_PRODUCT_USABILITY_EXECUTION_TASKS.md)、[原可用性方案](R19_PRODUCT_USABILITY_IMPROVEMENT_PLAN.md) | 已实施批次的设计参考，不能当作当前待执行列表；工作台默认不强制四阶段 |
| [U01–U10 记录](reviews/2026-09-17-r19-usability-execution.md)、[有限收尾记录](reviews/2026-09-17-r19-limited-closeout.md) | 复用已有工程证据；不证明整个 1.9 已完成 |
| [1.9 路线与验收规格](roadmap/1.9/README.md) | 历史 DAG、节点规格及 050/051/060 证据，不作为当前实施次序 |
| [长期产品研究](../archive/long-term-research/果铃_AI原生文件与内容工作台_产品方案_V2.0.md) | 后续候选与讨论材料；Office、HTML、插件不能据此进入当前范围 |
| [历史总纲快照](../archive/2026-09-planning/2026-09-17-development-route-history.md) | 仅追溯多轮讨论，不读作当前任务 |

## 辅助材料

| 文件 | 用途 |
|---|---|
| `inventories/legacy-consumers.json` | 被自动化消费的 Legacy consumer 真相 |
| `inventories/FEATURE_CONSUMER_OWNER_LEDGER.md` | Feature / consumer / owner 辅助清单 |
| `baselines/ARCH_0_PERFORMANCE.md` | 同机同夹具性能对照基线 |
| [`roadmap/PRESERVATION_MATRIX.md`](roadmap/PRESERVATION_MATRIX.md) | 所有改造必须守住的产品行为与最低有效证据 |
| [`roadmap/OLD_PLAN_CROSSWALK.md`](roadmap/OLD_PLAN_CROSSWALK.md) | 被替代 ZIP 中尚未实施的 1.2–2.0 节点映射；已完成 1.1 映射只由 Git 历史保存 |
| [`roadmap/manifest.json`](roadmap/manifest.json) | 路线任务 ID、版本、依赖、可选性、写锁和规格位置；不承担任务状态 |
| [`roadmap/1.2/EXECUTION_GUIDE.md`](roadmap/1.2/EXECUTION_GUIDE.md) | 次旗舰模型实施整个 1.2 的确定顺序、逐节点循环、恢复和发布边界 |
| [`roadmap/1.2/IMPLEMENTATION_CONTRACT.md`](roadmap/1.2/IMPLEMENTATION_CONTRACT.md) | 1.2 数据形状、状态事务、渲染/导出映射和失败语义的共享执行真相 |

## 阅读路由

- 决定当前做什么与成功标准：读统一组件总方案相应章节；决定如何分工与先后：读执行计划。
- 启动任务：核对工作树中真实的已集成基线、直接接口与写锁，不能只用 HEAD 推断未提交成果已经包含。计划任务只有实际委派时才实例化，旧路线节点不自动恢复。
- 修改 Schema、持久化、Surface、global/surface 图层、教师控制器、Published/Player、Runtime/Component、网络、导出或稳定身份：补读架构合同的相关条目。
- 决定是否建卡、如何协调、敏感改动补什么检查、何时停止验证或怎样合入：只读工作协议，不从总纲或 AGENTS 复制规则。
- 查看谁正在做什么：只读任务板和对应任务卡；历史阶段名与完成卡不得自动恢复为任务。

## 维护规则

- 一条规则只在一个权威文件写全文；其他文件只写职责指针或任务触发条件。
- 总纲只写当前状态。内容一旦完成、取消或被取代，下一次路线更新时移出正文，由 Git 历史保留。
- 任务数量、状态和瞬时卡片清单只出现在任务板；README、总纲和 AGENTS 不复制。
- 路线 manifest 只描述稳定依赖图，禁止出现 `queued`、`active`、`blocked`、Owner 或完成百分比。
- 参考材料与源码冲突时，按收敛稿的权威边界区分当前事实与待实现目标，不按过时文档强改代码。
