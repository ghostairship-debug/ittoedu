# 协调任务卡

只在多人/多 Agent 写入协调、跨会话交接或真实阻断时使用。单会话小改不建卡；不为历史未签目标长期保留协调卡。

```markdown
# task-id 任务标题

- Status / Owner: queued / 待接手
- Outcome / Evidence: 一个可观察结果、当前事实及唯一证据入口
- Write scope: 本批实际路径/职责；共享实体的唯一集成人
- Write locks: none
- Acceptance: 受影响目标与必须保留的行为
- Validation: 足以验证这些行为的直接检查及可复用证据
```

`queued` 是当前待接手，`active` 是确有唯一 writer，`blocked` 要说明阻断与最小下一步。列入任务板本身不增加授权。按实际风险选检查，不限制为固定条数。

共享写域从 [现有生成器的 writeLockTags](../../scripts/generate-task-board.ts) 选择，精确路径写在 Write scope；不再维护第二张易过期的锁/源码映射表。`none` 不能与其他标签混用，同一标签不能同时归属两个 active 任务。独立叶子可并行，共享实体顺序集成。

卡放在 `tasks/<批次>/<task-id>.md`。集合实质变化后运行 `npm run generate:task-board`；不手改任务板。完成后在既有结果位置保留事实并移除卡；历史剩余目标交给当前计划/历史证据承接，不冒充已完成，也不继续占锁。
