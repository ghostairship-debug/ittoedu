# r18-100-task-feedback-loop：让同一CLI任务接收宿主结果观察并持续修正

- Release: 1.8
- Dependencies: `r18-090-ai-task-contract`, `r18-095-authoring-observation`, `r18-097-semantic-edit-replacement`
- Optional: 否
- Write locks: `ai-session`, `cli-adapters`, `store-kernel`, `main-preload`
- Gaps: G05, G06, G08, G09

## 结果与现状

同一用户任务能从观察开始，经CLI候选、宿主检查/验证/提交、结果回传继续修正；最终状态依据host receipt和目标证据。

2026-09-08调整节点前置与出口：共用反馈开发依赖090合同、095观察和097事务，不等待092/093/094三adapter全部完成。实际纵切必须选择任一家已通过对应真实原生基础门的CLI，不能以模拟adapter或未通过基础门的路径关闭本节点；其余adapter继续在各自Owner推进，103仍汇合三家完整同任务矩阵，不因本节点通过宣称三家反馈全部验收。

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

共享harness、repository/service、合同和请求组装由同一协调者单writer集成。协调者持共同写锁委派实际文件不重叠的adapter叶子；叶子不能复制任务Owner、预算或反馈循环，也不能同时修改共享实体文件。主力CLI路径就绪后即可纵切，其余adapter通过统一端口在103收口。

## 执行步骤

1. 实现090唯一任务状态链：观察→原生输入→候选prepare/临时验证→预览或提交→receipt/新观察→续轮；意图决定是否允许写候选。096同源能力卡/查询就绪时，与095完整观察接到同一请求Owner，不另建观察或目录状态；096尚未就绪不阻断共享反馈开发和主力纵切，完整消费在103汇合。
2. 默认编辑在授权范围自动提交；预览策略等待教师应用；讨论/计划零工程写。CLI回合结束若目标未达成显示待继续/未完成。
3. 一次格式修复带精确诊断；连续两个无目标/变更/诊断进展的候选停止；有进展多阶段任务受可见预算约束。
4. 实现input/question确认、重复/乱序幂等、断流后receipt对账、停止当前epoch；保留先前提交的阶段，未提交阶段零写。

共用Builder/正式工具的构造能力复用既有候选批量准备与唯一提交端口，不另开live API、第二History或应用内Vite/外部浏览器执行环境。一个完整页面/自洽互动单元可作为一个阶段，相关资源和引用原子提交；按当前确认稿和写范围建立基础纵切；1.9的044在同一任务Owner接入自动材料与手动分阶段规则，045提供材料读取，不复制循环。应用内从已保存空白工程生成→查看实际结果→同Agent连续修改也必须走这条构造/反馈链，不要求外部终端搬运产物。

101新UI尚未接入时，先经当前预览/手动应用入口证明真实回执续轮。只有095完整观察与101新策略入口到位后才采用既定默认auto；有限generation-snapshot仍只能preview，不能提前放开自动写入。task/epoch、提交前过期检查及Stop/关闭/Save As晚到零写在本节点就必须有效，不能延期到102。

## 验收与可信反例

- 自然语言任务能根据真实host结果继续，最终清楚区分回答、计划、已应用并验证、待应用、部分完成、失败/取消。
- 主力真实路径必须经过第一候选正式提交→真实generationCommitReceipt与新观察→同任务/原生会话接收→第二次正确修改；每次完整变化对应一个事务，撤销/重做、保存重开正确。CLI自述与私有准备回执不能替代。
- 反例：CLI自称完成但无receipt、断流前已提交、重复candidate、纯讨论被模型输出候选、无进展修复、Stop与commit竞态不能假成功或重复写。

## 停止条件

adapter无法消费后续结果时显式阻断该任务；不在宿主新增第二模型调用/规划循环，不放宽候选校验。

## 聚焦验证

按[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)为本次代码变化和所选用例准备必要产物一次，再执行以下直接入口；纯逻辑/Schema测试不因此重构建。现有用例只证明其实际覆盖的行为；新增行为在实施diff中补命名测试，并同步文件及 `-t` / `--grep` 选择。执行时确认目标测试实际被选中，0匹配不算通过，不用旧用例通过代签新能力。未变化证据继续复用，仅失败指向更广范围或版本门要求才扩大验证。

```text
npx --no-install vitest run tests/unit/diagnosticLog.test.ts tests/unit/localAgentTaskContract.test.ts tests/unit/editorTransaction.test.ts tests/integration/architectureBaselineFlows.test.tsx
```

先用一种已通过对应原生基础门的CLI证明同一任务至少一次host结果驱动的继续修改；模拟故障只补确定性竞态。记录实际CLI/model/effort、原生会话/任务与正式回执对应关系；其余CLI差异和完整有限重复门由103明确承接，不漏验也不重复计算已有效证据。

## 回退与交接

交付状态/结果事件、断流对账和预算停止规则给101/102/099；删除已迁移Chat私有调度，回退保留已确认事务历史。
