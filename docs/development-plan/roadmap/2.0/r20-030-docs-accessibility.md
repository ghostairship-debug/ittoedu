# r20-030-docs-accessibility：完成内部设置 / Chat / timeline 的键盘、读屏、错误恢复与用户文档

- Release: 2.0
- Dependencies: `r20-020-public-authoring`, `r20-021-profile-controls`, `r20-022-materials-privacy-controls`, `r20-025-plugin-workflow-parity`
- Optional: 否
- Write locks: `workspace-shell`, `generated-index`

## 结果与现状

只用键盘和读屏也能完成设置、引用、模式、提问/纠正、变更审阅、恢复和删除；帮助文档与实际三CLI/Skill行为一致。

101提供基础可达操作；生产门需要覆盖完整长流程和失败恢复，不能仅以静态aria属性通过。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/renderer/ui/chat/CourseChatPanel.tsx](../../../../src/renderer/ui/chat/CourseChatPanel.tsx)
- [docs/development-plan/AI_ASSISTANT_DELIVERY_PLAN.md](../../AI_ASSISTANT_DELIVERY_PLAN.md)
- [.agents/skills/build-courseware-project/SKILL.md](../../../../.agents/skills/build-courseware-project/SKILL.md)
- [tests/e2e/stabilizationCoreUsability.spec.ts](../../../../tests/e2e/stabilizationCoreUsability.spec.ts)

## 允许写域与旧路径退出

Workspace可访问性/帮助文档与生成索引中的用户说明；只修真实问题，不新增与操作无关的技术术语。

## 执行步骤

1. 逐步走键盘设置→首次说明→选引用/模式/模型→发送→回答/纠正→Stop→审阅/Undo→搜索/恢复→删除，固定焦点和状态公告。
2. 检查流式消息不会抢焦点/重复读屏，等待问题可被及时发现，视觉状态有文字等价，长日志/窄窗口可读。
3. 按025已验证结果写三CLI安装登录、模型/模式、按需上下文、错误恢复、本地删除与外部历史说明及Build Skill路径。
4. 在实际窗口/读屏工具复核后记录具体限制；文档链接与设置入口双向可达。

## 验收与可信反例

- 实际键盘/读屏可完成完整流程，状态和重要错误可感知；帮助步骤在当前候选真实可执行。
- 反例：无限流式announcement、焦点被新消息抢走、对比度不足、问题藏在日志、文档承诺未支持能力，均需修复。

## 停止条件

没有实际读屏环境只能列未验证，不能以单元测试代替；025未完成的对标结论不可写成宣传。

## 聚焦验证

在以下现有测试入口补本规格命名行为，不能用旧用例通过充当新能力证据。若确需新文件，先在实现diff中创建再同步入口。仅失败指向更广范围或版本门要求才扩大验证。

```text
npm run test:product -- tests/unit/formulaNodeUi.test.tsx
npm run test:e2e -- tests/e2e/stabilizationCoreUsability.spec.ts
```

在真实应用用键盘与实际读屏完成上述流程；截图只能佐证视觉，不能证明读屏。

## 回退与交接

交付可访问操作证据、用户文档和040/S4清单；未支持项明确保留，不虚写全部无障碍。
