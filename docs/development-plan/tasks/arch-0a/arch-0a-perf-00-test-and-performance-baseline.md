# S1 Task Card — ARCH-0A Test and Performance Baseline

## State and assignment

- Task ID: `arch-0a-perf-00-test-and-performance-baseline`
- Phase / wave: `ARCH-0A / wave 2`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Validation Worker / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 Asia/Shanghai / —`
- Worktree / branch: `shared workspace, baseline evidence-only scope / codex/architecture-stabilization`
- Baseline HEAD: `941ee9275fed73964558c7ff4f68eecb30d61ced`
- Claim commit: `commit containing this claim update`
- Context: `bootstrap-manual`
- Freshness / relevant dirty inputs: representative fixtures integrated and independently revalidated; inventory/repo-index paths are disjoint
- Depends on: `arch-0a-rep-00-v9-representative-projects (done)`
- Blocks: ARCH-0A performance/manual-flow gate; product-code migration comparison
- Retry count: `0`

## Product outcome

The same machine, fixtures, samples, and observable operations define reproducible functional and performance evidence for later regression decisions.

## Current fact and evidence

Static checks and 202/1263 Vitest baseline are recorded, but no current representative-project open/save/reopen/play/export measurements, interaction protocol, or median/P95 evidence exists.

## Non-goals

- No product fix or performance optimization.
- No weakening/retrying of flaky assertions.
- No claim of visual acceptance or formal release.

## Scope and locks

### Allowed write

- `scripts/measure-architecture-baseline.ts` or a narrower read-only measurement helper
- `tests/integration/architectureBaselineFlows.test.ts` if a deterministic non-UI flow is missing
- `docs/development-plan/baselines/ARCH_0_PERFORMANCE.md`
- `output/architecture-baseline/**` run evidence (only curated small evidence may be committed)
- This task card.

### Required read

- Representative fixture evidence and builders
- Save/archive, history, Preview/Player, and export public paths
- Relevant focused tests and Playwright helpers

### Forbidden write

- Product source, contracts/Schema, package/lockfile
- Existing product tests except the new dedicated baseline integration file
- Store/App/Workspace/Properties/Published/main/preload/generated index

### Hotspot locks

- None; read-only measurement and dedicated tests only.

## Change budget

- Task timebox: `1 Worker day`
- Main source files: `0 product; at most 1 measurement helper + 1 dedicated test`
- Public exports: `0`
- Deletion/dependency/UI/Schema changes: `no`
- Target tests / expected validation time: `three fixture validations + focused integration + bounded desktop/manual samples; under 60 minutes`
- Max implementation retries: `2`

## Characterization

- Successful baseline: contracts/capabilities/typecheck/unit green at activated plan commit.
- Known gap: E2E/build/package and representative functional/performance evidence unclaimed.
- Required operations: new/open, save/save-as/reopen, undo/redo, switch location, drag commit, Flow IME, Preview mount/destroy, applicable exports, large Mixed/history observation.

## Acceptance

- [ ] Environment/fixture/sample protocol fixed
- [ ] Median/P95 or explicit qualitative metric recorded for every required operation
- [ ] Functional red/green/unknown separated from performance
- [ ] Repro commands and artifacts recorded
- [ ] No product change or acceptance claim

## Minimal validation

- Three representative `validate:course-project` commands
- Focused baseline integration test
- One bounded desktop/manual sequence covering the three fixtures
- `git diff --check`

## Rollback

- Start point: representative fixture integration commit
- Implementation commit: pending
- Old path remains: static/unit baseline remains valid.

## Consumers and index

- Consumer delta: `0`
- Legacy record IDs: reference only
- indexImpact: `regenerate` if new helper/test is added

## Result evidence

- Pending.

## Ready checklist (Coordinator)

- [x] representative fixtures integrated
- [x] context refreshed
- [x] paths and commands validated
- [x] write scope clean and lock-free
- [x] retry/validation/rollback complete
- [x] no user dirty changes
- [x] no product escalation
