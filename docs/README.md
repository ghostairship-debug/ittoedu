# 文档导航

当前事实和剩余范围集中在[当前状态](development-plan/CURRENT_STATUS.md)。当前代码采用 Project V10、Published V3、Component API 5，正式 DocumentHost 注册 V10 课件 driver；旧格式正文、旧计划与旧签收只按历史范围读取。

| 需要了解什么 | 应读哪里 |
|---|---|
| 产品与启动 | [README](../README.md)、[用户指南](USER_GUIDE.md) |
| 开发入口与实际状态 | [开发入口](development-plan/README.md)、[当前状态](development-plan/CURRENT_STATUS.md) |
| 架构边界与开发规则 | [架构合同](development-plan/ARCHITECTURE_CONTRACT.md)、[工作协议](development-plan/WORKING_PROTOCOL.md) |
| 正式工程 Schema 与操作 | [component-platform 源合同](../src/shared/contracts/component-platform/)、[V10 Schema](../src/shared/contracts/component-platform/schema.ts)、[operations](../src/shared/contracts/component-platform/operations.ts) |
| 组件与局部程序 | [组件指南](COMPONENT_AUTHORING.md)、[运行程序指南](RUNTIME_AUTHORING.md) |
| Player 与输出 | [Published 指南](PUBLISHED_LESSON_V1.md)、[Published V3 合同](../src/shared/contracts/component-platform/published.ts) |
| 机器能力发现 | [当前索引](../artifacts/ai-capabilities/index.json)：project 10 / published 3 / component 5 |
| 实际协调状态 | [生成的任务板](development-plan/TASK_BOARD.md)，只表示实际派发的协调任务 |
| 教学与局部编辑方法 | [orchestrate-courseware](../.agents/skills/orchestrate-courseware/SKILL.md)、[edit-content](../.agents/skills/edit-content/SKILL.md)、[外来 HTML 导入](../.agents/skills/build-courseware-project/SKILL.md) |
| 历史与审计意见 | [归档索引](archive/README.md)；不是当前授权或修复清单 |

当前状态、规范、方案和证据分别承担自己的职责。规范优先核对真实源码及直接 consumer；方案中的目标不自动算已实现；传输成功、正式提交、保存、实际画面和 Owner 接受分别说明。历史数字保留原日期与范围，不迁成当前全软件完成门。
