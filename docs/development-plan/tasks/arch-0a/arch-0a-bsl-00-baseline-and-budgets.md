# S1 Task Card — ARCH-0A BSL-00 Baseline and Budgets

> Bootstrap exception: this is the first current task card. Its claim is based on the clean activated-plan commit because no task directory, task board, or repo-index existed yet.

## State and assignment

- Task ID: `arch-0a-bsl-00-baseline-and-budgets`
- Phase / wave: `ARCH-0A / bootstrap`
- Status: `done`
- Owner / Reviewer / Integrator: `Coordinator / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 Asia/Shanghai / 2026-08-24 Asia/Shanghai`
- Worktree / branch: `primary workspace / codex/architecture-stabilization`
- Baseline HEAD: `6c7616f4a8518be8e72cd26f5c5786bf7d7bdf63`
- Claim commit: `6e70d47a4384e9fd63ed1425ec1071f896d689f2`
- Context: `bootstrap-manual`
- Freshness / relevant dirty inputs: baseline working tree clean; no user-owned changes
- Depends on: `GOV-00 at 6c7616f (already completed by plan activation)`
- Blocks: `ARCH-0A representative fixtures, FACT/MAP, performance baseline; ARCH-0B IDX-00`
- Retry count: `0`

## Product outcome

The stabilization program starts from a reproducible clean commit, rollback tag, classified checks, canonical evidence locations, and explicit phase budgets.

## Current fact and evidence

The activated plan existed at `6c7616f`, but current task cards, a task board, repo-index, representative-project evidence, and the post-activation baseline did not. Evidence: `COURSEWARE_DEVELOPMENT_PLAN.md`, `docs/development-plan/VALIDATION_REPORT.md`, and the clean Git status captured on 2026-08-24.

## Non-goals

- No product runtime behavior changes.
- No V9 Schema or contract changes.
- No representative-project product regression run in this card.
- No Store, App, Workspace, Properties, Published producer, main/preload, or generated-index write.

## Scope and locks

### Allowed write

- This task card.
- `docs/development-plan/baselines/ARCH_0_BASELINE.md`
- Initial task-card scaffolding and canonical inventory-location declarations.

### Required read

- `COURSEWARE_DEVELOPMENT_PLAN.md`
- `docs/development-plan/README.md`
- `docs/development-plan/30-execution/01_ARCH_0A_GOVERNANCE_AND_REBASE.md`
- `docs/development-plan/40-development/01_TASK_RISK_TIERS_AND_PROTOCOL.md`
- `docs/development-plan/40-development/03_VALIDATION_STRATEGY.md`

### Forbidden write

- `src/**`, `tests/**`, `scripts/**`, `package.json`, `package-lock.json`
- `src/shared/contracts/**`, `artifacts/contracts/**`, `docs/contracts/**`
- `repo-index/generated/**`

### Do not read unless needed

- `docs/tasks/editor-1.0/**`
- Historical assessment material and build outputs.

### Hotspot locks

- Task-state bootstrap only; no product hotspot.

## Change budget

- Task timebox: `1 Coordinator workday`
- Main source files: `0`
- New/moved files: `baseline + first task cards only`
- Public exports: `0`
- Deletion allowed: `no`
- Dependency/lockfile changes: `no`
- UI copy/behavior changes: `no`
- Schema/contract changes: `no`
- Generated diff: `no`
- Target tests / expected validation time: `Git hygiene + contracts + capabilities + three TypeScript projects + unit/integration baseline; under 10 minutes`
- Max implementation retries: `1`

## Characterization

- Current successful behavior: plan activation checks passed at `6c7616f`; full unit/integration baseline had not been rerun by the plan-only commit.
- Known failure: none established at claim time.
- Async/stale/history/save/preview implications: not modified; later representative-project tasks own those checks.

## Implementation outline

1. Capture exact repository/environment facts and user-difference status.
2. Run and classify the permitted baseline checks.
3. Create an unambiguous rollback tag.
4. Fix canonical paths for baseline, FACT/MAP, Legacy ledger, and task cards.
5. Record phase/wave budgets and release this bootstrap lock.

## Acceptance

- [x] Clean baseline and rollback point recorded
- [x] Checks classified with reproducible commands
- [x] Canonical evidence locations fixed
- [x] ARCH phase budgets filled
- [x] No product or contract change
- [x] Diff and task scope clean

## Minimal validation

- `git status --short --branch`
- `npm run check:contracts && npm run check:ai-capabilities && npm run typecheck`
- `npm run test`
- Manual: verify the annotated rollback tag dereferences to the activated-plan commit.

## Rollback

- Start point: `6c7616f4a8518be8e72cd26f5c5786bf7d7bdf63`
- Implementation commit: `the commit containing ARCH_0_BASELINE.md and this release update`
- Old path remains: activated plan and manual Bootstrap remain usable.

## Consumers and index

- Consumer delta: `0`
- Legacy record IDs: `none`
- indexImpact: `semantic-update after ARCH-0B exists`

## Result evidence

- Behavior before/after: the activated plan had no executable baseline state; the repository now has a tagged rollback commit, exact environment and lockfile identity, classified checks, canonical evidence locations, and bounded phase waves.
- Validation results: contracts pass; AI capability freshness pass; all three TypeScript projects pass; 202 Vitest files / 1263 tests pass; Git diff hygiene passes.
- Consumer delta: `0` (governance only).
- Remaining risks: E2E, desktop, package, representative projects, performance, and writer/consumer counts remain explicitly pending in their owning cards.
- Rollback commit: return to tag `pre-architecture-stabilization-20260824-6c7616f` or revert the baseline/task commits without touching product code.
- Next allowed task: representative fixtures, FACT/MAP, and IDX-00 may now be claimed in parallel.

## Findings / next allowed task

- After release, the representative fixtures, FACT/MAP inventory, and TS7 adapter spike may run in parallel with non-overlapping write scopes.

## Ready checklist (Coordinator)

- [x] GOV-00 predecessor evidenced
- [x] Bootstrap context verified
- [x] Evidence and paths valid
- [x] Write lock available
- [x] Budget/validation/rollback complete
- [x] No related user dirty change
- [x] No product escalation triggered
