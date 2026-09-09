# r19-060-release：形成 1.9 engineering candidate 并发布 v1.9.0-rc.N 源码标签

- Release: 1.9
- Dependencies: `r19-050-internal-dogfood`, `r19-051-pptx-media-effects`
- Optional: 否
- Write locks: `none`

## 结果与现状

全部1.9持续创作及PPTX媒体目标完成，形成可复核engineering candidate并在获得发布授权后创建v1.9.0-rc.N源码标签。

本版不签accepted、不发布HTML或安装器；S4在2.0统一签署1.9–2.0新增行为。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [docs/development-plan/WORKING_PROTOCOL.md](../../WORKING_PROTOCOL.md)
- [docs/development-plan/AI_ASSISTANT_DELIVERY_PLAN.md](../../AI_ASSISTANT_DELIVERY_PLAN.md)
- [docs/development-plan/PPTX_IMPORT_ENHANCEMENT_PLAN.md](../../PPTX_IMPORT_ENHANCEMENT_PLAN.md)

## 允许写域与旧路径退出

候选发布证据及授权后的源码标签；无产品实现写锁，未完成问题回归其Owner。

## 执行步骤

1. 确认040–045、050、051依赖闭包与证据，复用未变1.8结果，核对当前候选的材料/双流程/工作台/持续创作/删除/未命名工程/长任务。041先开发不豁免其042/044真实接线，043去除UI开发前置不豁免最终展示；050已汇合040–045全部集成门后才可进入候选收口。
2. 运行版本候选所需verify，确认人工能力、三表面、保存重开/Player/导出和本地记录隔离未退化。
3. 记录问题分级、真实CLI范围与2.0未验项；候选标签明确rc.N，不把工程通过写成Owner签署。
4. 发布授权成立后创建该候选源码标签，移交2.0同一基线。

## 验收与可信反例

- 1.9所有必选节点通过且无未关闭核心流程/数据错误，源码候选与验证实现一致；AI与PPTX均完成。
- 反例：遗漏未命名工程/长任务/媒体、仅fixture成功或提前用无后缀正式标签均不通过。

## 停止条件

任何必选门未完成则不发布候选；无发布授权先交付可审阅候选结果，不能自行创建标签。

## 聚焦验证

本节点是版本候选收口，完整verify保留在此处；各局部节点按[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)一次准备后运行命名检查，不预先重复整套候选门。当前候选、环境及相关实现未变时，已有效候选结果可复用；新增行为仍须有真实命名用例和实际路径证据，不能用旧用例通过代替。

```text
npm run verify
git diff --check
```

复核050真实Dogfood与051实际媒体行为；不因发布重复跑未变付费CLI矩阵。

## 回退与交接

交付rc.N候选、有效证据索引与S4待验范围；不晋升accepted保全事实。
