# r18-100-task-feedback-loop：让同一CLI任务接收宿主结果观察并持续修正

- Release: 1.8
- Dependencies: `r18-090-ai-task-contract`, `r18-095-authoring-observation`, `r18-097-semantic-edit-replacement`
- Optional: 否
- Write locks: `ai-session`, `cli-adapters`, `store-kernel`, `main-preload`
- Gaps: G05, G06, G08, G09

## 结果与现状

同一用户任务从观察开始，经CLI候选、宿主检查/验证和正式结果，必要时继续修正，满足完成条件则及时终结；最终状态依据host receipt和目标证据，不为总结固定再开原生回合。

2026-09-08调整节点前置与出口：共用反馈开发依赖090合同、095观察和097事务，不等待092/093/094三adapter全部完成。实际纵切必须选择任一家已通过对应真实原生基础门的CLI，不能以模拟adapter或未通过基础门的路径关闭本节点；其余adapter继续在各自Owner推进，103仍汇合三家完整同任务矩阵，不因本节点通过宣称三家反馈全部验收。

2026-09-09核验：同任务continue、真实批次receipt、重复结果保护、20分钟deadline和无进展计数已实现。当前controller在成功或可修复拒绝后仍固定captureNext/continue，main任务主要依赖随后answer进入终态；准备失败的结构化诊断/行为证据仍会丢失。本轮沿[统一方案](../../../../AI编辑最短路径产品决策报告.md)补条件终结、完整预算与错误/回执链，不重建已存在的反馈Owner，也不把源码和局部测试外推为三CLI新能力验收。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/main/localAgent/harness.ts](../../../../src/main/localAgent/harness.ts)
- [src/main/localAgent/service.ts](../../../../src/main/localAgent/service.ts)
- [src/main/localAgent/repository.ts](../../../../src/main/localAgent/repository.ts)
- [src/shared/localAgentTaskContract.ts](../../../../src/shared/localAgentTaskContract.ts)
- [src/shared/localAgentTaskGuards.ts](../../../../src/shared/localAgentTaskGuards.ts)
- [src/renderer/authoring/generation/prepareGenerationCandidate.ts](../../../../src/renderer/authoring/generation/prepareGenerationCandidate.ts)
- [src/renderer/authoring/generation/generationTaskController.ts](../../../../src/renderer/authoring/generation/generationTaskController.ts)
- [src/renderer/authoring/tools/dynamicCandidateAdmission.ts](../../../../src/renderer/authoring/tools/dynamicCandidateAdmission.ts)
- [src/renderer/authoring/generation/admissionWorker.ts](../../../../src/renderer/authoring/generation/admissionWorker.ts)
- [src/renderer/ui/chat/CourseChatPanel.tsx](../../../../src/renderer/ui/chat/CourseChatPanel.tsx)

## 允许写域与旧路径退出

LocalAgent原生会话Owner、Generation任务/候选协调与正式桥；任务状态继续由现有Owner持有，Chat仅投影。CLI保持规划循环，宿主消费声明式状态/结果；不因增加finish再建任务状态或预算。

共享harness、repository/service、合同和请求组装由同一协调者单writer集成。协调者持共同写锁委派实际文件不重叠的adapter叶子；叶子不能复制任务Owner、预算或反馈循环，也不能同时修改共享实体文件。主力CLI路径就绪后即可纵切，其余adapter通过统一端口在103收口。

## 执行步骤

1. 接通090增量后的唯一状态链：观察→原生输入→prepare/必要验证→preview等待或正式应用→真实结果保存→finish，或有明确理由的新观察/continue。沿095/096现有请求Owner组织信息，不另建观察或目录状态；短候选展开后仍进入同一正式事务。
2. 默认auto只应用授权范围内通过检查的候选；preview未应用保持待应用。声明finish还须committed或正式unchanged回执已持久化、必要证据满足；unchanged显示无需修改且不增加revision/撤销项。main harness、AiTask、renderer和已保存历史终态一致，缺新元数据的adapter走有预算兼容路径。
3. 回执先保存在应用会话。Codex无推理注入须先验证实际版本的身份/角色/幂等/恢复语义；其他或失败路径标待送，下次真正请求前补入。无注入能力不阻断finish，不为送回执额外推理；不能伪造已进入原生历史。
4. 保留已有input/question确认、Stop/epoch与重复/乱序保护；提交成功但回执保存失败，在当前进程保留已知receipt，只重试记录，不重prepare/apply。已持久化结果可重开核对；未落盘即崩溃的未知部分先核当前工程，不自动重复相对修改或补造完成receipt。
5. 20分钟绝对deadline贯穿观察、原生执行、prepare、必要准入和提交前检查，重试/子阶段不重置；awaiting-apply/waiting-input不隐式延长。恢复时重查deadline/revision/epoch，到期候选不得直接应用；再次请求经新输入/新观察入口准备并保留已完成事实。用户等待单列统计。
6. 接回工具/worker失败的正式错误码、阶段/步骤、目标/资产、字段路径、revision、是否提交、实际已有帧/动作/状态和恢复信息，经过prepare/controller/HostResult进入下一原生输入；未取得证据明确为空。保留一次明确诊断的格式修复；首个失败建立基线，随后连续两次无实质进展停止，不靠candidateId、summary或注释变化重置。
7. 沿既有事件记录请求、原生turn、候选、准入、commit、receipt和终态阶段；准确usage来源由090/adapter贯通，unknown不填零。区分宿主continuation、原生turn与未知内部模型请求；首次正确结果和全任务终结分别计时，不把并行时长相加。

