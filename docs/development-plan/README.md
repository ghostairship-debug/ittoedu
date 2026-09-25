# 开发文档入口

> **2026-09-22 方案取代声明：** 当前目标以[果铃 2.0 收敛方案](../../果铃2.0收敛方案.md)及其[执行包](../../GPTpro方案/guoling_2_0_execution_plan/00_README.md)为准。旧总纲和 1.x 路线保留为历史与源码事实依据，不再是当前实施入口。本轮只修订方案，尚未开始新产品实现。
> 当前协调任务数量和状态只看自动生成的 [`TASK_BOARD.md`](TASK_BOARD.md)。

## 权威文件

当前接手顺序：**[收敛稿](../../果铃2.0收敛方案.md) → [GPTpro 任务索引](../../GPTpro方案/guoling_2_0_execution_plan/03_TASK_INDEX.md) → [实施顺序](../../GPTpro方案/guoling_2_0_execution_plan/delivery/SEQUENCE.md) → [任务板](TASK_BOARD.md)**，随后按涉及的任务读取合同、源码和目标测试。共享接口先串行固定，再按实际写域推进独立叶子；不能从旧文档的将来时重新启动 1.x 待办。

| 文件 | 唯一职责 |
|---|---|
| [果铃 2.0 收敛方案](../../果铃2.0收敛方案.md) | 当前产品与架构决定、边界和成功标准 |
| [GPTpro 执行包](../../GPTpro方案/guoling_2_0_execution_plan/00_README.md) | 当前任务、批次、接口样例和验收定义；状态不冒充实测 |
| [旧开发总纲](../../COURSEWARE_DEVELOPMENT_PLAN.md) | 1.x 产品决定与路线的历史依据，已被当前方案取代 |
| [架构合同](ARCHITECTURE_CONTRACT.md) | 技术不变量、状态分类、模块 Owner、carrier、可信扩展与协议负边界 |
| [工作协议](WORKING_PROTOCOL.md) | 默认开发闭环、停止条件、敏感变更、协调、验证、Git 与完成定义 |
| [任务板](TASK_BOARD.md) | 当前 queued / active / blocked 任务摘要；由脚本生成，不可手改 |
| [任务卡模板](TASK_CARD_TEMPLATE.md) | 仅多执行者、重叠写入、跨会话、交接或阻断时使用的 6 字段模板 |
| [旧版本路线](roadmap/README.md) | 历史 1.2→2.0 DAG 与规格；当前次序以 GPTpro 执行包为准 |
| [1.9 完整实施方案](R19_FRONTEND_SPECIAL_IMPLEMENTATION_PLAN.md) | 历史 F00–F08 分包与 050/051/060 收口依据，不自动恢复待办 |
| [V3.1 设计说明](../../双形态UI设计/00-设计说明.md) | 历史视觉参考；当前产品层级与默认行为以收敛稿为准 |

## 1.9 历史文档分工

| 文档组 | 应如何使用 |
|---|---|
| [共用编辑方案](R19_SHARED_DOCUMENT_EDITOR_IMPLEMENTATION_PLAN.md)及正文／文件合同 | 已有能力的实现依据、技术边界与分项证据；当前派工以收敛稿与 GPTpro 执行包为准 |
| [U01–U10 任务包](R19_PRODUCT_USABILITY_EXECUTION_TASKS.md)、[原可用性方案](R19_PRODUCT_USABILITY_IMPROVEMENT_PLAN.md) | 已实施批次的设计参考，不能当作当前待执行列表；工作台默认不强制四阶段 |
| [U01–U10 记录](reviews/2026-09-17-r19-usability-execution.md)、[有限收尾记录](reviews/2026-09-17-r19-limited-closeout.md) | 复用已有工程证据；不证明整个 1.9 已完成 |
| [1.9 路线与验收规格](roadmap/1.9/README.md) | 历史 DAG、节点规格及 050/051/060 证据，不作为当前实施次序 |
| [长期产品研究](../../果铃_AI原生文件与内容工作台_产品方案_V2.0.md) | 后续候选与讨论材料；Office、HTML、插件不能据此进入当前范围 |
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

- 决定当前做什么、为什么做、成功标准是什么：读收敛稿与 GPTpro 执行包。
- 启动当前任务：按 GPTpro 任务索引和实施顺序，以届时 HEAD、源码、合同和目标测试核实；方案任务不是协调状态，满足依赖、当前事实与写锁后才按协议实例化。旧路线节点不自动恢复。
- 修改 Schema、持久化、Surface、global/surface 图层、教师控制器、Published/Player、Runtime/Component、网络、导出或稳定身份：补读架构合同的相关条目。
- 决定是否建卡、如何协调、敏感改动补什么检查、何时停止验证或怎样合入：只读工作协议，不从总纲或 AGENTS 复制规则。
- 查看谁正在做什么：只读任务板和对应任务卡；历史阶段名与完成卡不得自动恢复为任务。

## 维护规则

- 一条规则只在一个权威文件写全文；其他文件只写职责指针或任务触发条件。
- 总纲只写当前状态。内容一旦完成、取消或被取代，下一次路线更新时移出正文，由 Git 历史保留。
- 任务数量、状态和瞬时卡片清单只出现在任务板；README、总纲和 AGENTS 不复制。
- 路线 manifest 只描述稳定依赖图，禁止出现 `queued`、`active`、`blocked`、Owner 或完成百分比。
- 参考材料与源码冲突时，按收敛稿的权威边界区分当前事实与待实现目标，不按过时文档强改代码。
