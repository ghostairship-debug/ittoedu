# 任务风险、状态真相与可派发协议

> Policy version: 2

## 1. 风险等级

### S0 局部小修

极少文件、无公共 API、无 persisted/async/history 影响。使用 S0 简卡，但仍记录目标、Allowed write、目标验证、semantic/generated index 影响和结果状态。S0 默认 Reviewer budget 为 0；行为边界不清楚时升级为 S1，不用增加流程补偿模糊范围。

### S1 普通跨文件任务

公共入口、纯 model/command、Feature 内部拆分、少量 consumer 迁移。使用 S1 模板。

### S2 高风险迁移

Store/History/Session、保存/恢复、合同、Published producer、Player 会话/运行边界、共享导出编排或语义、Workspace/Properties 热点接入、Legacy 删除，或任何多智能体热点接入。使用 S2 模板，并由 Coordinator 集成。只修改单一格式 adapter，且不改 Published producer、共享语义、公共 API、持久化或多热点的局部 Export 修复可以是 S1。

风险等级描述变更风险；Task class 描述任务所处的执行层级，两者不得互相代替。Task class 只允许 `docs`、`implementation`、`integration`、`wave-gate`、`phase-gate`、`final-candidate`。

## 2. Policy v2 必填字段

每张未完成任务卡必须以独立单行记录以下字段，不能藏在自由文本或合并字段中：

```text
Policy version: 2
Risk tier: S0|S1|S2
Task class: docs|implementation|integration|wave-gate|phase-gate|final-candidate
Necessity / skip condition:
Complexity delta: subtractive|neutral|additive-exception
Validation ceiling: V0|V1|V2|V3|V4
Validation budget: N minutes
Reviewer budget: 0|1|2
Evidence reuse:
Invalidating paths:
```

选择 `Complexity delta: additive-exception` 时，还必须紧随其后增加独立单行 `Additive exception:`，写明首个真实 consumer、明确替代目标及退出条件；neutral/subtractive 卡不出现该字段。`additive-exception` 只允许解决已复现行为、服务同卡首个真实 consumer，或以可验证的新路径替换指定旧路径；“未来可能复用”、阶段标题和目录整齐都不是例外理由。不能证明必要性时执行 skip condition，而不是创建占位接口、Port、Service、adapter 或通用编辑器。

## 3. 任务卡是状态真相

任务状态只写在任务卡；任务板由任务卡生成，只读展示，不手工维护第二份状态。

任务卡固定存放在 `docs/development-plan/tasks/<phase>/<task-id>.md`，文件名使用小写稳定 ID；`docs/development-plan/TASK_BOARD.md` 由任务卡生成，不可手改。任务目录和任务板由 ARCH-0A 首批卡建立，不纳入静态计划 Manifest。

正常状态：

```text
draft → ready → claimed → characterizing → implementing
→ target-green → reviewed → integrating → wave-validated → done
```

异常状态：

- `retrying`：自动修复中；
- `parked`：不阻断其他路线，保留证据等待后续；
- `rolled-back`：接入已撤回；
- `product-decision`：仅产品级升级。

Worker 报告 `target-green`，Reviewer 报告复核结果；Coordinator 记录这些执行期瞬态，并且只有 Coordinator 可进入 `integrating`、`wave-validated`、`done`、`rolled-back` 或 `product-decision`。

## 4. Ready / 可派发条件

任务必须同时满足：

- baseline HEAD 与 context freshness 已记录；
- 所有 `dependsOn` 已 `done` 或允许的 `wave-validated`；
- current fact 有源码/合同/测试证据；
- Goal 是一个可观察用户/工程行为；
- Necessity 是已复现用户风险、当前真实 consumer/替代目标或可量化复杂度下降；skip condition 可执行；
- Complexity delta 有证据，`additive-exception` 已写首个 consumer、替代目标和退出条件；
- Allowed write 与 Forbidden write 明确且路径存在；S1/S2 另记完成正确性所必需的 Required read；
- 实际命中热点的任务已记录锁且 Owner 唯一；S0 定义上不得命中热点，不为“无热点”增加锁仪式；
- change/retry budget，以及 Validation ceiling/budget、Reviewer budget 已填；
- Evidence reuse 已定义执行后如何绑定和复用证据，Invalidating paths 使用能解释当前证据失效的最窄文件/配置路径；implementation 卡不得用 `src/**`、`tests/**`、全仓或其他 broad glob 把所有证据一并失效，确需广域失效域时升级 class 并写明理由；Ready 时不得伪造尚未存在的 product commit；
- 1–3 个目标测试或最小人工流程已命名；
- rollback 起点和旧路径状态明确；
- 没有相关用户 dirty changes；
- 未触发产品级升级条件。

任一项缺失，状态保持 `draft`，Coordinator 自动补证据或拆卡，不把模糊 Epic 直接派给 Worker。

