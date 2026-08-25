# S1 Task Card — Cover Authoring Output-path Validation Directly

## State and assignment

- Policy version: 2
- Risk tier: S1
- Task class: implementation
- Necessity / skip condition: final candidate 07 showed that the authoring path-safety test can outlive Vitest's default timeout because it serially cold-starts four `tsx` processes. Diagnosis also proved the first two cases never reached their intended alias branch. Skip only if the test invokes the exported CLI directly and asserts every intended configuration error; it does not.
- Complexity delta: subtractive
- Validation ceiling: V1
- Validation budget: 15 minutes
- Reviewer budget: 1
- Reviewer risk surface: path-alias and extension branch coverage, process stream isolation and inventory-byte preservation
- Evidence reuse: reuse focused diagnosis that the current case exits before Electron and leaves no processes. Existing real Electron authoring round-trip coverage remains unchanged and is outside this card.
- Invalidating paths: `tests/unit/coursewareAuthoringRunner.test.ts`; `scripts/run-courseware-authoring.ts` argument parsing/path identity/extension validation; Node stream mocking behavior
- Task ID: `arch-5-final-11-cover-authoring-output-path-validation`
- Phase / wave: `ARCH-5 / post-audit candidate repair`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Authoring Runner Test Owner / independent path-validation reviewer / Coordinator`
- Claimed at / released at: `2026-08-25T11:10:25+08:00 / not released`
- Worktree / branch: `shared root / codex/architecture-stabilization`
- Baseline HEAD: `d1566af`; candidate 07 is rolled back and the tree is clean.
- Context: test-only repair using the already exported CLI entry point; implementation is frozen.
- Freshness / relevant dirty inputs: this claim card and the generated task board only.
- Depends on: `arch-5-final-07-post-audit-v4-performance-outcome` rolled back at `d1566af`.
- Blocks: the next fixed final candidate.
- Risk statement: simply increasing the timeout would preserve false-positive alias coverage; direct invocation must provide all four valid delivery baselines, assert the exact error branch and restore process stream mocks.
- Retry count / last failure class: `0 / test harness timeout plus unreachable intended assertions`

## Product outcome

The authoring CLI unit contract rapidly and explicitly rejects report/inventory aliases, hard-link aliases and wrong output extensions while proving inventory bytes remain untouched.

## Scope

### Allowed write

- `tests/unit/coursewareAuthoringRunner.test.ts`
- this card and generated task board

### Forbidden write

- authoring runner/product source, contracts, fixtures and configuration

## Acceptance

- [ ] The case calls exported `runCoursewareAuthoringCli` directly with all four valid delivery baseline paths.
- [ ] Each of four invalid variants returns `2` and emits its intended exact alias or extension diagnostic.
- [ ] The inventory bytes remain identical after every invalid invocation.
- [ ] Stream interception is restored even if an assertion fails.
- [ ] Focused test, TypeScript check and diff check pass.
- [ ] One independent reviewer approves without rerunning the broad suite.

## Validation

- `npx vitest run tests/unit/coursewareAuthoringRunner.test.ts -t "rejects output aliases and wrong extensions" --maxWorkers=1`
- `npx tsc --noEmit`
- `git diff --check`

## Rollback

- Revert the test-only commit; no runner, product or persisted data changes.

## Result evidence

- Pending focused implementation, validation and independent review.
