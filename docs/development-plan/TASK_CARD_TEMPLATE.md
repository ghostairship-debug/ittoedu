# 任务卡模板（精简生产模式）

> 只有满足建卡条件（S2 / 并发协调 / 热点写入 / 跨会话 / 交接）才创建任务卡；普通 S0/S1 不建卡。只为前置已满足的 Ready 工作建卡，未来依赖任务不预建。状态与字段的执行真相在 `scripts/generate-task-board.ts`，本文是其人类可读镜像，两边必须同步修改。
>
> 完成后删除卡文件（随实质提交或波次收口提交），完成事实由 product commit 承载；不设 done 状态、不做关闭提交。

最多 7 项字段：

```markdown
# <task-id> <标题>

- Status / Owner: queued | active | blocked / <唯一写入者；queued 可为空；blocked 须在 Outcome 写原因、解除条件与下一决策者>
- Risk / Hotspot: S1 | S2 / none | editor-store-history | app-save-recovery | workspace-properties | published-producer | contracts-schema | main-preload | generated-index
- Outcome / Why now: <要改变的一个用户行为 + 当前证据（源码/复现/评估引用）>
- Write scope / Baseline: <必填：允许写入的精确范围；S2 或跨会话任务记录 baseline commit>
- Acceptance: <可判断的完成条件>
- Focused validation: <1–3 条命令或最小人工检查>
- S2 safety / rollback: <仅 S2 必填：失败路径、回滚起点、副本/fixture 要求>
```

约定：

- `Hotspot` 从固定枚举中选（可多个，逗号分隔，非热点写 `none`）；生成器校验同一热点标签不得出现在两张 `active` 卡上——这是并发护栏，不是仪式。
- `active` 必须有 Owner；owner 是并发事实，不需要领取提交。
- 未满足前置时不要创建 queued 卡；执行中才出现阻断时改为 `blocked`，并在 Outcome 写明原因、解除条件和下一决策者。
- 为较弱执行模型或跨会话交接建卡时，不新增字段：在 `Outcome` 写当前可复现证据，在 `Write scope` 同时写允许路径、禁止路径和越界停止条件，在 `Acceptance` 写确定结果，在 `Focused validation` 只列 1–3 条直接证明结果的检查。阶段名称、未来设想和“顺便重构”不是任务范围。
- 同一生成器与输入已经由写入命令或 focused test 完成生成和字节/语义比较时，不再紧接同义 `--check`；Reviewer 默认审 diff、反例和证据缺口，不机械复跑作者命令。
- 文件放在 `docs/development-plan/tasks/<wave>/<task-id>.md`，task-id 用小写稳定 ID。
- 任务板由 `npm run generate:task-board` 从卡生成（当前活跃任务摘要），只在任务集合实质变化时更新。