## 5. 任务大小与阶段准入

默认一个用户行为、一个热点 Owner、一个主要实现提交、1–3 个目标测试。1–8 个主要源码文件只是提示，不机械拆分；原子行为需要更多文件时必须减少其他目标，并提高预算和验证等级。

阶段文档是候选问题域和边界合同，不是必须施工的 Epic 清单。进入阶段时 Coordinator 先按当前索引/Bootstrap、consumer、可复现行为和复杂度证据筛选，再生成 0–N 张 S0/S1/S2 实现卡。没有合格目标时，允许用只读盘点和适用门禁证明“无需实现”后以零张实现卡结束阶段；不得为了阶段名称补齐 selector、command、Port、Service、adapter 或目录矩阵。

## 6. Reviewer 与验证证据复用

- S0 implementation 的 Reviewer budget 为 0，不为独立性增设 Reviewer；S1/S2 默认 1 个。Reviewer budget 为 2 时，任务卡必须写明两个互不重叠的风险面。
- Reviewer 以 diff、反例、边界和证据完整性为主，不重复 Worker/Coordinator 已在同一 product commit 跑过的套件。只有证据失效、命令本身可疑或需要复现 finding 时才重跑，并记录原因。
- Ready 时的 Evidence reuse 只定义复用与失效规则；执行后才在 Result evidence 绑定实际 change commit（改产品代码时即 product commit）、命令、结果和适用环境。后续提交未命中 Invalidating paths 时复用原证据；只改任务卡、报告、任务板或 generated 默认不使产品验证失效。
- 命中某个 Invalidating path 只使相关证据失效，不自动要求重跑更高等级或全仓套件。
- 不为证据复用建设审批状态机、证据数据库或新 Dashboard；任务卡和阶段报告记录可追溯引用即可。

## 7. 自动领取与释放

Coordinator 最多同时 claim 三张写入范围不重叠的卡。Worker 完成目标验证后释放非热点工作区；热点只有在 Coordinator 完成集成与相关验证后释放。

只有 Coordinator 可以写任务状态。领取必须在派工前用一个独立 claim 提交原子写入 `owner / claimedAt / baselineCommit / worktree / hotspotLocks / retryCount`；该提交由 Git 历史唯一标识，任务卡不记录自己的 claim SHA，也不得为回填 SHA 再制造提交。`characterizing`、`implementing`、`target-green`、`reviewed`、`integrating` 可作为执行期瞬态记录，不为每次跳转创建 Git 提交；只有 claim 和 `wave-validated` / `done` / `parked` / `rolled-back` / `product-decision` 终态或持久检查点必须持久提交。Worker 不直接改状态或任务板。

Agent 异常退出时，Coordinator 检查对应 worktree、最后提交和 Execution Log：没有新提交且可立即重派时，用下一个原子 claim commit 直接替换过期 Owner 并增加 retry，不先制造 `ready` 状态提交；暂不重派则持久为 `parked` 并释放锁。已有未集成提交则保留隔离分支，在新 claim 中交给诊断 Worker，或终态化为 `parked`。不得删除用户差异或用过期锁永久阻塞队列。

新 finding 仅在阻断当前正确性时进入原卡；其他问题创建 `draft` 卡并给出证据、影响、建议阶段和不在当前卡修复的理由。

## 8. 阶段与波次预算

只有某个阶段/波次实际通过必要性准入并准备创建任务卡或 gate 时，Coordinator 才按已准入范围登记时间盒、最多任务卡、最多 S2 卡、热点、验证和重试预算；长期路线不预填未来施工配额。未登记的未来候选域保持未启动，不因缺预算阻塞其他独立阶段，也不得反向把历史预算当成施工授权。

默认上限：

- 同时 active 卡不超过 3；
- 一个波次不超过 12 张实现卡，其中 S2 不超过 4 张；
- 一个波次时间盒不超过 10 个 Coordinator 工作日；
- 一个波次最多统一生成并提交一次 generated 索引；中途上下文 stale 时使用 Bootstrap，不以逐卡 generated 提交修复；
- 同一任务最多原 Worker 修复 1 次、独立诊断 1 次、整体设计尝试 3 次；
- 到达预算先自动停止纯整理、重排关键路径并生成阶段报告；只有预计总预算超出已登记值 50% 以上才升级产品 Owner。

## 9. 停手规则

- 需要修改未授权 Schema/合同；
- carrier 与合同不一致；
- 需要新增 raw Store consumer；
- 需要第二个未授权热点锁；
- current fact 与卡明显不符；
- 用户数据或未提交修改可能被覆盖；
- 目标行为只能通过双写或能力缩水实现。

Worker 遇到停手条件立即提交 finding；Coordinator 自动重拆、park 或升级，不允许 Worker自行扩大范围。
