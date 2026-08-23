# S1 Task Card — ARCH-2 A-00 Resource Snapshot Characterization

> 本卡是任务状态唯一真相；任务板由任务卡生成。

## State and assignment

- Task ID: `arch-2-a-00-resource-snapshot-characterization`
- Phase / wave: `ARCH-2 / W2-A resource safety baseline`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Coordinator / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 Asia/Shanghai / pending`
- Worktree / branch: `primary integration workspace / codex/architecture-stabilization`
- Baseline HEAD: `d6b56a2`
- Claim commit: `pending`
- Context Pack + manifest hash | bootstrap-manual: `feature:media, feature:components and feature:editor-core; fresh/high/safe-for-S2; source 35e2be08, semantic d9f5f3a2, config 103c4aa4, tool 0895bc33`
- Freshness / relevant dirty inputs: `clean tree before claim; read-only audits only`
- Depends on: `ARCH-1 gate done`
- Blocks: `arch-2-a-01, arch-2-a-02, arch-2-a-03 integration acceptance; ARCH-2 W2-A gate`
- Retry count / last failure class: `0 / none`

## Product outcome

ARCH-2 starts from a reproducible count of full resource snapshots, resource-aware Surface histories, active delta behaviors, no-op legacy fallbacks and representative failure behavior, so later reductions cannot be inferred from green tests alone.

## Scope and locks

### Allowed write

- `docs/development-plan/baselines/ARCH_2_RESOURCE_SNAPSHOT_BASELINE.md`
- New characterization tests only when a claim requires executable reproduction
- This task card result fields

### Required read

- `editorStore.ts` persistence/import/replace/undo/redo seams
- Slide, Flow and Spatial history implementations
- Media and Components current production consumers
- ARCH-0A performance and representative-project evidence

### Forbidden write

- Product source, contracts/Schema, package/lockfile, fixtures and generated repo-index
- Other task cards

## Acceptance

- [ ] Exact structural counts distinguish fields/adapters from behavior consumers.
- [ ] Media two-item batch before-state is recorded for Slide, Flow and Spatial.
- [ ] Component replacement before-state records Slide/Mixed/Flow/Spatial behavior and package-resource undo coverage.
- [ ] Baseline records current green tests separately from known wrong/no-op behavior.
- [ ] No product change is made.

## Minimal validation

- Focused existing Media/Components/History suites named in the baseline.
- Read-only source-count commands and `git diff --check`.

## Rollback

- Start point: `d6b56a2`
- Evidence is documentation/test-only; revert the characterization commit without touching user data.

## Result evidence

- Pending after claim.

