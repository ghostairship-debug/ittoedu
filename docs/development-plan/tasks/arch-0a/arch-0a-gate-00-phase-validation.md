# S1 Task Card — ARCH-0A Phase Gate

## State and assignment

- Task ID: `arch-0a-gate-00-phase-validation`
- Phase / wave: `ARCH-0A / phase gate`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Validation Worker / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 Asia/Shanghai / —`
- Worktree / branch: `primary workspace / codex/architecture-stabilization`
- Baseline HEAD: `305eb648141230471a9975bf3fa3facf97a0d0aa`
- Claim commit: `commit containing this claim update`
- Context: `bootstrap-manual plus completed ARCH-0A evidence`
- Freshness / relevant dirty inputs: worktree clean; all ARCH-0A implementation cards done; strict repo-index and task board fresh
- Depends on: `arch-0a-bsl-00, task-00, rep-00, map-00, perf-00 all done`
- Blocks: ARCH-1 minimum baseline gate
- Retry count: `0`

## Product outcome

ARCH-0A closes with reproducible governance, fixture, consumer, functional, and performance evidence while clearly separating pipeline, engineering, outcome, and accepted status.

## Current fact and evidence

Baseline, task board, representative fixtures, and consumer inventory are integrated. Performance/manual-flow evidence remains active, so the phase gate cannot yet run.

## Non-goals

- No product runtime fix, broad E2E, desktop package, or release decision.
- No claim that automated evidence is art/accepted.
- No duplicate task/consumer state in the report.

## Scope and locks

### Allowed write

- `docs/development-plan/baselines/ARCH_0A_GATE_REPORT.md`
- `docs/development-plan/baselines/ARCH_0_BASELINE.md` status references only
- This task card and generated task board

### Required read

- All completed ARCH-0A task result fields and canonical evidence files
- Validation strategy and phase exit gate

### Forbidden write

- Product source/tests/scripts/contracts/package/lockfile
- inventories, representative fixtures, performance raw evidence, repo-index generated/semantic

### Hotspot locks

- ARCH-0A phase report and task-state integration only.

## Change budget

- Task timebox: `half Coordinator day`
- Main source files: `0`; one report plus status references
- Deletion/dependency/UI/Schema/generated-index changes: `no`
- Target validation / expected time: `all ARCH-0A focused checks and links; under 30 minutes`
- Max implementation retries: `1`

## Characterization

- Product code did not change in ARCH-0A.
- Fixtures/measurement/test tooling changed and require their own deterministic checks.
- Full product `verify` remains a final-candidate concern unless current evidence exposes a cross-system risk.

## Acceptance

- [ ] Every ARCH-0A card is done/wave-validated and board fresh
- [ ] Baseline/tag/environment/check classification reproducible
- [ ] Three representative fixtures deterministic and legal V9
- [ ] FACT/MAP/Legacy counts and zero queries reproducible
- [ ] Functional/performance/manual-flow evidence and unknowns recorded
- [ ] Pipeline/engineering/outcome/accepted reported separately
- [ ] ARCH-1 can name a fresh baseline without hidden blockers

## Minimal validation

- `npm run check:task-board`, contracts, capabilities, typecheck
- Representative builder check and focused fixture/flow tests
- Legacy JSON/count/zero-reference checks
- Markdown links/paths and `git diff --check`

## Rollback

- Start point: final ARCH-0A implementation task commit
- Implementation commit: pending
- Old path remains: individual task evidence remains authoritative.

## Consumers and index

- Consumer delta: `0`
- Legacy record IDs: `LEG-001`–`LEG-010` read-only reference
- indexImpact: `source facts changed; Coordinator regenerates after ARCH-0B`

## Result evidence

- Pending.

## Ready checklist (Coordinator)

- [x] all dependencies done
- [x] no related dirty task evidence
- [x] phase validation budget available
- [x] no product escalation triggered