共用Builder/正式工具的构造能力复用既有候选批量准备与唯一提交端口，不另开live API、第二History或应用内Vite/外部浏览器执行环境。一个完整页面/自洽互动单元可作为一个阶段，相关资源和引用原子提交；按当前确认稿和写范围建立基础纵切；1.9的044在同一任务Owner接入自动材料与手动分阶段规则，045提供材料读取，不复制循环。应用内从已保存空白工程生成→查看实际结果→同Agent连续修改也必须走这条构造/反馈链，不要求外部终端搬运产物。

095完整观察与101策略入口已有接线，沿现有auto/preview能力做增量；历史有限generation-snapshot仍只能preview。主力纵切同时证明可及时finish和确需下一阶段时的真实回执续行；task/epoch、提交前freshness/deadline及Stop/关闭/Save As晚到零写由本节点闭合，不延期到102。

## 验收与可信反例

- 主力真实路径并列证明：完整候选满足finish后不为总结追加turn；确需后续阶段时第一正式提交→真实receipt/新观察→同任务原生会话接收→第二次正确修改。保留既有多阶段门，不要求所有任务制造第二次修改。
- 正式unchanged可完成但无新revision/撤销项；preview等待、应用、到期和纠正状态准确。main/renderer/AiTask及已持久结果重开一致，不把CLI completed、模型summary或私有prepare回执当工程完成。
- 每次完整变化对应一个事务，撤销/重做、必要保存重开正确；已提交后回执失败只重试记录，未落盘崩溃后未知状态不replay；无推理注入或待送准确。
- 反例覆盖准备/preview等待期间到期、重复candidate/receipt、纯讨论候选、结构化失败证据丢失、首失败后两次无进展、Stop与commit/迟到ACK竞态；当前未提交阶段零写，已完成阶段保留。
- 动态smoke只证明实际覆盖的挂载/更新/暂停恢复/捕获；requires-review不能变成评分、重试或教学目标通过。简单准确修改与整页/批量/互动修改分别取得对应证据。

## 停止条件

确需继续的任务若adapter无法消费下一输入，显式报告未完成；仅缺无推理注入时标待送回执，不阻断已满足条件的finish。不在宿主新增第二模型调用/规划循环，不放宽候选校验。

## 聚焦验证

按[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)为本次代码变化和所选用例准备必要产物一次，再执行以下直接入口；纯逻辑/Schema测试不因此重构建。现有用例只证明其实际覆盖的行为；新增行为在实施diff中补命名测试，并同步文件及 `-t` / `--grep` 选择。执行时确认目标测试实际被选中，0匹配不算通过，不用旧用例通过代签新能力。未变化证据继续复用，仅失败指向更广范围或版本门要求才扩大验证。

```text
npx --no-install vitest run tests/unit/localAgentHarnessV2.test.ts tests/unit/generationTaskController.test.ts -t "stops repeated rejected destinations even when candidate IDs change|continues with the real recorded receipt and a fresh request while keeping task, native identity and history|retains a committed receipt after feedback storage fails twice without committing again"
```

上述三条现有用例证明既有无进展、deadline续行保留和本轮回执重试行为；2026-09-09只读核验已通过，相关实现未变时复用。它们不证明新finish、全链deadline或跨崩溃恢复。实现增量时补对应命名用例并更新选择，再用主力真实CLI分别验证finish和必要续行；模拟故障只补确定性竞态。记录实际配置、原生会话/任务/receipt、首次正确结果与终结时间，其余CLI差异和完整有限重复门由103汇合，不重复有效付费证据。

## 回退与交接

交付状态/结果事件、断流对账和预算停止规则给101/102/099；删除已迁移Chat私有调度，回退保留已确认事务历史。
