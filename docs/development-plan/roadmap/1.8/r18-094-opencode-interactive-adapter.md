# r18-094-opencode-interactive-adapter：接通OpenCode原生配置按需读取图片与交互续轮

- Release: 1.8
- Dependencies: `r18-091-cli-model-controls`
- Optional: 否
- Write locks: `cli-adapter-opencode`
- Gaps: G01, G04, G05, G06, G09

## 结果与现状

OpenCode ACP按原生配置使用所选模型/强度，读取当前观察/能力资源，接收图像并支持提问纠正、取消和续轮；与相同配置和授权的外部OpenCode保留文件、终端、网络、工具连接、Skills与子任务能力。

V2 ACP协商、原生配置和授权文件输入已有工作区实现。2026-09-08[审查](../../reviews/1.8-first-batch-review.md)确认：初始化期间子进程退出未拒绝待处理RPC，open可能一直等待；Harness的新建/恢复偏好应用也须与091联调。保留已经有效的协议映射，不把原生配置接口存在当作宿主真实请求已生效。

当前ACP声明terminal:false，文件桥与权限回传只允许观察读取或当前candidate文件写入。这是产品限制，不是原生能力对等；须分开CLI工具工作范围与宿主候选摄取范围。

本批的已定位符号、固定原生映射、允许改动、退出点和精确检查见[首批执行包第6节](FIRST_BATCH_EXECUTION.md)。先用已预完成合同与真实样本，不重复探索其已确定边界。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/main/localAgent/openCodeAcp.ts](../../../../src/main/localAgent/openCodeAcp.ts)
- [src/main/localAgent/candidateStaging.ts](../../../../src/main/localAgent/candidateStaging.ts)
- [src/main/localAgent/profile.ts](../../../../src/main/localAgent/profile.ts)
- [src/shared/localAgentTaskContract.ts](../../../../src/shared/localAgentTaskContract.ts)
- [src/shared/localAgentContract.ts](../../../../src/shared/localAgentContract.ts)

## 允许写域与旧路径退出

OpenCode ACP协商/配置/原生文件终端及授权接线与共用桥的必要分支；只摄取当前candidate root闭合内容，不新增live工程工具RPC、独立MCP服务或通用OS沙箱平台。共享工作上下文由090/091集成。

## 执行步骤

1. 按088协商实际session/config与模型能力，删除强制Big Pickle；无effort的模型UI明确不提供。
2. 实现原生图像与按需观察输入；删除固定terminal:false和仅观察/单候选文件的全局工具限制。按相同原生配置和用户授权接通实际文件/终端能力，候选根校验只约束宿主摄取，不替代CLI工作目录或原生文件权限。
3. 映射ACP计划/工具/消息/提问/配置确认及必要授权往返，支持真实输入补充与取消；允许/拒绝/取消按原生语义回传，不从文本推测身份或工具成功，不默默提权。
4. 续轮携带新观察和host result，清理跨session句柄；严格候选只由宿主摄取和正式事务写入。
5. 保留用户原生工具连接、Skills与子任务；是否继承既有连接以真实发现/调用确认，不能仅凭mcpServers空数组判断。应用只实现当前ACP实际需要的窄接线，不建设另一工具或模型循环。

本次修复在进程error/close/主动close统一拒绝并清空待处理RPC；初始化/配置/启动等待有界，关闭幂等且唤醒等待方。与Harness验证退出/取消后运行槽释放，不仅验证adapter事件队列关闭。不要为消除卡住无限重试或延长所有阶段等待。

## 验收与可信反例

- 真实OpenCode用已确认模型识图并按需展开能力，完成小编辑、结果回传与续轮；候选可解析并有host receipt。
- 反例：candidate root外摄取、过期session、请求不存在模型、坏候选、重复completed、Stop后迟到候选均不写工程；原生授权下的其他文件操作不因观察scope被产品拒绝，也不能冒称当前工程已提交。
- 立即exit(23)须使open拒绝；初始化/配置/启动无响应后Stop/删除结束，后续任务可启动。实际模型确认沿091从Harness入口验证，配置失败不静默使用另一模型。
- 与相同有效配置的外部基线核对受影响文件/终端/网络和工具/Skill/子任务能力；必要授权可经GUI允许、拒绝或取消，原生不支持项如实说明。只声明能力或放开标志而没有实际操作不能作为通过。

## 停止条件

账户或Provider不可用单列外部阻断；不通过放宽UUID/scope/schema来消除模型错误，不把能启动当可用。

## 聚焦验证

按[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)为本次代码变化和所选用例准备必要产物一次，再执行以下直接入口；纯逻辑/Schema测试不因此重构建。现有用例只证明其实际覆盖的行为；新增行为在实施diff中补命名测试，并同步文件及 `-t` / `--grep` 选择。执行时确认目标测试实际被选中，0匹配不算通过，不用旧用例通过代签新能力。未变化证据继续复用，仅失败指向更广范围或版本门要求才扩大验证。

```text
npx --no-install vitest run tests/unit/openCodeAcp.test.ts tests/unit/diagnosticLog.test.ts
```

真实ACP完成最小识图/读取/编辑/纠正链；保存所有失败及模型信息，不使用另一CLI的成功替代。原生对等只补裁剪退出影响的最少必要对照，复用088有效证据并在103汇合，不重复全平台矩阵。

## 回退与交接

交付ACP能力、路径边界、事件/配置确认样例和100续轮证据；失败清理只触及本任务暂存与进程。
