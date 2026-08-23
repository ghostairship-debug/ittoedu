# 一协调者 + 三智能体无人值守工作流

## 1. 目标

用户只决定产品边界。任务拆分、上下文准备、隔离工作区、派工、技术重试、合并、验证、回滚和阶段报告由 Coordinator 自动完成；普通测试失败、索引降级、分支冲突或单个 Legacy consumer 暂不能删除不打扰用户。

## 2. 常驻角色

### Coordinator / Stage Integrator

- 从唯一任务卡集合生成只读任务板；
- 校验 `ready` 条件、dependsOn 和热点锁；
- 每次最多派发三个互不冲突的任务；
- 管理 worktree/branch 与基线更新；
- 审查 diff、边界、consumer 和行为证据；
- 独占热点集成、generated index 和阶段验证；
- 自动重试、重派、park 或 rollback；
- 输出阶段产品化报告；
- 只有触发产品级升级时请求用户决策。

### Worker A/B/C

- 每次只执行一张任务卡；
- 读取 Required read 和必要合同，严格遵守 Allowed/Forbidden write；
- 先 characterization，再实现，再跑任务允许的目标验证；
- 不自行接入未持锁热点，不扩产品范围；
- 报告 finding、consumer delta、indexImpact 和回滚点；
- 不手工修改派生任务板或 generated index。

Worker 角色按任务动态分配，通常覆盖行为测试、纯模块实现、consumer/验证三条工作线。

## 3. 自动循环

```text
Coordinator 读取任务卡
→ 过滤 ready/dependsOn/写锁
→ 按产品风险排序
→ 创建隔离工作区并派发最多三卡
→ Worker characterization + 实现 + 目标验证
→ 独立 diff/边界复核
→ Coordinator 串行接入热点
→ 相关扩展验证
→ 更新任务卡、consumer 与指标
→ 释放写锁并派发下一批
```

领取、异常退出和 stale lock 恢复以任务协议的原子 claim/release 规则为准；Coordinator 是任务状态和热点锁的唯一写入者。

任务优先级：数据安全 > 保存/撤销正确性 > 用户可达回归 > 阶段关键路径 > Legacy 减少 > 纯整理。

## 4. 自动重试与诊断

1. 随机失败原命令重跑一次；
2. 可复现实现失败由原 Worker 在原范围修一次；
3. 第二次失败交给另一个空闲 Worker 做只读诊断；
4. 若任务事实过期，Coordinator 在最新 baseline/context 上重建卡并重派；
5. 若热点接入冲突，回退接入提交，保留纯模块，在最新基线上串行重放；
6. 同一设计连续三次失败，自动 rollback，任务进入 `parked`，继续不受影响的工作线。

禁止用弱化测试、无限 retries、第二套工程数据或长期兼容补丁制造绿色结果。

## 5. 自动报告

不逐任务要求用户确认。每个阶段结束输出：解决的用户风险、代表工程结果、保存/撤销/播放/导出状态、已解耦模块、consumer delta、性能变化、重试/回滚/parked 项和下一阶段计划。

Handoff 不再人工维护第二份状态；由任务卡的 Result Evidence、Validation、consumer delta、indexImpact 和 rollback 字段自动生成只读交接视图。

## 6. 仅产品级升级

只有以下情况把任务置为 `product-decision` 并联系用户：

- 需要修改 V9 Schema、建立 V10 或迁移真实用户数据；
- 无法同时保留两项现有教师能力；
- 需要改变用户可见工作流、导出语义或视觉结果；
- 需要付费工具、重大依赖、网络服务或新安全权限；
- 代表工程显示真实数据可能损坏；
- 性能超阈值且只能以能力缩水换取恢复；
- 工期或资源预计超过已约定预算约 50%；
- 正式发布、教师 `accepted` 等产品结论。

技术阻塞若可通过降级、重派、保留旧入口或暂停单一路线解决，不升级给用户。
