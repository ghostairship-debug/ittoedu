# 果铃开发入口

**仓库开发治理的最高依据是 [DEVELOPMENT.md](DEVELOPMENT.md)。** 用户最新指令优先；本文件负责导航，不另设一套原则。旧方案、研究结论和历史授权都不能自动启动任务或覆盖当前产品边界。

## 开工读取

- 主 Agent 读核心方法论、[当前状态](docs/development-plan/CURRENT_STATUS.md)，然后直接进入用户指定任务；下一阶段统一按 [执行方案](docs/development-plan/NEXT_EXECUTION.md) 的相关工作包推进。已在上下文中的内容不重复读取。
- 子 Agent 接收目标、实际写域、必要证据和直接源码；不用复制主会话历史。并行生产按独立工作划分，共享文件由一个集成者写入。
- 改到数据、保存、表面布局、Runtime、权限或执行生命周期时，只查 [架构合同](docs/development-plan/ARCHITECTURE_CONTRACT.md) 对应条目与实际消费者；协调、验证和交付细节按需查 [操作参考](docs/development-plan/WORKING_PROTOCOL.md)。
- 跨会话接手先查 [任务板](docs/development-plan/TASK_BOARD.md) 的实际写域。任务板是协调摘要，旧 active 标签和研究报告中的“下一步”不等于当前有人执行或获得新授权。

## 内容任务入口

产品开发不加载创作方法。实际创作按需使用 [新建/续写](.agents/skills/orchestrate-courseware/SKILL.md)、[局部编辑](.agents/skills/edit-content/SKILL.md) 或 [外来 HTML 导入](.agents/skills/build-courseware-project/SKILL.md)；[能力操作](.agents/skills/workbench-usage/SKILL.md) 与 [创作参考](creative-reference/README.md) 分开读取，不预读全库。

内部可逆实现自主推进；超出已有授权的产品定位、核心交互、用户操作方式、默认行为或重要兼容性改变，先交用户决定。保全未提交成果、人工修改和真实数据，当前提交/费用/发行边界见当前状态。
