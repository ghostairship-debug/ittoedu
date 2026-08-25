# S0 Task Card — Align Spatial Global-insertion Copy Oracle

## State and assignment

- Policy version: 2
- Risk tier: S0
- Task class: implementation
- Necessity / skip condition: final candidate 07 exposed an assertion from before owner-aware Spatial insertion landed. Skip only if the unit oracle already expects the approved world/surface/global wording; its global expectation is stale.
- Complexity delta: neutral
- Validation ceiling: V1
- Validation budget: 6 minutes
- Reviewer budget: 0
- Evidence reuse: independent diagnosis traced current copy to `59f5fdc` and existing Spatial product-integration coverage already proves disabled entries and zero writes. Reuse those facts; run only the exact affected test and a diff check.
- Invalidating paths: `tests/unit/editorFormattingUi.test.tsx`; `src/renderer/ui/ElementsTab.tsx`; Spatial insertion-scope derivation
- Task ID: `arch-5-final-09-align-spatial-insertion-copy-oracle`
- Phase / wave: `ARCH-5 / post-audit candidate repair`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Spatial UI Test Owner / none / Coordinator`
- Claimed at / released at: `2026-08-25T11:10:25+08:00 / not released`
- Worktree / branch: `shared root / codex/architecture-stabilization`
- Baseline HEAD: `d1566af`; candidate 07 is rolled back and the tree is clean.
- Context: test-only freshness repair; the approved owner-aware product copy is frozen.
- Freshness / relevant dirty inputs: this claim card and the generated task board only.
- Depends on: `arch-5-final-07-post-audit-v4-performance-outcome` rolled back at `d1566af`.
- Blocks: the next fixed final candidate.
- Risk statement: restoring the old generic copy would erase the actionable switch-to-world guidance and contradict the current Spatial ownership model.
- Retry count / last failure class: `0 / stale test oracle and missed invalidation refresh`

## Product outcome

The unit contract matches the approved owner-aware Spatial global-scope guidance while retaining disabled-entry, unavailable-carrier and zero-write assertions.

## Scope

### Allowed write

- `tests/unit/editorFormattingUi.test.tsx`
- this card and generated task board

### Forbidden write

- product source, contracts, fixtures and configuration

## Acceptance

- [ ] The global-scope hint expects the current complete switch-to-world sentence.
- [ ] Existing disabled, unavailable and zero-write assertions remain intact.
- [ ] The exact focused test and diff check pass.

## Validation

- `npx vitest run tests/unit/editorFormattingUi.test.tsx -t "makes Spatial entries click-only"`
- `git diff --check`

## Rollback

- Revert the test-only commit; no product or persisted data changes.

## Result evidence

- Pending focused implementation and validation.
