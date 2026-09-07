# r18-094-opencode-interactive-adapter：接通OpenCode原生配置按需读取图片与交互续轮

- Release: 1.8
- Dependencies: `r18-091-cli-model-controls`
- Optional: 否
- Write locks: `cli-adapters`, `main-preload`, `ai-session`
- Gaps: G01, G04, G05, G06, G09

## 结果与现状

OpenCode ACP按原生配置使用所选模型/强度，读取当前观察/能力资源，接收图像并支持提问纠正、取消和续轮。

现有ACP关闭fs.read、强制默认模型、仅候选文件写通道；可写candidate不代表具备完成普通编辑所需的读取/交互环境。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/main/localAgent/openCodeAcp.ts](../../../../src/main/localAgent/openCodeAcp.ts)
- [src/main/localAgent/candidateStaging.ts](../../../../src/main/localAgent/candidateStaging.ts)
- [src/main/localAgent/profile.ts](../../../../src/main/localAgent/profile.ts)
- [src/main/localAgent/protocol.ts](../../../../src/main/localAgent/protocol.ts)
- [src/shared/localAgentContract.ts](../../../../src/shared/localAgentContract.ts)

## 允许写域与旧路径退出

OpenCode ACP协商/配置/文件输入实现与共用桥的必要分支；只摄取当前candidate root闭合内容，不新增live工具RPC或通用OS沙箱平台。

## 执行步骤

1. 按088协商实际session/config与模型能力，删除强制Big Pickle；无effort的模型UI明确不提供。
2. 实现授权的不可变观察/能力文件读取、原生图像输入及受管暂存工具能力；读取范围和候选写范围分别校验。
3. 映射ACP计划/工具/消息/提问/配置确认，支持真实输入补充与取消；不从文本推测身份或工具成功。
4. 续轮携带新观察和host result，清理跨session句柄；严格候选只由宿主摄取和正式事务写入。

## 验收与可信反例

- 真实OpenCode用已确认模型识图并按需展开能力，完成小编辑、结果回传与续轮；候选可解析并有host receipt。
- 反例：越界路径、过期session、请求不存在模型、坏候选、重复completed、Stop后写文件只留下隔离诊断，不写工程。

## 停止条件

账户或Provider不可用单列外部阻断；不通过放宽UUID/scope/schema来消除模型错误，不把能启动当可用。

## 聚焦验证

在以下现有测试入口补本规格命名行为，不能用旧用例通过充当新能力证据。若确需新文件，先在实现diff中创建再同步入口。仅失败指向更广范围或版本门要求才扩大验证。

```text
npm run test:product -- tests/unit/electronLaunchEnvironment.test.ts tests/unit/editorTransaction.test.ts
```

真实ACP完成最小识图/读取/编辑/纠正链；保存所有失败及模型信息，不使用另一CLI的成功替代。

## 回退与交接

交付ACP能力、路径边界、事件/配置确认样例和100续轮证据；失败清理只触及本任务暂存与进程。
