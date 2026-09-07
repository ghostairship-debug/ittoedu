# r19-050-internal-dogfood：以真实课例验证连续创作长任务恢复与跨入口衔接

- Release: 1.9
- Dependencies: `r18-043-context-references`, `r18-044-tool-timeline`, `r18-045-safe-markdown-formula`, `r18-046-stop-undo-stale`, `r19-040-session-persistence-deletion`, `r19-041-session-navigation`, `r19-042-draft-workspace-continuity`, `r19-043-long-task-context`
- Optional: 否
- Write locks: `chat-ui`

## 结果与现状

真实教师课例能持续创作：材料/已确认方案→生成→人工和AI交替→整课QA→长任务/重启恢复→分享前导出；问题以当前可用性排序。

1.8已经关闭核心功能，1.9验证跨会话和较长生命周期，不能重新以聊天控件有无作为验收。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [docs/development-plan/AI_ASSISTANT_DELIVERY_PLAN.md](../../AI_ASSISTANT_DELIVERY_PLAN.md)
- [docs/development-plan/AI_ASSISTANT_VSCODE_BENCHMARK_ASSESSMENT.md](../../AI_ASSISTANT_VSCODE_BENCHMARK_ASSESSMENT.md)
- [docs/development-plan/WORKING_PROTOCOL.md](../../WORKING_PROTOCOL.md)
- [tests/e2e/stabilizationCoreUsability.spec.ts](../../../../tests/e2e/stabilizationCoreUsability.spec.ts)

## 允许写域与旧路径退出

真实课例驱动、Dogfood证据和Chat范围内复现入口；跨域问题回到对应Owner，保留失败与已验证范围。

## 执行步骤

1. 用已明确确认两份Markdown的真实课例；覆盖至少一份含三表面/动态内容的课程与一份教师实际材料，选择有信息增益的差异。
2. 完成材料引用→生成→局部图片/文字/Runtime修改→整课QA→人工修订→搜索/分支/排队→长任务→重启→继续→删除。
3. 同一课例核验Undo、Save As、保存重开、Player/HTML及适用导出；断网/CLI故障时人工主流程继续。
4. 问题按核心流程/结果错误/性能/维护分维度记录，给精确触发和有效身份；只修/复核受影响证据。

## 验收与可信反例

- 三CLI连续使用与T12完整生命周期有真实证据，无未关闭当前核心流程阻断/数据错误/假完成；个人Skill构建产物可接应用继续编辑。
- 反例：只跑一轮demo、隐瞒失败、在提示里补内部协议、恢复后重复提交、删除误影响课件，都不算Dogfood完成。

## 停止条件

重要生命周期失败先定位相应040–043或1.8Owner修复；不靠清空记录/新建工程绕过。

## 聚焦验证

在以下现有测试入口补本规格命名行为，不能用旧用例通过充当新能力证据。若确需新文件，先在实现diff中创建再同步入口。仅失败指向更广范围或版本门要求才扩大验证。

```text
npm run test:product -- tests/unit/electronLaunchEnvironment.test.ts tests/integration/mixedCrossSurfaceHistory.test.tsx
npm run test:e2e -- tests/e2e/stabilizationCoreUsability.spec.ts
```

真实课例与CLI完成连续使用；现有未失效自然语言证据复用，新增重启/长任务/未命名工程必须真跑。

## 回退与交接

交付课例与失败分级/关闭结果、生命周期证据和2.0尚待插件对照项；只形成工程候选，不代替S4。
