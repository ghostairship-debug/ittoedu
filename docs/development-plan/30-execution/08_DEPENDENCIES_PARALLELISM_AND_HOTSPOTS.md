# 依赖 DAG、三 Worker 并行与热点排他

## 1. 真依赖

- ARCH-0A 与 ARCH-0B 并行；
- ARCH-1 依赖二者最小门禁；
- ARCH-2 依赖 ARCH-1 完整纵切；
- ARCH-3 的具体行为只依赖它实际消费的 Feature 边界稳定；不存在该 consumer 时不预建公共入口；
- ARCH-4 的只读 inventory 可提前，具体产品迁移只依赖该目标所需的明确 V9/read model 入口；
- ARCH-5 的明确删除目标依赖精确 consumer=0 和替代路径稳定；保留项和 final-candidate 不以全部 Legacy 归零为前置。

阶段不是为了禁止所有并行；只阻止尚未证明的架构被扩散。

## 2. 常驻角色

```text
Coordinator / Integrator
Worker A
Worker B
Worker C
```

Coordinator 维护任务卡状态、dependsOn、热点锁、合并、回滚、阶段验证和报告。三个 Worker 动态领取依赖已完成且写入范围不重叠的最高优先任务。

优先级：数据安全 > 保存/撤销正确性 > 用户可达回归 > 当前阶段关键路径 > Legacy 减少 > 纯整理。

## 3. 热点排他锁

以下锁同一时间只有一个写入者：

- Editor Store / History；
- App lifecycle / save / recovery；
- Workspace / Properties；
- Published producer；
- contracts / Schema；
- main / preload；
- generated repo-index。

Worker 可以读取热点和合同。非 owner 禁止写入；不能以“禁止读取合同”代替边界保护。

## 4. 可并行工作

- 不同 Feature 的纯 model/command；
- 已通过必要性准入且边界互不冲突的 Surface 内部行为；
- format adapter 在 Published producer 只读时；
- characterization、fixtures、consumer inventory、unit tests；
- repo-index generator 与盲测。

## 5. 自动派工条件

任务只有同时满足才进入 `ready`：必要性与 skip condition 已证实；真实 dependsOn 已 `done`/`wave-validated`；baseline/context 新鲜；Allowed write 明确；写锁空闲；目标行为和 1–3 个测试已命名；预算和回滚已填；没有相关用户 dirty change；产品升级条件未触发。阶段标题、目录顺序或尚未消费的通用 seam 不得作为人为 dependsOn。

## 6. 隔离与集成

S1 建议、S2 必须使用隔离 worktree/branch。每个工作区只承载一张任务卡。接入顺序由已准入行为、真实依赖和回滚边界决定；pure model 或 public seam 只有在同卡首个 consumer 需要时才出现，不作为所有迁移的固定前置。热点集成保持单写者，旧 consumer reduction / deletion 只在对应目标已获准入时执行。

热点接入失败时回退接入提交，保留已验证的纯模块；在最新基线上串行重放，不在热点中堆兼容补丁。

## 7. 自动任务板

任务卡自身是状态真相；任务板是从任务卡生成的只读视图，不手工维护第二份状态。当前状态只从任务板读取。generated index 由 Coordinator 在波次收口时最多统一重建并提交一次，Worker 分别报告 semantic 是否需维护与 generated 是否延后刷新；单卡中途不以索引刷新制造伪依赖。
