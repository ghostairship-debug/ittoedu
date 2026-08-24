# S0 Task Card — Update Failed-Navigation Rollback Expectation

## State and assignment

- Policy version: 2
- Risk tier: S0
- Task class: implementation
- Necessity / skip condition: candidate-2 full Vitest exposed an integration assertion that predates the correct same-surface rollback added by `eb224da`. Change only the obsolete expectation; skip/stop if the product call sequence is not exactly target B followed by restore A.
- Complexity delta: neutral
- Validation ceiling: V1
- Validation budget: 8 minutes
- Reviewer budget: 0
- Evidence reuse: independent read-only diagnosis and one exact-case reproduction already prove the two calls are deterministic, match the dedicated navigator test and are not cross-test pollution.
- Invalidating paths: `tests/integration/publishedInteractionSlideHostIntegration.test.ts`; `src/player/surfaces/mixed/MixedCourseNavigator.ts`; `src/player/surfaces/publishedDynamicHosts.ts`
- Task ID: `arch-5-final-03-update-navigation-rollback-test`
- Phase / wave: `ARCH-5 / candidate repair`
- Status: `done`
- Owner / Reviewer / Integrator: `navigation test worker / prior independent diagnosis / Coordinator`
- Claimed at / released at: `2026-08-24T20:59:36+08:00 / 2026-08-24T21:07:13+08:00`
- Worktree / branch: `shared root / codex/architecture-stabilization`
- Baseline HEAD: `406c0b1`
- Context: candidate 2 failed at complete Vitest before E2E/build; dedicated navigator behavior added later than this integration assertion
- Freshness / relevant dirty inputs: this claim card and task board only
- Depends on: `arch-5-final-02-v4-and-outcome` rolled back
- Blocks: candidate 3
- Risk statement: weakening the assertion to a count-only or timing-dependent check could hide a broken compensating navigation.
- Retry count / last failure class: `0 / none`

## Product outcome

The integration test verifies the actual safety behavior: a failed move from Slide location A to B restores A, while prepared presentation state is still cleared.

## Scope

### Allowed write

- `tests/integration/publishedInteractionSlideHostIntegration.test.ts`
- this card and generated task board

### Forbidden write

- Player/product source, other tests, fixtures, config/contracts and user data

## Implementation

- Replace the transient one-call wait with a stable wait for the completed two-call compensation.
- Assert ordered arguments `surface-slide / location-beta`, then `surface-slide / location-alpha`; retain all later state-cleanup assertions unchanged.

## Acceptance

- [x] exact target and rollback call order is asserted
- [x] no product source or unrelated test changes
- [x] exact focused case passes once

## Validation

- Run the exact case once: `npx vitest run tests/integration/publishedInteractionSlideHostIntegration.test.ts -t "clears a prepared target state when navigation fails before location render"`.
- Run `git diff --check`; candidate 3 owns broad verification.

## Rollback

- Revert the one test hunk; product behavior is unchanged.

## Result evidence

- Test-only commit `580f73f` replaces the transient one-call wait with the completed `surface-slide/location-beta → surface-slide/location-alpha` compensation order; all prepared-state cleanup assertions remain unchanged.
- Exact focused result: `1 passed / 19 skipped` in `1.35s`; `git diff --check` passed.
- Independent diagnosis traced the expectation to pre-`eb224da` behavior and confirmed the exact case reproduces in isolation; no product source changed.
