# 最小充分验证策略

正确性优先，但验证按风险集中，避免每个 Worker 重复完整发布流程。

## V0：任务卫生

每张卡：工作树/未跟踪文件、diff check、范围与预算、用户/generated 差异夹带检查。

## V1：Worker 目标验证

每张卡只运行：

- 1–3 个最相关单元/静态/interaction 测试；
- 必要的 schema/fixture test；
- 一个任务特定最小人工行为；
- characterization 中记录的已知失败对照。

Worker 不运行无关全量 test/e2e/desktop/verify。

## V2：Coordinator 接入验证

每个 integration commit 按影响运行：

- 受影响 TypeScript 项目的 typecheck；
- 相关 unit + integration；
- UI/IPC/save/export 变化的一条 desktop smoke；
- 对应代表工程流程；
- contracts/ai-capabilities/index check（仅在有影响时）。

S2 不能累积到阶段末才首次做相关类型或集成验证。

## V3：阶段一次完整阶段验证

每个修改产品代码的 ARCH 阶段收口只运行一次风险完整的阶段验证：覆盖本阶段全部变更的类型/单元/集成、相关 E2E、三份代表工程、适用导出、性能对比和索引/consumer 检查。这里的“完整”是完整覆盖本阶段风险，不是每阶段重复全仓发布套件；不要重复已由同一序列覆盖的构建。

ARCH-0A/0B 若只修改治理、文档、索引生成器或查询工具，只运行链接、路径、确定性、黄金任务、相关 typecheck/unit 和生成/check；不运行三份产品代表工程、产品 E2E 或桌面打包。只有阶段实际改动产品代码时，才加入相应代表工程和相关 E2E。

## V4：最终候选一次完整验证

ARCH-5 显式运行合同、能力、索引、typecheck、unit/integration/e2e 和 desktop build；必要时增加 release、Windows portability 和 component catalog。完整流程只在最终候选或 Coordinator 判断发生跨系统高风险变化时运行，不在日常循环重复。

## 5. Characterization

迁移前锁定成功行为、已知失败、async/stale、history 次数、save/reopen、preview/export、keyboard/focus/IME/DnD/gesture。测试描述用户/协议行为，不只断言文件和内部实现。

## 6. 性能

ARCH-0A 固定环境、fixture、样本和 median/P95 口径。ARCH-1/3/5 比较打开、编辑/拖拽、undo、history 内存、保存重开、preview mount/destroy 和适用导出。超过约定阈值时先定位；只有需要能力缩水才能恢复时才升级用户。

## 7. Flaky 与失败归因

- 原命令重跑一次；
- 可复现则由当前任务修；
- 随机则隔离并建卡，不提高 retry 或弱化断言；
- baseline 已红必须与当前 diff 比较；
- 不在产品卡顺手重写测试框架。

## 8. 结果分层

自动化绿是 pipeline pass；迁移边界与 consumer 证据满足是 engineering pass；代表工程真实可用是 outcome pass；教师明确确认才是 accepted。
