# 开发文档入口

> 根目录 [`COURSEWARE_DEVELOPMENT_PLAN.md`](../../COURSEWARE_DEVELOPMENT_PLAN.md) 是当前产品决定与开发路线的唯一总纲；当前任务数量和状态只看自动生成的 [`TASK_BOARD.md`](TASK_BOARD.md)。已完成、取消和被取代的路线由 Git 历史保存，不回填当前总纲。

## 权威文件

| 文件 | 唯一职责 |
|---|---|
| [开发总纲](../../COURSEWARE_DEVELOPMENT_PLAN.md) | 当前产品决定、边界、优先路线和成功标准 |
| [架构合同](ARCHITECTURE_CONTRACT.md) | 技术不变量、状态分类、模块 Owner、carrier、可信扩展与协议负边界 |
| [工作协议](WORKING_PROTOCOL.md) | 立项、S0/S1/S2、任务卡、Reviewer、并发、验证、Git 与完成定义 |
| [任务板](TASK_BOARD.md) | 当前 queued / active / blocked 任务摘要；由脚本生成，不可手改 |
| [任务卡模板](TASK_CARD_TEMPLATE.md) | 仅 S2、并发、热点、跨会话或交接任务使用的 7 字段模板 |

## 辅助材料

| 文件 | 用途 |
|---|---|
| `inventories/legacy-consumers.json` | 被自动化消费的 Legacy consumer 真相 |
| `inventories/FEATURE_CONSUMER_OWNER_LEDGER.md` | Feature / consumer / owner 辅助清单 |
| `baselines/ARCH_0_PERFORMANCE.md` | 同机同夹具性能对照基线 |

## 阅读路由

- 决定当前做什么、为什么做、成功标准是什么：读开发总纲。
- 修改 Schema、持久化、Surface、global/surface 图层、教师控制器、Published/Player、Runtime/Component、网络、导出或稳定身份：补读架构合同的相关条目。
- 决定是否建卡、如何并发、何时 Reviewer、跑哪些验证或怎样合入：只读工作协议，不从总纲或 AGENTS 复制规则。
- 查看谁正在做什么：只读任务板和对应任务卡；历史阶段名与完成卡不得自动恢复为任务。

## 维护规则

- 一条规则只在一个权威文件写全文；其他文件只写职责指针或任务触发条件。
- 总纲只写当前状态。内容一旦完成、取消或被取代，下一次路线更新时移出正文，由 Git 历史保留。
- 任务数量、状态和瞬时卡片清单只出现在任务板；README、总纲和 AGENTS 不复制。
- 参考材料与源码冲突时，按总纲的权威顺序修正参考材料，不按过时文档强改代码。
