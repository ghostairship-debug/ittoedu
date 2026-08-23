# 任务风险、状态真相与可派发协议

## 1. 风险等级

### S0 局部小修

极少文件、无公共 API、无 persisted/async/history 影响。可用简卡，但仍记录目标、Allowed write、目标验证、indexImpact 和结果状态。

### S1 普通跨文件任务

公共入口、纯 model/command、Feature 内部拆分、少量 consumer 迁移。使用 S1 模板。

### S2 高风险迁移

Store/History/Session、保存/恢复、合同、Published producer、Player/Export、Workspace/Properties、Legacy 删除或任何多智能体热点接入。使用 S2 模板，并由 Coordinator 集成。

## 2. 任务卡是状态真相

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

Worker 可推进到 `target-green`；Reviewer/Coordinator 推进 `reviewed`；只有 Coordinator 可进入 `integrating`、`wave-validated`、`done`、`rolled-back` 或 `product-decision`。

## 3. Ready / 可派发条件

任务必须同时满足：

- baseline HEAD 与 context freshness 已记录；
- 所有 `dependsOn` 已 `done` 或允许的 `wave-validated`；
- current fact 有源码/合同/测试证据；
- Goal 是一个可观察用户/工程行为；
- Allowed write、Required read、Forbidden write 明确且路径存在；
- Hotspot locks 空闲且 Owner 唯一；
- change/validation/retry budget 已填；
- 1–3 个目标测试或最小人工流程已命名；
- rollback 起点和旧路径状态明确；
- 没有相关用户 dirty changes；
- 未触发产品级升级条件。

任一项缺失，状态保持 `draft`，Coordinator 自动补证据或拆卡，不把模糊 Epic 直接派给 Worker。

## 4. 任务大小

默认一个用户行为、一个热点 Owner、一个主要实现提交、1–3 个目标测试。1–8 个主要源码文件只是提示，不机械拆分；原子行为需要更多文件时必须减少其他目标，并提高预算和验证等级。

阶段文档是 Epic 合同，不是任务卡。进入阶段时由 Coordinator 根据当前索引/Bootstrap、consumer 和热点状态生成 1–N 张 S1/S2 卡。

## 5. 自动领取与释放

Coordinator 最多同时 claim 三张写入范围不重叠的卡。Worker 完成目标验证后释放非热点工作区；热点只有在 Coordinator 完成集成与相关验证后释放。

只有 Coordinator 可以写任务状态。领取必须在派工前用一个独立 claim 提交原子写入 `owner / claimedAt / baselineCommit / worktree / hotspotLocks / retryCount`；派工完成、park、rollback 或 product-decision 时用一个状态提交释放锁。Worker 不直接改状态或任务板。

Agent 异常退出时，Coordinator 检查对应 worktree、最后提交和 Execution Log：没有新提交则把卡恢复为 `ready` 并增加 retry；已有未集成提交则保留隔离分支、清除运行锁并交给诊断 Worker。不得删除用户差异或用过期锁永久阻塞队列。

新 finding 仅在阻断当前正确性时进入原卡；其他问题创建 `draft` 卡并给出证据、影响、建议阶段和不在当前卡修复的理由。

## 6. 阶段与波次预算

ARCH-0A 必须为每个阶段记录：时间盒、最多任务卡、最多 S2 卡、允许占用的热点、阶段验证预算和自动重试预算。未填写时阶段不可进入 `ready`。

默认上限：

- 同时 active 卡不超过 3；
- 一个波次不超过 12 张实现卡，其中 S2 不超过 4 张；
- 一个波次时间盒不超过 10 个 Coordinator 工作日；
- 同一任务最多原 Worker 修复 1 次、独立诊断 1 次、整体设计尝试 3 次；
- 到达预算先自动停止纯整理、重排关键路径并生成阶段报告；只有预计总预算超出已登记值 50% 以上才升级产品 Owner。

## 7. 停手规则

- 需要修改未授权 Schema/合同；
- carrier 与合同不一致；
- 需要新增 raw Store consumer；
- 需要第二个未授权热点锁；
- current fact 与卡明显不符；
- 用户数据或未提交修改可能被覆盖；
- 目标行为只能通过双写或能力缩水实现。

Worker 遇到停手条件立即提交 finding；Coordinator 自动重拆、park 或升级，不允许 Worker自行扩大范围。
