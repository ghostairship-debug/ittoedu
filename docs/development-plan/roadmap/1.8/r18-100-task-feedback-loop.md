# r18-100-task-feedback-loop：让同一CLI任务接收宿主结果观察并持续修正

- Release: 1.8
- Dependencies: `r18-092-codex-interactive-adapter`, `r18-093-claude-interactive-adapter`, `r18-094-opencode-interactive-adapter`, `r18-095-authoring-observation`, `r18-097-semantic-edit-replacement`
- Optional: 否
- Write locks: `ai-session`, `cli-adapters`, `store-kernel`, `main-preload`
- Gaps: G05, G06, G08, G09

## 结果与现状

同一用户任务能从观察开始，经CLI候选、宿主检查/验证/提交、结果回传继续修正；最终状态依据host receipt和目标证据。

当前CLI completed和候选/host result相互脱节，编辑失败可被显示为正常回答；一次快照/最终候选不能自检多步目标。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/main/localAgent/harness.ts](../../../../src/main/localAgent/harness.ts)
- [src/main/localAgent/service.ts](../../../../src/main/localAgent/service.ts)
- [src/main/localAgent/repository.ts](../../../../src/main/localAgent/repository.ts)
- [src/renderer/authoring/generation/prepareGenerationCandidate.ts](../../../../src/renderer/authoring/generation/prepareGenerationCandidate.ts)
- [src/renderer/authoring/generation/generationRepair.ts](../../../../src/renderer/authoring/generation/generationRepair.ts)
- [src/renderer/ui/chat/CourseChatPanel.tsx](../../../../src/renderer/ui/chat/CourseChatPanel.tsx)

## 允许写域与旧路径退出

LocalAgent原生会话Owner、Generation任务/候选协调与正式桥；从Chat移走任务逻辑。CLI保持规划循环，宿主只消费声明式状态/结果。

## 执行步骤

1. 实现090唯一任务状态链：观察→原生输入→候选prepare/临时验证→预览或提交→receipt/新观察→续轮；意图决定是否允许写候选。
2. 默认编辑在授权范围自动提交；预览策略等待教师应用；讨论/计划零工程写。CLI回合结束若目标未达成显示待继续/未完成。
3. 一次格式修复带精确诊断；连续两个无目标/变更/诊断进展的候选停止；有进展多阶段任务受可见预算约束。
4. 实现input/question确认、重复/乱序幂等、断流后receipt对账、停止当前epoch；保留先前提交的阶段，未提交阶段零写。

## 验收与可信反例

- 自然语言任务能根据真实host结果继续，最终清楚区分回答、计划、已应用并验证、待应用、部分完成、失败/取消。
- 反例：CLI自称完成但无receipt、断流前已提交、重复candidate、纯讨论被模型输出候选、无进展修复、Stop与commit竞态不能假成功或重复写。

## 停止条件

adapter无法消费后续结果时显式阻断该任务；不在宿主新增第二模型调用/规划循环，不放宽候选校验。

## 聚焦验证

在以下现有测试入口补本规格命名行为，不能用旧用例通过充当新能力证据。若确需新文件，先在实现diff中创建再同步入口。仅失败指向更广范围或版本门要求才扩大验证。

```text
npm run test:product -- tests/unit/electronLaunchEnvironment.test.ts tests/unit/editorTransaction.test.ts
npm run test:product -- tests/integration/architectureBaselineFlows.test.tsx
```

真实三CLI分别证明同一任务至少一次host结果驱动的继续修改；模拟故障只补确定性竞态，不能充当真实循环证据。

## 回退与交接

交付状态/结果事件、断流对账和预算停止规则给101/102/099；删除已迁移Chat私有调度，回退保留已确认事务历史。
