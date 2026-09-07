# r20-020-public-authoring：贯通整课生成三表面连续编辑与实际效果QA的生产工作流

- Release: 2.0
- Dependencies: `r20-010-cli-setup-ui`, `r20-011-first-use-risk-notice`, `r18-046-stop-undo-stale`
- Optional: 否
- Write locks: `chat-ui`, `store-kernel`, `ai-session`

## 结果与现状

生产课例从已确认教学方案到整课生成、三表面连续编辑、视觉/互动QA和分享前导出完整可用；贯通1.8/1.9既有能力。

核心聊天/模型/编辑/观察已在前两版完成；此节点聚焦整课与跨表面复杂度和生产失败恢复，不重新做聊天壳。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/renderer/ui/chat/CourseChatPanel.tsx](../../../../src/renderer/ui/chat/CourseChatPanel.tsx)
- [src/renderer/authoring/generation/generationSnapshot.ts](../../../../src/renderer/authoring/generation/generationSnapshot.ts)
- [src/renderer/authoring/generation/prepareGenerationCandidate.ts](../../../../src/renderer/authoring/generation/prepareGenerationCandidate.ts)
- [src/renderer/authoring/tools/authoringToolFacade.ts](../../../../src/renderer/authoring/tools/authoringToolFacade.ts)
- [docs/development-plan/AI_ASSISTANT_DELIVERY_PLAN.md](../../AI_ASSISTANT_DELIVERY_PLAN.md)

## 允许写域与旧路径退出

Chat/Generation生产工作流与唯一事务接线；各Surface正式能力由现有工具消费，跨Owner缺陷回对应包取得锁后修。

## 执行步骤

1. 由已分别确认的两份Markdown生成整课，片段明确Surface/carrier；保持Native/Recipe/Existing Component不等待Generated动态门。
2. 整课多阶段结果可见、可审阅，失败列出已提交阶段与未完成目标；局部修订保持教师人工修改和共享引用。
3. 全课QA读取结构/实际画面/公开运行结果并在明确范围修复；不能仅重复模型自评或静态安全准入。
4. 连续使用生成→编辑→讨论/计划→执行→人工交替→搜索/重启→导出，依赖缺失时正常回到人工创作。

## 验收与可信反例

- 真实三表面课例含Native/Component/Runtime，生成/局部修改/QA修复/保存重开/Player/适用导出全部成立；课程内容保留教学路径。
- 反例：跳过两份MD确认、无实际效果自检、整课失败吞先前内容、重建覆盖人工修改或单一Surface替代其他模型均不通过。

## 停止条件

超当前受支持carrier/Surface的需求明确列边界，不能以截图后备宣称可编辑；当前支持范围失败必须修复。

## 聚焦验证

在以下现有测试入口补本规格命名行为，不能用旧用例通过充当新能力证据。若确需新文件，先在实现diff中创建再同步入口。仅失败指向更广范围或版本门要求才扩大验证。

```text
npm run test:product -- tests/integration/architectureBaselineFlows.test.tsx tests/integration/mixedCrossSurfaceHistory.test.tsx
npm run test:e2e -- tests/e2e/stabilizationCoreUsability.spec.ts
```

使用真实已确认课例完成整课→连续修改→QA→分享前检查；模型结果与实际宿主视觉/行为分别保留。

## 回退与交接

交付全流程课例与真实失败恢复证据供025插件对照；不新增2.0专用writer或降级表面。
