# S0 Task Card — Calibrate Repo-index Exact-check Budget

## State and assignment

- Policy version: 2
- Risk tier: S0
- Task class: implementation
- Necessity / skip condition: final candidate 07 timed out the exact temporary-directory check after `22.6s`, although read-only focused diagnosis passed in `3.269s` and found two intentional full repository scans. Skip only if the case budget already tolerates bounded full-suite contention; `15s` does not.
- Complexity delta: neutral
- Validation ceiling: V1
- Validation budget: 8 minutes
- Reviewer budget: 0
- Evidence reuse: reuse the focused diagnosis of `743` inputs, three TypeScript Projects, normal cleanup and no hang. Do not rerun the repository-wide suite inside this repair.
- Invalidating paths: `tests/unit/repoIndexGenerator.test.ts`; repo-index generator, input inventory, TypeScript project discovery or Vitest worker policy
- Task ID: `arch-5-final-10-calibrate-repo-index-check-budget`
- Phase / wave: `ARCH-5 / post-audit candidate repair`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Repo-index Test Owner / none / Coordinator`
- Claimed at / released at: `2026-08-25T11:10:25+08:00 / not released`
- Worktree / branch: `shared root / codex/architecture-stabilization`
- Baseline HEAD: `d1566af`; candidate 07 is rolled back and the tree is clean.
- Context: exact-case test-budget change only; generator behavior and global worker policy are frozen.
- Freshness / relevant dirty inputs: this claim card and the generated task board only.
- Depends on: `arch-5-final-07-post-audit-v4-performance-outcome` rolled back at `d1566af`.
- Blocks: the next fixed final candidate.
- Risk statement: a global timeout or worker change would mask unrelated problems; only this intentionally repository-wide case may receive a bounded `45s` budget.
- Retry count / last failure class: `0 / exact-case timeout budget under full-suite resource contention`

## Product outcome

The deterministic repo-index check remains behaviorally identical while its exact test budget accommodates measured full-suite contention without a global test-policy change.

## Scope

### Allowed write

- `tests/unit/repoIndexGenerator.test.ts`
- this card and generated task board

### Forbidden write

- generator/product source, global test configuration, contracts and generated index bytes

## Acceptance

- [ ] Only the affected test's timeout changes from `15_000` to `45_000`.
- [ ] The exact focused test and diff check pass.

## Validation

- `npx vitest run tests/unit/repoIndexGenerator.test.ts -t "checks through a temporary directory" --maxWorkers=1`
- `git diff --check`

## Rollback

- Revert the one-line test-budget commit; no product or generated index changes.

## Result evidence

- Pending focused implementation and validation.
