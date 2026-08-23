# S1 Task Card — ARCH-0A Representative V9 Projects

## State and assignment

- Task ID: `arch-0a-rep-00-v9-representative-projects`
- Phase / wave: `ARCH-0A / wave 1`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Fixture Worker / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 Asia/Shanghai / —`
- Worktree / branch: `shared workspace, fixture-only write scope / codex/architecture-stabilization`
- Baseline HEAD: `6893d25449511ef281c9399d6dd740d126a25bb6`
- Claim commit: `commit containing this card`
- Context: `bootstrap-manual`
- Freshness / relevant dirty inputs: baseline clean; only this claimed task card may be dirty before dispatch
- Depends on: `arch-0a-bsl-00-baseline-and-budgets (done)`
- Blocks: `arch-0a-perf-00-test-and-performance-baseline`, ARCH-0A gate
- Retry count: `0`

## Product outcome

Three deterministic, legal Course Project V9 archives reproducibly cover the Slide-heavy, Flow-heavy, and Mixed/Spatial capabilities required for stabilization regression evidence.

## Current fact and evidence

Small legal V9 seed fixtures exist under `tests/fixtures/course-project-v9/`, but none individually satisfies the representative capability matrix. They must not be relabeled without adding and validating the missing coverage.

## Non-goals

- No product runtime or contract change.
- No user file mutation.
- No claim of visual acceptance.
- No full E2E, package, or release run.

## Scope and locks

### Allowed write

- `scripts/build-architecture-baseline-fixtures.ts`
- `tests/fixtures/architecture-baseline/**`
- `tests/unit/architectureBaselineFixtures.test.ts`
- `docs/development-plan/baselines/ARCH_0_REPRESENTATIVE_PROJECTS.md`
- This task card result fields.

### Required read

- `src/shared/contracts/course-project-v9/**`
- Existing V9 fixture builders and `scripts/validate-project.ts`
- One save/archive, Player, and export consumer for coverage interpretation.

### Forbidden write

- `src/**`, contracts/Schema, `package.json`, `package-lock.json`
- Store/App/Workspace/Properties/Published producer/main/preload
- `repo-index/generated/**`, other task cards, FACT/MAP and Legacy ledgers

### Do not read unless needed

- Historical Editor 1.0 task bodies and build/release output.

### Hotspot locks

- None; fixture/evidence scope only.

## Change budget

- Task timebox: `1 Worker day`
- Main source files: `0 product; 1 builder; 1 focused test`
- New/moved files: `3 fixture archives plus source/evidence as needed`
- Public exports: `0`
- Deletion allowed: `no`
- Dependency/lockfile changes: `no`
- UI copy/behavior changes: `no`
- Schema/contract changes: `no`
- Generated diff: only this task's deterministic fixture outputs
- Target tests / expected validation time: `builder + fixture unit test + 3 validate-project commands, under 10 minutes`
- Max implementation retries: `2`

## Characterization

- Current successful behavior: existing seed archives validate as schema 9.
- Known failure: seed archives are about 2 KB and omit required representative combinations.
- Async/stale/history/save/preview implications: this task supplies future evidence inputs but does not modify those behaviors.

## Implementation outline

1. Reuse contract factories and existing builders to generate deterministic fixtures.
2. Include explicit capability markers and valid sidecar/component bytes where referenced.
3. Validate Schema 9, required carrier/capability coverage, archive reproducibility, and hashes.
4. Record build commands, hashes, applicable flow matrix, and remaining manual evidence.

## Acceptance

- [ ] Three archives are legal V9 and reproducible
- [ ] Slide-heavy coverage includes states/layers/media/component/play/static-export inputs
- [ ] Flow-heavy includes semantic blocks, formula/table/code, FlowComponentBlock, and IME test content
- [ ] Mixed/Spatial includes three Surfaces, global/shared/controller, camera/path, component, Runtime
- [ ] No product/contract/dependency change

## Minimal validation

- `npx tsx scripts/build-architecture-baseline-fixtures.ts --check`
- `npx vitest run tests/unit/architectureBaselineFixtures.test.ts`
- `npm run --silent validate:course-project -- <each of the three archives>`
- Manual: inspect extracted `project.json` capability matrix and verify no V8 fixture is used.

## Rollback

- Start point: `6893d25449511ef281c9399d6dd740d126a25bb6`
- Implementation commit: pending
- Old path remains: existing V9 seed fixtures remain unchanged.

## Consumers and index

- Consumer delta: `0 product consumers`; adds regression fixtures.
- Legacy record IDs: none
- indexImpact: `regenerate`

## Result evidence

- Pending Worker result.

## Findings / next allowed task

- Performance/manual-flow baseline may start only after hashes and repeatable build commands are recorded.

## Ready checklist (Coordinator)

- [x] dependsOn satisfied
- [x] Bootstrap context verified
- [x] evidence and paths valid
- [x] write locks available
- [x] budget/validation/rollback complete
- [x] no related user dirty change
- [x] no product escalation triggered
