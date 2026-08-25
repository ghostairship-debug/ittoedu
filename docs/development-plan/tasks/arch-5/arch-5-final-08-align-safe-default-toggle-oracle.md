# S0 Task Card — Align Teacher-controller Safe-default Toggle Oracle

## State and assignment

- Policy version: 2
- Risk tier: S0
- Task class: implementation
- Necessity / skip condition: final candidate 07 exposed a stale unit oracle that clicks the now-safe `defaultCollapsed: true` default and then still expects `true`. Skip only if the test already proves both the checked default and the explicit unchecked override; it does not.
- Complexity delta: neutral
- Validation ceiling: V1
- Validation budget: 6 minutes
- Reviewer budget: 0
- Evidence reuse: independent read-only diagnosis traced the safe default to `acab5a2` and confirmed existing persistence coverage. Reuse that diagnosis; run only the exact affected test and a diff check.
- Invalidating paths: `tests/unit/globalLayerUi.test.tsx`; teacher-controller defaults, Properties checkbox behavior or persistence code
- Task ID: `arch-5-final-08-align-safe-default-toggle-oracle`
- Phase / wave: `ARCH-5 / post-audit candidate repair`
- Status: `claimed`
- Owner / Reviewer / Integrator: `UI Test Owner / none / Coordinator`
- Claimed at / released at: `2026-08-25T11:10:25+08:00 / not released`
- Worktree / branch: `shared root / codex/architecture-stabilization`
- Baseline HEAD: `d1566af`; candidate 07 is rolled back and the tree is clean.
- Context: test-only repair; product defaults and UI behavior are frozen.
- Freshness / relevant dirty inputs: this claim card and the generated task board only.
- Depends on: `arch-5-final-07-post-audit-v4-performance-outcome` rolled back at `d1566af`.
- Blocks: the next fixed final candidate.
- Risk statement: reverting the product default would weaken the approved safe startup behavior; the oracle must instead distinguish initial state from the user's explicit toggle.
- Retry count / last failure class: `0 / stale test oracle`

## Product outcome

The unit contract proves that a new teacher controller starts collapsed and that a teacher can explicitly disable that startup collapse without changing product implementation.

## Scope

### Allowed write

- `tests/unit/globalLayerUi.test.tsx`
- this card and generated task board

### Forbidden write

- product source, contracts, fixtures and configuration

## Acceptance

- [ ] The test asserts the initial checkbox is checked.
- [ ] The retained click is asserted to make the checkbox unchecked.
- [ ] The stored controller expectation is `defaultCollapsed: false` after that explicit override.
- [ ] The exact focused test and diff check pass.

## Validation

- `npx vitest run tests/unit/globalLayerUi.test.tsx -t "offers a state-free scene directory"`
- `git diff --check`

## Rollback

- Revert the test-only commit; no product or persisted data changes.

## Result evidence

- Pending focused implementation and validation.
