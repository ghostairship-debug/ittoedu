# Done、自动回滚与证据交接

## 1. 通用 Done

- Goal 的可观察行为完成；
- 非目标未实现；
- canonical contract/carrier 正确；
- 文件范围、热点锁和预算无越界；
- V1 目标验证与所需 V2 接入验证通过；
- diff 无用户/生成物夹带；
- public API 窄且有真实消费者；
- consumer/index impact 已记录；
- 主要实现与热点接入可独立回滚；
- Coordinator 已把任务卡置为 `done`。

## 2. S2 Done

额外要求：current/replacement write path、stable target/stale behavior、runtime/export/build/release consumers、迁移期间无双写、consumer delta、save/reopen/undo/preview/export 适用流程和 deletion gate 均有证据。

## 3. 不算完成

- Facade 只 re-export 整个 Store；
- 新模块仍 deep import 上帝文件私有实现；
- 只移动代码未降低 owner 混乱；
- 测试只断言文件存在；
- 为通过测试复制第二套数据；
- 删除文件但 fixture/release/Recovery 仍依赖；
- 自动化通过就宣称 outcome/accepted。

## 4. 回滚分层

- pure model/public seam、tests、hotspot integration、generated 更新尽量分提交；
- 接入失败优先只回退 integration commit，保留已验证纯模块；
- Schema/依赖若经产品批准必须独立提交；
- 删除每一批有独立 rollback commit；
- 回退后旧路径仍能工作；
- 禁止回滚用户未提交修改和其他任务提交；
- 真实用户工程只在副本验证，代码回滚不被当成数据恢复。

## 5. Handoff 是证据，不是状态真相

任务状态只在任务卡。Handoff 仅记录：task/baseline、goal result、files/symbols、before/after、validation、consumer delta、remaining risk、indexImpact、commits/rollback 和 next allowed task；不得在 handoff 再维护另一套阶段状态。

## 6. 阶段交接

Coordinator 输出 pipeline/engineering/outcome、代表工程、consumer count、hotspot owners、性能比较、index freshness、parked/product-decision 项和下一阶段门禁。
