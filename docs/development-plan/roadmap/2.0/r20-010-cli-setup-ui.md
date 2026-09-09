# r20-010-cli-setup-ui：完善CLI安装登录诊断与既有模型控制的生产设置

- Release: 2.0
- Dependencies: `r20-000-public-governance`, `r16-030-cli-lifecycle`
- Optional: 否
- Write locks: `workspace-shell`, `cli-adapters`

## 结果与现状

教师能自动探测或选择本机CLI路径、查看版本/登录状态/模型能力并完成故障恢复，设置页直接复用1.8模型控制。

基础模型/模式/聊天已在1.8完成；本节点完善安装和持续维护体验，不拖延或重建核心编辑。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/main/localAgent/service.ts](../../../../src/main/localAgent/service.ts)
- [src/main/localAgent/adapter.ts](../../../../src/main/localAgent/adapter.ts)
- [src/main/localAgent/profile.ts](../../../../src/main/localAgent/profile.ts)
- [src/renderer/ui/chat/CourseChatPanel.tsx](../../../../src/renderer/ui/chat/CourseChatPanel.tsx)
- [tests/unit/electronLaunchEnvironment.test.ts](../../../../tests/unit/electronLaunchEnvironment.test.ts)

## 允许写域与旧路径退出

Workspace设置、LocalAgent探测/路径验证与诊断consumer；认证由CLI自行完成，不提供API Key输入或任意args。

## 执行步骤

1. 统一自动发现与用户指定路径校验，显示实际可执行程序、版本和可用性；不在Renderer拼shell或任意启动命令。
2. 将091模型/effort与会话能力接入设置，明确选中/待生效/已确认，版本或账户变化后重新发现。
3. 针对缺失/未登录/过期版本/网络故障提供具体安装、登录与诊断步骤；动作只影响本任务进程。
4. 验证设置可关闭、无CLI仍可保存/Player/导出；诊断不泄露环境/凭据。

## 验收与可信反例

- 三CLI分别从可用/缺失状态完成设置与恢复，真实模型配置生效；错误能定位到下一步动作。
- 反例：路径含空格/中文、失效程序、非CLI文件、认证过期、运行中切换、诊断含secret，均不能错误启动或泄漏。

## 停止条件

探测需要用户进行CLI登录时在明确步骤等待，独立人工功能继续；不读取用户密钥实现代登录。

## 聚焦验证

准备与证据复用统一遵循[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)。相关产物准备一次后直接选现有测试；下列E2E只保全聊天可见性和普通讨论基线，不能证明新设置/安装流程。新设置用例先随实现创建，再将实际文件和名称列入FILE与--grep；零匹配不得通过，不整文件运行三CLI付费矩阵。

```text
npx --no-install vitest run tests/unit/electronLaunchEnvironment.test.ts
npx --no-install playwright test tests/e2e/stabilizationCoreUsability.spec.ts --grep "S3 默认可见与普通讨论：安全消息、分页事件重放及零工程写入$"
```

真实Windows环境验证三CLI安装/登录/版本诊断和一次配置确认；不将fixture状态页当本机已登录证据。

## 回退与交接

交付设置/恢复流程和脱敏诊断样例给030/040；配置失效保留可读原因，不静默换模型。
