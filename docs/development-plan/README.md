# 开发文档入口

> 根目录 [`COURSEWARE_DEVELOPMENT_PLAN.md`](../../COURSEWARE_DEVELOPMENT_PLAN.md) 是当前产品决定与开发路线的唯一总纲；当前任务数量和状态只看自动生成的 [`TASK_BOARD.md`](TASK_BOARD.md)。已完成、取消和被取代的路线由 Git 历史保存，不回填当前总纲。

## 权威文件

| 文件 | 唯一职责 |
|---|---|
| [开发总纲](../../COURSEWARE_DEVELOPMENT_PLAN.md) | 当前产品决定、边界、优先路线和成功标准 |
| [架构合同](ARCHITECTURE_CONTRACT.md) | 技术不变量、状态分类、模块 Owner、carrier、可信扩展与协议负边界 |
| [工作协议](WORKING_PROTOCOL.md) | 默认开发闭环、停止条件、敏感变更、协调、验证、Git 与完成定义 |
| [任务板](TASK_BOARD.md) | 当前 queued / active / blocked 任务摘要；由脚本生成，不可手改 |
| [任务卡模板](TASK_CARD_TEMPLATE.md) | 仅多执行者、重叠写入、跨会话、交接或阻断时使用的 6 字段模板 |
| [版本路线](roadmap/README.md) | 1.2→2.0 的当前任务 DAG、启动条件、发布门和未来规格；不保存执行状态 |

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

- 决定当前做什么、为什么做、成功标准是什么：读开发总纲。
- 需要启动某个 1.2→2.0 路线节点：先读版本路线和对应规格，再以届时 HEAD、源码、合同和目标测试核实；路线节点本身不是协调状态，满足依赖、当前事实与写锁后才按协议实例化。
- 修改 Schema、持久化、Surface、global/surface 图层、教师控制器、Published/Player、Runtime/Component、网络、导出或稳定身份：补读架构合同的相关条目。
- 决定是否建卡、如何协调、敏感改动补什么检查、何时停止验证或怎样合入：只读工作协议，不从总纲或 AGENTS 复制规则。
- 查看谁正在做什么：只读任务板和对应任务卡；历史阶段名与完成卡不得自动恢复为任务。

## 维护规则

- 一条规则只在一个权威文件写全文；其他文件只写职责指针或任务触发条件。
- 总纲只写当前状态。内容一旦完成、取消或被取代，下一次路线更新时移出正文，由 Git 历史保留。
- 任务数量、状态和瞬时卡片清单只出现在任务板；README、总纲和 AGENTS 不复制。
- 路线 manifest 只描述稳定依赖图，禁止出现 `queued`、`active`、`blocked`、Owner 或完成百分比。
- 参考材料与源码冲突时，按总纲的权威顺序修正参考材料，不按过时文档强改代码。
