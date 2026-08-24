# Done、自动回滚与证据交接

## 1. 通用 Done

- Goal 的可观察行为完成；
- 非目标未实现；
- 受影响的 canonical contract/carrier 正确；
- 文件范围、实际命中的热点锁和预算无越界；
- 按 Task class 通过对应 ceiling 内的最小充分验证：`docs` 为 V0、`implementation` 为 V1、`integration` / `wave-gate` 为 V2、`phase-gate` 为 V3、`final-candidate` 为 V4；不把低高等级累加成重复清单；
- diff 无用户/生成物夹带；
- 若新增 public API，它保持窄且在同卡有真实消费者；
- 适用的 consumer/index impact 已记录；
- 实际存在的独立热点接入可以与纯实现分层回滚；局部任务不为分层而强行拆提交；
- Result evidence 已绑定实际 change commit（改产品代码时即 product commit）、命令、结果和环境；
- Coordinator 已把任务卡置为 `done`。

## 2. S2 Done

额外要求：只对本卡实际影响的 current/replacement write path、stable target/stale behavior、consumer 类别与 save/reopen/undo/preview/export 流程留证；迁移期间不得双写。只有实际选择删除的 deletion-candidate 需要 deletion gate；retained Legacy 只记保留理由、Owner 和重访触发条件。

## 3. 不算完成

- Facade 只 re-export 整个 Store；
- 新模块仍 deep import 上帝文件私有实现；
- 只移动代码未降低 owner 混乱；
- 测试只断言文件存在；
- 为通过测试复制第二套数据；
- 删除文件但 fixture/release/Recovery 仍依赖；
- 自动化通过就宣称 outcome/accepted。

## 4. 回滚分层

- 只有存在真实独立回滚边界时，才拆分纯实现与 hotspot integration；S0/局部 S1 默认一个 product commit；
- 接入失败优先只回退 integration commit，保留已验证纯模块；
- Schema/依赖若经产品批准必须独立提交；
- 删除只按真实 owner/回滚边界分批，每批有一个可回滚提交，不按 symbol 拆提交；
- generated 索引在 wave-gate 最多统一提交一次，不成为每卡回滚层；
- 回退后旧路径仍能工作；
- 禁止回滚用户未提交修改和其他任务提交；
- 真实用户工程只在副本验证，代码回滚不被当成数据恢复。

## 5. Handoff 是证据，不是状态真相

任务状态只在任务卡。Handoff 仅记录：task/baseline、goal result、files/symbols、before/after、validation、consumer delta、remaining risk、Semantic index impact、Generated refresh、commits/rollback 和 next allowed task；不得在 handoff 再维护另一套阶段状态。

## 6. 阶段交接

Coordinator 输出 pipeline/engineering/outcome、适用的代表工程、consumer count、hotspot owners、被本阶段使失效后的性能比较或未失效证据引用、index freshness、parked/product-decision 项和下一阶段门禁。
