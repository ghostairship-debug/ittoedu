# r18-102-freshness-conflict-recovery：闭合人工交替编辑中途纠正与过期候选恢复

- Release: 1.8
- Dependencies: `r18-100-task-feedback-loop`, `r18-101-teacher-chat-workflow`
- Optional: 否
- Write locks: `ai-session`, `store-kernel`, `chat-ui`
- Gaps: G08, G09

## 结果与现状

AI与人工交替时识别最新草稿/文档和稳定目标，中途纠正真正进入任务；旧候选不覆盖手工内容，冲突可从新观察继续。

现有stale拒绝是必要底线，但单纯提示失败不能完成持续创作；换选择不能隐式更改任务目标。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/renderer/authoring/generation/generationSnapshot.ts](../../../../src/renderer/authoring/generation/generationSnapshot.ts)
- [src/renderer/authoring/generation/prepareGenerationCandidate.ts](../../../../src/renderer/authoring/generation/prepareGenerationCandidate.ts)
- [src/main/localAgent/harness.ts](../../../../src/main/localAgent/harness.ts)
- [src/renderer/ui/chat/CourseChatPanel.tsx](../../../../src/renderer/ui/chat/CourseChatPanel.tsx)
- [tests/integration/mixedCrossSurfaceHistory.test.tsx](../../../../tests/integration/mixedCrossSurfaceHistory.test.tsx)

## 允许写域与旧路径退出

既有AI task/epoch、generation prepare/commit与Chat冲突恢复投影；不新建CourseAuthoringSession或选择性旧Project覆盖。

## 执行步骤

1. 人工文档/草稿变化、Save As、关闭、Stop与目标删除分别使相关观察/epoch失效；commit前重校验，焦点导航不改绑定目标。
2. 可恢复冲突以最新观察继续同一用户目标，重新prepare稳定目标并重新生成候选；不能改旧candidate revision重放。
3. 中途纠正按原生边界消费并记录，明确目标改变才重授权；旧原生事件归档不影响当前工程。
4. 按receipt展示先前已提交阶段与当前失败；Undo仅走既有混合历史顺序，后续人工修改影响明确可见。

## 验收与可信反例

- T07在AI期间手动修改再继续，人工内容保留且AI结果落到原本授权目标；Stop/关闭/Save As后迟到零写。
- 反例：目标被删/移位、活动文字草稿、并发其他目标、切页后session token改变、两次Stop与断流恢复不能猜目标、重复提交或吞人工历史。

## 停止条件

目标身份无法无歧义恢复时要求重新选择具体对象；仍可独立讨论，不用自动范围扩张或跳过stale检查。

## 聚焦验证

在以下现有测试入口补本规格命名行为，不能用旧用例通过充当新能力证据。若确需新文件，先在实现diff中创建再同步入口。仅失败指向更广范围或版本门要求才扩大验证。

```text
npm run test:product -- tests/unit/editorTransaction.test.ts tests/unit/courseAuthoringSession.test.ts
npm run test:product -- tests/integration/mixedCrossSurfaceHistory.test.tsx tests/integration/teacherControllerMixedSession.test.ts
```

真实三表面进行人工打字/切页/删除/Save As与AI交替；至少一次未提交草稿及一次已提交阶段后Stop，核对保存重开。

## 回退与交接

交付竞态触发、身份轨迹和恢复规则给103/1.9；阶段部分完成如实保留，不能声称整个任务零写。
