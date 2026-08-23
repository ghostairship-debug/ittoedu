# S1 Task Card — ARCH-2 A-06 W2-A Resource Safety Gate

> 本卡是任务状态唯一真相；只有 Coordinator 可 close the gate.

## State and assignment

- Task ID: `arch-2-a-06-resource-safety-gate`
- Phase / wave: `ARCH-2 / W2-A resource safety gate`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Coordinator / independent validation reviewers / Coordinator`
- Claimed at / released at: `2026-08-24 Asia/Shanghai / pending`
- Worktree / branch: `primary validation workspace / codex/architecture-stabilization`
- Baseline HEAD: `04c9949`
- Claim commit: `pending`
- Context Pack + manifest hash | bootstrap-manual: `feature:media, feature:components and feature:editor-core; generated fresh/high/safe-for-S2; source b1095500, semantic d9f5f3a2, config 103c4aa4, tool 0895bc33`
- Freshness / relevant dirty inputs: `only regenerated repo-index output pending integration; no product writer lock`
- Depends on: `A-00 through A-05 done`
- Blocks: `ARCH-2 W2-B Runtime / Interactions / shared behavior work`
- Retry count / last failure class: `0 / none`

## Product outcome

W2-A closes only when asset and component package deltas are real cross-Surface product behaviors, full-snapshot behavior consumers measurably fall, legacy carriers remain correct, representative save/publish flows pass, and a ratchet prevents reintroducing the removed Store fallbacks.

## Scope and locks

### Allowed write

- New `docs/development-plan/baselines/ARCH_2_W2A_GATE_REPORT.md`
- Update `ARCH_2_RESOURCE_SNAPSHOT_BASELINE.md` with after counts only
- Targeted `tests/unit/architectureDependencyRatchet.test.ts` assertions
- Current-fact updates to existing Media/Components/Editor Core semantic records if evidence-backed
- Generated repo-index integration and this task card result fields

### Required read

- A-00 baseline and A-01 through A-05 result evidence
- Exact current Store/App/history consumers and task-board state
- ARCH-0A performance thresholds/representative fixtures
- Legacy and Feature consumer ledgers, current must-preserve rules

### Forbidden write

- Product behavior source, contracts/Schema, package/lockfile, fixtures
- Runtime/Interactions/Global Layers/Diagnostics/Save implementation
- Existing A-01 through A-05 task cards

## Acceptance

- [ ] Resource-aware histories are 3/3 and both product delta kinds have real consumers.
- [ ] Media library and component replacement before/after matrices meet A-00 targets.
- [ ] Old per-item media loop, V8 replacement planner, retarget helper and replacement empty fallback are zero.
- [ ] Structural full-snapshot fields remain honestly nonzero with their remaining exact consumers named.
- [ ] FlowComponentBlock and all Surface carriers remain unchanged except intended versions.
- [ ] Focused, representative, typecheck, contracts/capabilities/index/task-board and performance gates pass.
- [ ] Dependency ratchet fails if removed paths return.
- [ ] Pipeline/outcome/accepted status are reported separately.

## Minimal validation

- A-01 through A-05 pure + integration suites and architecture dependency ratchet.
- Three representative validators, deterministic fixtures, save/reopen and Published V2 evidence.
- ARCH-0A-compatible performance run; registered Mixed PPTX red remains explicit.
- `npm run typecheck`, `check:contracts`, `check:ai-capabilities`, `repo:index:check`, `repo:index:quality`, `check:task-board`, `git diff --check`.
- Full `npm test` only if focused/consumer audit indicates broad Store risk or at this gate's final candidate.

## Rollback

- Start point: `04c9949` plus this claim commit.
- Gate evidence/ratchet/index commits are independently reversible; A-01 through A-05 remain separately rollbackable.
- No user or representative fixture is written.

## Result evidence

- Pending consumer audit, performance comparison, ratchet and final gate validation.

