# r20-030-docs-accessibility：完成内部设置 / Chat / timeline 的键盘、读屏、错误恢复与用户文档

- Release: 2.0
- Dependencies: `r20-000-public-governance`
- Optional: 否
- Write locks: `workspace-shell`, `generated-index`, `chat-ui`

## 结果与现状

只用键盘和读屏也能完成设置、引用、模式、提问/纠正、变更审阅、恢复和删除；帮助文档与实际三CLI/Skill行为一致。

101提供基础可达操作；生产门需要覆盖完整长流程和失败恢复，不能仅以静态aria属性通过。000完成后即可从010/020/021/022已经稳定的真实界面逐项推进，不等待025全部对照结束；本节点最终收口仍须消费完整稳定界面和025的实际支持结论。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/renderer/ui/chat/CourseChatPanel.tsx](../../../../src/renderer/ui/chat/CourseChatPanel.tsx)
- [docs/development-plan/AI_ASSISTANT_DELIVERY_PLAN.md](../../AI_ASSISTANT_DELIVERY_PLAN.md)
- [.agents/skills/build-courseware-project/SKILL.md](../../../../.agents/skills/build-courseware-project/SKILL.md)
- [tests/e2e/stabilizationCoreUsability.spec.ts](../../../../tests/e2e/stabilizationCoreUsability.spec.ts)

## 允许写域与旧路径退出

Workspace与Chat可访问性/帮助文档、生成索引中的用户说明；只修真实问题，不新增与操作无关的技术术语。粗粒度共享锁由同一Owner持有，必要时委派明确不重叠的叶子文件到隔离工作区；同一个Chat/Workspace实体文件只有一个集成人，不与010/020/021/022另起并行UI状态或重复writer。

## 执行步骤

1. 010/020/021/022每交付一个稳定实际界面，就检查相应键盘操作、焦点和状态公告；尚未完成的界面明确留待接续，不用静态占位页验收。最终走完设置→首次说明→选引用/模式/模型→发送→回答/纠正→Stop→审阅/Undo→搜索/恢复→删除。
2. 检查流式消息不会抢焦点/重复读屏，等待问题可被及时发现，视觉状态有文字等价，长日志/窄窗口可读。
3. 先按各Owner的稳定事实完成安装登录、模型/模式、按需上下文、错误恢复、本地删除与外部历史说明；025产生结论后核对三CLI实际支持和差异，不提前宣传未验证能力。2.0教师的材料、设计、构建、QA、修复与导出步骤全部写成软件内操作，外部Build Skill仅作可选独立入口说明。
4. 在实际窗口/读屏工具复核后记录具体限制；文档链接与设置入口双向可达。

## 验收与可信反例

- 实际键盘/读屏可完成完整流程，状态和重要错误可感知；010/020/021/022最终稳定界面与025支持结论均已消费，帮助步骤在当前候选真实可执行。只完成早期界面不能关闭本节点；040/050仍等待020/021/022/025/030的最终结果。
- 反例：无限流式announcement、焦点被新消息抢走、对比度不足、问题藏在日志、文档承诺未支持能力，均需修复。

## 停止条件

没有实际读屏环境只能列未验证，不能以单元测试代替；025未完成的对标结论不可写成宣传。

## 聚焦验证

准备与证据复用统一遵循[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)，相关产物准备一次后直接选择命名用例，不通过npm生命周期重复构建。当前可复用下列聊天可见性/普通讨论基线；只有调整影响这条路径时才运行，它不能代替新增键盘/读屏行为。新用例先随实现创建，再把实际名称列入FILE与--grep；零匹配不得通过。

```text
npx --no-install playwright test tests/e2e/stabilizationCoreUsability.spec.ts --grep "S3 默认可见与普通讨论：安全消息、分页事件重放及零工程写入$"
```

在真实应用用键盘与实际读屏完成上述流程；截图只能佐证视觉，不能证明读屏。

## 回退与交接

交付可访问操作证据、用户文档和040/S4清单；最终核对所有已稳定生产界面及025结论后收口，未支持项明确保留，不虚写全部无障碍。开发可提前推进不等于提前关闭最终验收。
