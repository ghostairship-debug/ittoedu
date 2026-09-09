# r20-011-first-use-risk-notice：首次外部 CLI 使用前显示一般数据发送风险并记录本地确认

- Release: 2.0
- Dependencies: `r20-000-public-governance`
- Optional: 否
- Write locks: `workspace-shell`

## 结果与现状

首次外部CLI发送前说明实际发送对象和外部数据处理边界，教师可继续或取消；说明可复查且不阻断材料类型。

沿用既有路线中首次发送说明要求；这是发送透明度，不是用安全/合规名义增加日常编辑审批。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/main/workspaceIdentity.ts](../../../../src/main/workspaceIdentity.ts)
- [src/shared/localAgentContract.ts](../../../../src/shared/localAgentContract.ts)
- [src/renderer/ui/chat/CourseChatPanel.tsx](../../../../src/renderer/ui/chat/CourseChatPanel.tsx)
- [src/main/localAgent/repository.ts](../../../../src/main/localAgent/repository.ts)

## 允许写域与旧路径退出

Workspace首次说明/本地确认投影，使用已有AI本地记录服务；不新增工程字段或材料分类封锁。

## 执行步骤

1. 确认键采用workspace identity+notice version，展示CLI/Provider及本次实际引用清单和外部保留策略边界。
2. 继续记录本地确认后才启动发送；取消零启动/零发送，草稿输入和人工编辑仍保留。
3. 说明可再次查看；版本变化合理重告知，不在每次小修改重复弹窗。
4. 引用仍可逐项取消，教材/PDF/学生作业不被产品按类型禁止。

## 验收与可信反例

- 首次发送说明与实际引用一致；取消无外部启动/发送，确认只留应用本地且可查。
- 反例：切工程/Save As、notice升级、确认后引用变化、取消/关闭窗口，不能串确认身份或偷偷发送。

## 停止条件

无法列明实际发送内容时修引用数据来源，不用笼统勾选替代；不得宣称用户确认等于Provider法律合规同意。

## 聚焦验证

准备与证据复用统一遵循[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)。相关产物准备一次后直接选目标文件；新首次说明用例先随实现创建再列入入口，不能用旧用例通过充当新能力证据，零匹配不得通过。需要E2E时只列实际存在的FILE和--grep命名用例，不整文件运行付费矩阵。

```text
npx --no-install vitest run tests/unit/electronLaunchEnvironment.test.ts tests/unit/courseAuthoringSession.test.ts
```

隔离workspace验证首次继续/取消和Save As，观察真实启动次数/引用；常规已确认编辑不会重复提示。

## 回退与交接

交付说明文案、确认范围和022数据控制接口；记录不进入课件或发布物。
