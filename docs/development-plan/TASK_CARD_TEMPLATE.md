# 任务卡模板

> 只在多执行者协调、重叠写入风险、跨会话恢复、明确交接或真实阻断时建卡。单执行者、单会话工作不建卡；敏感变更本身也不自动建卡。
>
> 完成后删除卡并重新生成任务板。完成事实由实质 diff / commit 和检查结果承载，不设 done 状态。

固定六项字段：

```markdown
# <task-id> <标题>

- Status / Owner: queued | active | blocked / <active 必须填写唯一写入者>
- Outcome / Evidence: <一个可观察结果 + 当前失败或启动证据>
- Write scope: <允许写入的精确路径；需要时补禁止路径、越界停止条件或 baseline>
- Write locks: none | editor-store-history | app-save-recovery | workspace-properties | published-producer | contracts-schema | legacy-inventory | main-preload | generated-index
- Acceptance: <完成后可直接判断的结果>
- Validation: <最多 1–3 条直接证明结果的命令或人工检查；敏感变更在这里写明真实 carrier / fixture / 回退检查>
```

约定：

- `queued` 表示已经可以开始，`active` 表示有唯一 writer，`blocked` 必须在 `Outcome / Evidence` 中写明阻断原因、解除条件和下一决策者；未来占位任务不建卡。
- `Write locks` 可用逗号列多个固定标签；非共享写入写 `none`。同一标签不能同时出现在两张 active 卡上。
- 给较弱模型或跨会话交接时，必须写出当前证据、允许路径、越界停止条件、确定结果和精确检查；不增加风险等级、预算、Reviewer、Ready checklist 或 Evidence 表单。
- 文件放在 `docs/development-plan/tasks/<wave>/<task-id>.md`，task-id 使用小写稳定 ID。
- 任务板由 `npm run generate:task-board` 生成，只在任务集合实质变化时更新。
- 1.1 执行卡的字段内容规范（红→绿证据、结构事实查法、交接模板与术语表）见 [1.1 执行者指南](roadmap/1.1/EXECUTION_GUIDE.md)。
