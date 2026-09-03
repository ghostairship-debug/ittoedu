# r11-060-final-legacy-zero 1.1 最终 Legacy Zero 门

- Status / Owner: queued / unassigned
- Outcome / Evidence: 在 1.1 架构与删除范围冻结后，只运行一次正式 Legacy Zero 扫描，证明最终候选与已对账 inventory 一致且 V8、旧模块、旧引用与新增未归档命中全部为零。
- Write scope: Legacy Zero 扫描输入只读；本卡、后继卡与任务板。
- Write locks: none
- Acceptance: `check:legacy-zero` 成功；summary 中 confirmed/new/unmatched/reference/schema8/legacy-module 各项均为零，并与最终 inventory identity 一致；不得额外生成候选 Hash 或报告。
- Validation: 只运行一次 `npm run check:legacy-zero`。
