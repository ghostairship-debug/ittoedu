# S1 Task Card — ARCH-5 Deletion Admission

> 本卡只判断两个已登记候选是否真的可删；不把 ARCH-5 变成 Legacy 总清零。

## State and assignment

- Policy version: 2
- Risk tier: S1
- Task class: docs
- Necessity / skip condition: ARCH-4 gate 已完成；只有精确目标在静态、动态、测试/工具、IPC/恢复、构建/发布、兼容合同、生成知识与替代行为八类审计中均无删除阻断，且替代路径已稳定至少一个完整波次，才生成 cleanup 实现卡。不能证明净收益或安全边界时 retained/skip 并直接进入 final-candidate。
- Complexity delta: neutral
- Validation ceiling: V0
- Validation budget: 25 minutes
- Reviewer budget: 1
- Evidence reuse: `ARCH_3_PHASE_GATE_REPORT.md` 与 `ARCH_4_PHASE_GATE_REPORT.md` 只提供候选起点；准入结论重新绑定产品 HEAD `2834f26` 的源码、配置、测试、Git 历史与打包清单。只改本卡、准入报告、后续卡或生成任务板不使只读 consumer 证据失效。
- Invalidating paths: `src/renderer/project/createFlowCourseProject.ts`; `src/renderer/project/validateProjectArchive.ts`; `src/renderer/course/courseLocationCommands.ts`; `tests/unit/courseLocationCommands.test.ts`; all source barrels/import maps; `src/main/**`; `src/preload/**`; `scripts/**`; `tests/**`; `examples/**`; `package.json`; lockfile/build/release/package configs; `docs/contracts/**`; legacy inventory/semantic/golden inputs and repo-index generator/config
- Task ID: `arch-5-00-deletion-admission`
- Phase / wave: `ARCH-5 / deletion necessity admission`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Coordinator + two deletion auditors / independent deletion-admission reviewer / Coordinator`
- Claimed at / released at: `2026-08-24T20:08:58+08:00 / pending`
- Worktree / branch: `shared root, read-only product audit / codex/architecture-stabilization`
- Baseline HEAD: `2834f26`
- Context: ARCH-4 is closed and the repo-index was refreshed at its closure; exact candidate sources are re-read directly because this new task card is not itself a product input.
- Freshness / relevant dirty inputs: clean product tree at claim; this task card and generated task board are the only planned writes
- Depends on: `arch-4-gate-00-delivery-closure` done
- Blocks: any ARCH-5 cleanup implementation and final-candidate/V4
- Retry count / last failure class: `0 / none`

## Product outcome

ARCH-5 deletes only demonstrably unused compatibility code whose current behavior already has a stable replacement, without removing a public/packaged/Recovery path or inventing a new adapter to justify deletion.

## Candidates and questions

1. `validateProjectArchiveBytes`: is the exported byte-level V8-named validator referenced statically, dynamically, from CLI/release/package output or as a public compatibility API, and does deleting it leave all V9 validation/report behavior owned by current paths?
2. `appendBlankFlowPage`: after production consumers reached zero, is its remaining test characterization the only incoming reference, and can that test be rewritten around the supported `addCourseFlowPage` behavior without losing a necessary guard?
3. For each target, does deletion reduce implementation/export/test maintenance with a direct rollback, or merely erase useful compatibility evidence?

## Eight-category deletion gate

For each exact symbol/path, record:

1. static imports, calls, re-exports and type references;
2. dynamic imports, string/property lookup, reflection and generated invocation;
3. tests, fixtures, examples, scripts, package scripts and config;
4. Electron IPC/preload, Recovery/cache/session and async entry points;
5. build, release, packaging, copied bundles and committed artifacts;
6. public API, contract, compatibility owner and downstream ownership;
7. semantic inventory, golden tasks and generated repo-index impact;
8. replacement behavior, stability duration, focused verification and rollback boundary.

## Scope and locks

### Allowed write

- new `docs/development-plan/baselines/ARCH_5_DELETION_ADMISSION_REPORT.md`
- this card, any admitted ARCH-5 cleanup card, and generated `docs/development-plan/TASK_BOARD.md`

### Required read

- both exact definitions and every repository reference category above
- ARCH-3/4 candidate evidence, relevant Git history and current package/release configuration
- supported replacement implementations and their focused tests

### Forbidden write

- all product source/tests/config/contracts/fixtures/dependencies, completed cards, inventories, semantic/golden facts and generated repo-index

## Decision rules

- Admit only a deletion whose precise production/public/dynamic/release consumers are zero and whose replacement is already shipped and behaviorally covered.
- A test-only import may be removed or rewritten only when it characterizes an obsolete deficiency and the supported replacement retains a direct positive assertion.
- Do not delete shared report types/helpers merely because one wrapper is unused.
- Do not add deprecation layers, facades or alternate validators to make a deletion possible.
- If either candidate fails one category, record retained owner/re-entry condition and create no cleanup work for it.

## Validation

- Exact repository reference classification plus read-only Git/package/release inspection; no product test/build/E2E.
- One independent admission review of both eight-category matrices and any generated cleanup card.
- `npm run generate:task-board`, `npm run check:task-board`, and `git diff --check`.

## Rollback

- Start point: `2834f26` plus this claim commit.
- Admission docs/cards/task-board are independently revertible; no product or user-data change occurs.

## Result evidence

- Pending two eight-category audits, admission report, independent review and exact cleanup-card decision.

## Ready checklist（Coordinator）

- [x] ARCH-4 phase gate done
- [x] candidates and deletion questions are exact
- [x] product/config/generated hotspots remain read-only
- [x] V4 remains reserved for the final candidate

