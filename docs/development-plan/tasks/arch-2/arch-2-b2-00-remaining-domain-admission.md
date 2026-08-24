# S1 Task Card — ARCH-2 W2-B2 Remaining-domain Admission

> 本卡是任务状态唯一真相；只做只读准入与可复核结论，不把阶段标题转换成预设实现。

## State and assignment

- Policy version: 2
- Risk tier: S1
- Task class: docs
- Necessity / skip condition: `arch-2-b1-13-runtime-interaction-validation-gate` 明确把 W2-B2 Global Layers / Teacher Controller、Diagnostics 与 Save / Recovery 列为下一允许范围；若当前事实证明某域行为成立且不存在可复现风险、真实待迁 consumer 或明确替代目标，则该域以 skip evidence 结束且不创建实现卡。
- Complexity delta: neutral
- Validation ceiling: V0
- Validation budget: 30 minutes
- Reviewer budget: 1
- Evidence reuse: 结论绑定 baseline `16c787f` 的源码、合同、现有 focused evidence 与 fresh repo-index；只改本卡、报告、任务板或 generated 不使准入证据失效，命中下列产品路径或相关依赖/测试配置时重审对应域。
- Invalidating paths: `src/renderer/authoring/v9TeacherControllerAuthoring.ts`; `src/renderer/course/effectiveLayerCommands.ts`; `src/renderer/course/effectiveLayerProjection.ts`; `src/renderer/course/globalLayerCommands.ts`; `src/renderer/store/editorStore.ts`; `src/shared/projectHealth.ts`; `src/shared/projectDiagnostics.ts`; `src/renderer/ui/ProjectHealthPanel.tsx`; `src/renderer/project/recoveryWriteCoordinator.ts`; `src/renderer/project/saveProject.ts`; `src/renderer/App.tsx`; relevant focused tests
- Task ID: `arch-2-b2-00-remaining-domain-admission`
- Phase / wave: `ARCH-2 / W2-B2 remaining-domain admission`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Coordinator + W2-B2 Admission Auditor / independent admission reviewer / Coordinator`
- Claimed at / released at: `2026-08-24T17:08:20+08:00 / —`
- Worktree / branch: `shared root, read-only product audit / codex/architecture-stabilization`
- Baseline HEAD: `16c787f`
- Context: fresh generated repo-index at `16c787f`; source `28949c93`, semantic `8ae66530`, config `103c4aa4`, tool `2c71dbb7`
- Freshness / relevant dirty inputs: clean worktree after stabilization index refresh; no product writer lock
- Depends on: `arch-2-b1-13-runtime-interaction-validation-gate` done
- Blocks: ARCH-2 W2-B2 implementation decisions and ARCH-2 phase gate
- Retry count: `0`

## Product outcome

The Integrator has source-backed admit/skip decisions for the three remaining ARCH-2 candidate domains, so only a reproducible user risk or a real consumer/replacement target can create product work.

## Current fact and evidence

W2-A and W2-B1 are closed, while the W2-B2 domains have no current task card or exit evidence. The phase plan requires a read-only authoring → save/reopen → Published/Player check for shared/global ownership, evidence-based Diagnostics screening, and retention of App/Persistence ownership unless Save/Recovery has a concrete bug or replacement target.

## Non-goals

No new Layer, Controller, Diagnostics, persistence, session or lifecycle API; no product edits, test additions, broad Store/App refactor, Schema/contract change, consumer migration, directory move or full validation.

## Scope and locks

### Allowed write

- `docs/development-plan/baselines/ARCH_2_W2B2_ADMISSION_REPORT.md`
- this task card and generated `docs/development-plan/TASK_BOARD.md`

### Required read

- `docs/development-plan/30-execution/04_ARCH_2_CROSS_SURFACE_FEATURES.md`
- relevant current module docs and `FEATURE_CONSUMER_OWNER_LEDGER.md`
- current shared/global authoring, projection, save/reopen, Published/Player, Diagnostics, App/Persistence and focused-test evidence
- current repo-index facts and precise static/dynamic consumer evidence

### Forbidden write

- all product source, tests, contracts, fixtures, dependencies, other task cards, canonical semantic records and generated repo-index

### Do not read unless needed

- frozen Editor 1.0 cards, removed dated plans and historical evaluation reports

### Hotspot locks

- none; App, Store, Published producer and persistence are read-only

## Change budget

- Task timebox: 30 Coordinator minutes
- Main source files: 0
- New/moved files: one admission report; no moves
- Public exports: 0
- Deletion allowed: no
- Dependency/lockfile changes: no
- UI copy/behavior changes: no
- Schema/contract changes: no
- Generated diff: task board only; repo-index refresh deferred to the ARCH-2 phase gate
- Target tests / expected validation time: V0 document/task-board checks only, under 5 minutes
- Max implementation retries: 1 documentation correction

## Implementation outline

1. Trace Global Layers / Teacher Controller ownership, effective ordering and single-controller behavior across authoring, archive/reopen and Published/Player consumers.
2. Trace only evidenced Diagnostics ownership/recompute/error-attribution issues and Save/Recovery bugs or replacement targets.
3. Record each domain as `admit`, `skip` or `retained`, with exact evidence and the smallest next card only for admitted behavior.

## Acceptance

- [ ] Each of the three candidate domains has an evidence-backed admit/skip/retained decision.
- [ ] Every admitted item names one observable behavior, exact consumer/replacement, narrow files and 1–3 focused tests.
- [ ] Every skipped/retained item names its current owner and a concrete revisit trigger.
- [ ] No product change, speculative abstraction, duplicated truth or product-level escalation is introduced.
- [ ] Budget and read-only scope are respected.

## Minimal validation

- `npm run check:task-board`
- Verify every report citation resolves to a current source, test, contract or task-card path.
- `git diff --check`

## Rollback

- Start point: `16c787f`
- Implementation commit: none; documentation-only admission evidence
- Old path remains: all current product paths remain unchanged

## Consumers and index

- Consumer delta: audit only; no consumer changes
- Legacy record IDs: cite existing records only if directly relevant; no status mutation in this card
- Semantic index impact: none
- Generated refresh: defer-to-wave-gate

## Result evidence

- Actual change/product commit and evidence key: pending
- Behavior before/after: pending
- Validation results: pending
- Consumer delta: none expected
- Remaining risks: pending
- Rollback commit or start point: `16c787f`
- Next allowed task: pending evidence-based admit/skip decisions

## Findings / next allowed task

Pending audit and independent review.

## Ready checklist（Coordinator）

- [x] dependsOn satisfied
- [x] context fresh or Bootstrap verified
- [x] evidence and paths valid
- [x] write locks available
- [x] budget/validation/rollback complete
- [x] no related user dirty change
- [x] no product escalation triggered
