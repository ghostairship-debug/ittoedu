# r19-043-long-task-context：闭合长任务上下文压缩缓存失效与阶段性能诊断

- Release: 1.9
- Dependencies: `r19-041-session-navigation`, `r19-042-draft-workspace-continuity`
- Optional: 否
- Write locks: `ai-session`, `cli-adapters`, `chat-ui`
- Gaps: G07, G09

## 结果与现状

长对话/多阶段课例在CLI上下文压缩与任务恢复后保持目标、已提交结果和最新课件事实；缓存和阶段性能可诊断。

G07有上下文膨胀实证；1.8按需发现减少初始负担，仍需证明长任务不会依赖旧快照/被压掉的目标。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/main/localAgent/harness.ts](../../../../src/main/localAgent/harness.ts)
- [src/main/localAgent/repository.ts](../../../../src/main/localAgent/repository.ts)
- [src/main/localAgent/profile.ts](../../../../src/main/localAgent/profile.ts)
- [src/renderer/authoring/generation/generationSnapshot.ts](../../../../src/renderer/authoring/generation/generationSnapshot.ts)
- [src/renderer/ui/chat/CourseChatPanel.tsx](../../../../src/renderer/ui/chat/CourseChatPanel.tsx)

## 允许写域与旧路径退出

同一任务Owner的上下文续接/缓存失效、原生compact/usage映射与Chat阶段诊断；不建立第二模型总结循环或另一份工程摘要真相。

## 执行步骤

1. 以原生CLI压缩能力处理对话长度，宿主持续提供原始目标、当前授权/模式、新观察和已提交receipt引用；历史摘要标明来源和时间。
2. 能力卡/原始资源可按内容版本缓存，doc/draft/view/runtime版本分别失效；压缩后未知内容按需重读，不能把缓存当最新事实。
3. 任务预算与无进展停止沿用100；中断后从明确阶段恢复，不自动重复已提交步骤。
4. 分拆宿主准备/进程/模型首响/工具/准入/提交/渲染耗时和真实usage，缺值标不可用；固定环境做与1.8的可比测量。

## 验收与可信反例

- 真实对话触发至少一次CLI原生压缩/长上下文边界，再人工修改并继续，当前事实与目标/范围保持；有限预算可停止并恢复。
- 反例：能力版本变化、资产同名更新、压缩丢目标、重启旧running、usage缺失、缓存命中但视图变化，不能错误提交/伪造性能。

## 停止条件

某CLI不支持所需上下文控制时明确最低能力或可审阅恢复策略；不依赖宿主第二模型掩盖或无界增加上下文。

## 聚焦验证

在以下现有测试入口补本规格命名行为，不能用旧用例通过充当新能力证据。若确需新文件，先在实现diff中创建再同步入口。仅失败指向更广范围或版本门要求才扩大验证。

```text
npm run test:product -- tests/unit/electronLaunchEnvironment.test.ts tests/unit/editorTransaction.test.ts
npm run test:e2e -- tests/e2e/stabilizationCoreUsability.spec.ts
```

每CLI实际长任务至少跨一个真实压缩/恢复边界，保留事件和全部阶段耗时；先复用既有长任务，不人为烧token凑长度。

## 回退与交接

交付原生压缩/恢复支持表、缓存规则和阶段诊断；050连续课例按同一版本/模型比较。
