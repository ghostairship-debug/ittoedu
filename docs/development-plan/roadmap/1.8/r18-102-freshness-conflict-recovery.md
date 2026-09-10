# r18-102-freshness-conflict-recovery：闭合人工交替编辑中途纠正与过期候选恢复

- Release: 1.8
- Dependencies: `r18-100-task-feedback-loop`, `r18-101-teacher-chat-workflow`
- Optional: 否
- Write locks: `ai-session`, `store-kernel`, `chat-ui`, `app-save-recovery`, `main-preload`
- Gaps: G08, G09

## 结果与现状

AI与人工交替时识别最新草稿/文档和稳定目标，中途纠正真正进入任务；旧候选不覆盖手工内容，冲突可从新观察继续。

2026-09-09核验：task/epoch、提交前revision检查、Stop、同任务新观察续行及回执保存失败不重复commit已有实现。按[统一方案](../../../../AI编辑最短路径产品决策报告.md)补绝对deadline跨prepare/preview等待、finish持久终态与回执未完整的恢复边界；它们仍需新增直接验证。换选择不能隐式更改任务目标，恢复不能通过修改旧候选或预算绕开失效。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/renderer/authoring/generation/generationSnapshot.ts](../../../../src/renderer/authoring/generation/generationSnapshot.ts)
- [src/renderer/authoring/generation/prepareGenerationCandidate.ts](../../../../src/renderer/authoring/generation/prepareGenerationCandidate.ts)
- [src/renderer/authoring/generation/generationTaskController.ts](../../../../src/renderer/authoring/generation/generationTaskController.ts)
- [src/main/localAgent/harness.ts](../../../../src/main/localAgent/harness.ts)
- [src/main/localAgent/repository.ts](../../../../src/main/localAgent/repository.ts)
- [src/renderer/ui/chat/CourseChatPanel.tsx](../../../../src/renderer/ui/chat/CourseChatPanel.tsx)
- [tests/integration/mixedCrossSurfaceHistory.test.tsx](../../../../tests/integration/mixedCrossSurfaceHistory.test.tsx)

- [src/renderer/app/useCourseProjectLifecycle.ts](../../../../src/renderer/app/useCourseProjectLifecycle.ts)
- [src/main/projectPersistence.ts](../../../../src/main/projectPersistence.ts)

## 允许写域与旧路径退出

既有AI task/epoch、generation prepare/commit与Chat冲突恢复投影，以及现有打开/保存Owner中与原生外部文件变化相关的窄接线；不新建CourseAuthoringSession或选择性旧Project覆盖。

## 执行步骤

090/100承担task/epoch、提交前freshness/deadline及Stop/关闭/Save As后迟到零写，不得等本节点才建立防覆盖。本节点解决失效后怎样继续：使用新观察和原稳定授权目标重新prepare，明确前提未变时复用原意图；同一目标已被人工改动时不自动覆盖，不修改旧candidate revision或原deadline强行重放。

1. 人工文档/草稿变化、Save As、关闭、Stop与目标删除分别使相关观察/epoch失效；commit前重查revision/epoch和20分钟绝对deadline，焦点导航不改绑定目标。
2. 可恢复冲突以最新观察继续同一用户目标，重新prepare稳定目标并重新生成候选。awaiting-apply/waiting-input不隐式延长期限，到期候选不能直接应用；用户再次请求经既有新输入/新观察入口准备，保留已完成事实，不把延长旧deadline或改旧candidate revision当恢复。
3. 中途纠正按原生边界消费并记录，明确目标改变才重授权；旧原生事件归档不影响当前工程。
4. 按正式committed/unchanged回执展示已修改或无需修改，preview待应用保持未完成；Undo仅走既有混合历史顺序。main/renderer/AiTask终态与已持久化记录重开一致；回执送达原生与工程提交分开，待送回执在下一真正请求前准确带入，不重提事务。
5. 保留原生CLI文件权限后，原生工具若改变当前打开工程的磁盘文件，不能把文件成功当宿主commit。由现有打开/保存Owner在继续提交/保存的相关边界核对外部变化，明确重开/保留当前未保存内容或另存，禁止静默覆盖。实施时核实当前检测能力，只补这条真实路径，不假设已有完整外部文件监听，不建设通用watcher平台；工程与AI记录身份仍按正式规则切换。
6. 提交成功但回执保存失败，在当前进程保留已知receipt，只重试记录；已持久化的回执/终态可重开核对。未落盘即崩溃不承诺完整自动恢复，先经现有工程Owner核当前事实，未知明确显示，不自动replay相对修改或补造receipt，不新建通用恢复日志平台。

## 验收与可信反例

- T07在AI期间手动修改再继续，人工内容保留且AI结果落到原本授权目标；Stop/关闭/Save As后迟到零写。
- prepare期间到期、preview等待到期后点击应用、waiting-input后恢复均重查deadline/revision/epoch；到期候选零提交，再次请求从新事实准备，不隐式延长原执行窗口。
- committed/unchanged、待应用、待保存/待送及已持久化finish重开显示准确；回执保存失败不重复commit，未落盘即崩溃的未知结果不replay，不把模型summary当恢复依据。
- 原生工具修改当前工程文件副本后，当前内存不伪同步；继续编辑/保存可发现冲突且保全人工未保存内容，重新打开取得真实新状态，不能补造历史receipt。
- 反例：目标被删/移位、活动文字草稿、并发其他目标、切页后session token改变、两次Stop与断流恢复不能猜目标、重复提交或吞人工历史。

## 停止条件

目标身份无法无歧义恢复时要求重新选择具体对象；仍可独立讨论，不用自动范围扩张或跳过stale检查。

## 聚焦验证

按[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)为本次代码变化和所选用例准备必要产物一次，再执行以下直接入口；纯逻辑/Schema测试不因此重构建。现有用例只证明其实际覆盖的行为；新增行为在实施diff中补命名测试，并同步文件及 `-t` / `--grep` 选择。执行时确认目标测试实际被选中，0匹配不算通过，不用旧用例通过代签新能力。未变化证据继续复用，仅失败指向更广范围或版本门要求才扩大验证。

```text
npx --no-install vitest run tests/unit/generationTaskController.test.ts -t "ignores an old input ACK after Stop without correcting or hiding the new task preview|retains a committed receipt after feedback storage fails twice without committing again|blocks a commit if a manual edit changes revision while the pre-apply check is pending"
```

上述现有命名用例只覆盖既有竞态和当前进程内回执失败，不证明全链deadline、preview到期或跨崩溃恢复。实现增量时补对应命名用例并更新选择；按实际影响复用混合历史/三表面证据，仅补人工打字/切页/删除/Save As与AI交替的失效范围。涉及保存恢复时分别验证已持久化终态与未落盘未知状态，至少保留未提交草稿和已提交阶段后Stop的代表路径。

## 回退与交接

交付竞态触发、身份轨迹和恢复规则给103/1.9；阶段部分完成如实保留，不能声称整个任务零写。
