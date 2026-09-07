# r20-000-public-governance：冻结内部生产支持矩阵数据边界与发布政策

- Release: 2.0
- Dependencies: `r19-060-release`
- Optional: 否
- Write locks: `contracts-schema`, `generated-index`, `workspace-shell`

## 结果与现状

冻结当前内部生产支持矩阵与发布政策，逐项写清三CLI实际版本/模型能力、工作流、数据边界和可读错误；不新增治理平台。

1.8已默认显示入口，2.0不是首次开放聊天；历史ID的public不代表外部分发、多租户或恶意插件市场。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [docs/development-plan/ARCHITECTURE_CONTRACT.md](../../ARCHITECTURE_CONTRACT.md)
- [docs/development-plan/AI_ASSISTANT_DELIVERY_PLAN.md](../../AI_ASSISTANT_DELIVERY_PLAN.md)
- [src/shared/localAgentContract.ts](../../../../src/shared/localAgentContract.ts)
- [src/main/localAgent/profile.ts](../../../../src/main/localAgent/profile.ts)

## 允许写域与旧路径退出

正式支持/配置合同、生成支持矩阵与必要设置投影；复用088/091实证，不重建工具目录或扩大可信扩展边界。

## 执行步骤

1. 按实际候选复核三CLI最低版本和已验证功能，标清图像/effort/交互/恢复差异，未知能力不伪装通用支持。
2. 固化内部默认可见、凭据由CLI持有、人工功能独立、应用记录不进工程/导出及删除边界。
3. 整理可读错误分类与恢复入口：未安装/认证/版本、服务、协议、候选、过期、准入、目标未达成。
4. 确认S4/同一固定HTML发布政策；只更新确实变化合同，不加评分系统/常设治理流程。

## 验收与可信反例

- 支持矩阵由真实能力与当前源码生成/核实，三CLI共同任务可完成；人工编辑在所有AI不可用状态继续。
- 反例：硬编码模型、遗漏CLI能力缺失、将内部版表述为公开发行、把合规提醒代替当前可用性修复均不通过。

## 停止条件

发现1.8/1.9核心行为仍失败则回原Owner修复；不把失败改为支持矩阵N/A逃过门。

## 聚焦验证

在以下现有测试入口补本规格命名行为，不能用旧用例通过充当新能力证据。若确需新文件，先在实现diff中创建再同步入口。仅失败指向更广范围或版本门要求才扩大验证。

```text
npm run check:contracts
npm run check:ai-capabilities
npm run test:product -- tests/unit/electronLaunchEnvironment.test.ts
```

真实候选核对设置状态和可读错误，版本事实复用有效探针，不重跑完整付费矩阵。

## 回退与交接

交付生产支持/错误与设置数据合同，供010/011/021消费；V9与可信扩展能力保持现有边界。
