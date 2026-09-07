# r20-025-plugin-workflow-parity：实测对照Codex和Claude插件并关闭课件工作流体验差距

- Release: 2.0
- Dependencies: `r20-020-public-authoring`, `r20-021-profile-controls`, `r20-022-materials-privacy-controls`
- Optional: 否
- Write locks: `chat-ui`, `cli-adapters`, `workspace-shell`
- Gaps: G01, G02, G03, G04, G05, G06, G07, G08, G09, G10, G11, G12

## 结果与现状

在真实VS Code Codex与Claude Code插件中执行对应工作流，对照本产品并关闭可控性、上下文、行动、自检、恢复、长任务与多会话体验差距。

官方资料和088最小基线只证明目标/可行性；只有真实插件对照可支持“不低于插件级”的结论。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [docs/development-plan/AI_ASSISTANT_VSCODE_BENCHMARK_ASSESSMENT.md](../../AI_ASSISTANT_VSCODE_BENCHMARK_ASSESSMENT.md)
- [docs/development-plan/AI_ASSISTANT_DELIVERY_PLAN.md](../../AI_ASSISTANT_DELIVERY_PLAN.md)
- [src/renderer/ui/chat/CourseChatPanel.tsx](../../../../src/renderer/ui/chat/CourseChatPanel.tsx)
- [src/main/localAgent/profile.ts](../../../../src/main/localAgent/profile.ts)

## 允许写域与旧路径退出

对照驱动、真实证据及Chat/adapter/workspace内明确缺口修复；其他Owner缺口按协议取得对应锁。不得改评分/样本把失败消失。

## 执行步骤

1. 冻结插件与CLI版本、账号可用能力、模型/effort和可比素材；桌面/CLI专有功能不混入IDE基线。
2. 逐项实测引用/发现、模式模型、提问纠正、编辑审阅、工具进度、运行自检、历史恢复、长上下文、多会话；使用普通用户任务和真实画面。
3. 对应课件工作流验证结构/视觉/运行同源观察以及三表面能力，表格记录双方步骤、成功结果、宿主/模型耗时与失败恢复。
4. 差距按当前用户目标重要性修复后复测相关项；说明Git worktree/云环境/MCP等平台专有能力没有同名实现，不据此冒称全功能复制。
5. 汇总逐项证据和结论条件，不能只以总分平均掩盖某项必需工作流不可用。

## 验收与可信反例

- 所有适用于课件的基线工作流有双方实际结果，本产品可完成且无明确能力/控制缺口；课件当前状态理解含结构/画面/运行增量优势证据。
- 反例：仅引用文档、只比按钮、拿ChatGPT桌面代替IDE、换模型遮掩缺陷或用平均分盖过核心失败，均不能宣称达标。

## 停止条件

无法运行真实插件时报告未完成对照，产品其他功能仍可验证；不得在没有实测的情况下标插件级通过。

## 聚焦验证

在以下现有测试入口补本规格命名行为，不能用旧用例通过充当新能力证据。若确需新文件，先在实现diff中创建再同步入口。仅失败指向更广范围或版本门要求才扩大验证。

```text
npm run test:e2e -- tests/e2e/stabilizationCoreUsability.spec.ts
```

真实两插件与本产品对照为必需门；现有自动化不能替代。不同模型/网络无法完全对齐时单列限制，宿主性能分开衡量。

## 回退与交接

交付逐工作流双方证据、剩余差距和产品判定给030/040/S4；保持有限验证，未变项复用088/103/1.9证据。
