# S1 Task Card — ARCH-0B IDX-03 Golden Task Gates

## State and assignment

- Task ID: `arch-0b-idx-03-golden-task-gates`
- Phase / wave: `ARCH-0B / wave 4`
- Status: `draft`
- Owner / Reviewer / Integrator: `unassigned / Coordinator / Coordinator`
- Claimed at / released at: `— / —`
- Worktree / branch: `pending / codex/architecture-stabilization`
- Baseline HEAD: `1899deb33eb9b7cef13a3ad2ccbe1018d5eca171`
- Claim commit: `pending`
- Context: `repo:context after IDX-02; Bootstrap comparison is required`
- Freshness / relevant dirty inputs: refresh after query integration
- Depends on: `arch-0b-idx-02-query-context-pack (done)`
- Blocks: ARCH-0B exit; ARCH-2 broad multi-agent gate
- Retry count: `0`

## Product outcome

Twenty-five evidence-backed real tasks quantify whether repo-index improves navigation without high-confidence misdirection, with a recorded 15-task controlled milestone and a hard broad-dispatch gate.

## Current fact and evidence

No current golden-task corpus, expected path/contract/test set, evaluator, Hit@5/Recall@15 metrics, Bootstrap comparison, or quality command exists.

## Non-goals

- No brittle single exact ranking.
- No fabricated historical result or semantic tuning that hides a failed query.
- No product source, contract, or generated-fact change.

## Scope and locks

### Allowed write

- `repo-index/golden-tasks/tasks.json`
- `repo-index/golden-tasks/expected.json`
- `scripts/repo-index/evaluateGoldenTasks.ts`
- `tests/unit/repoIndexGoldenTasks.test.ts`
- `package.json` quality script only
- `docs/development-plan/baselines/ARCH_0B_INDEX_QUALITY.md`
- This task card.

### Required read

- Frozen historical task titles/evidence only as routed by the current plan
- Current query/context output and strict manifest
- Current module/journey inventory and high-signal tests/contracts

### Forbidden write

- Product source/contracts/lockfile
- semantic/generated facts, query implementation, other cards

### Hotspot locks

- None; corpus/evaluator only. Coordinator owns any follow-up semantic or generated refresh.

## Change budget

- Task timebox: `2 Worker days`
- Main source files: `2 corpus files + evaluator + focused test + evidence`
- Public exports: evaluator DTO only
- Deletion/dependency/UI/Schema/generated changes: `no`
- Target tests / expected validation time: `25-task quality run + deterministic rerun + Bootstrap comparison, under 5 minutes`
- Max implementation retries: `2`; semantic tuning attempts: `3`

## Characterization

- Corpus must cover Slide, Flow, Spatial, Media, Components, Runtime/Interaction, layers/controller, save/recovery, Preview/Player/HTML/Web/PPTX/PDF/DOCX, diagnostics, DeveloperTab, main/preload/IPC, and all three tsconfigs.
- Expected data records must-appear and forbidden-high-rank evidence, not a unique order.

## Acceptance

- [ ] First 15-task controlled milestone recorded before the 25-task gate
- [ ] 25 tasks cover every required module and desktop/compiler boundary
- [ ] Canonical file Hit@5 ≥ 90%
- [ ] Required contract/high-signal test Recall@15 ≥ 85%
- [ ] High-confidence wrong answer count = 0
- [ ] Generation < 10 seconds, query P95 < 2 seconds, same inputs byte-identical
- [ ] Low confidence and external Catalog source queries correctly degrade
- [ ] Bootstrap time/context-volume comparison shows observable improvement

## Minimal validation

- Focused golden evaluator tests
- Quality command twice with identical results
- `npm run repo:index:check`, `npm run check:task-board`, and diff hygiene
- Manual audit of every high-confidence result and every fallback.

## Rollback

- Start point: IDX-02 completion commit
- Implementation commit: pending
- Old path remains: manual Bootstrap is mandatory if gates fail.

## Consumers and index

- Consumer delta: adds a quality gate for development tooling
- Legacy record IDs: none
- indexImpact: `none unless findings require a separate Coordinator semantic update`

## Result evidence

- Pending.

## Ready checklist (Coordinator)

- [ ] IDX-02 done and index fresh
- [ ] 25 evidence-backed task candidates selected
- [ ] corpus/evaluator scope and budget validated
- [ ] no relevant user dirty changes
- [ ] no product escalation
