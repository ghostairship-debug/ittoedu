# S1 Task Card — Refresh AI Capability Provenance After ARCH-4

## State and assignment

- Policy version: 2
- Risk tier: S1
- Task class: integration
- Necessity / skip condition: final V4 attempt `arch-5-final-00-v4-and-outcome` stopped because deterministic capability provenance still recorded the pre-ARCH-4 hash of `buildCoursePrintArtifacts.ts`. Refresh only the generated provenance; skip/stop if generation changes any capability fact or any file other than generated capability evidence.
- Complexity delta: neutral
- Validation ceiling: V2
- Validation budget: 10 minutes
- Reviewer budget: 1
- Evidence reuse: the failed checker and direct stored/current SHA256 comparison already isolate one stale source record; ARCH-4 product/output review remains valid because this task changes generated metadata only.
- Invalidating paths: `src/renderer/export/course/buildCoursePrintArtifacts.ts`; `scripts/generate-ai-capabilities.ts`; `artifacts/ai-capabilities/generation-evidence.json`; external component catalog bytes
- Task ID: `arch-5-final-01-refresh-ai-provenance`
- Phase / wave: `ARCH-5 / final candidate repair`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Coordinator / independent generated-evidence reviewer / Coordinator`
- Claimed at / released at: `2026-08-24T20:46:10+08:00 / pending`
- Worktree / branch: `shared root / codex/architecture-stabilization`
- Baseline HEAD: `7713d99`
- Context: ARCH-4 commits `a887469` and `c49330c` changed print composition; all capability content files matched generation, while only deterministic source provenance was stale
- Freshness / relevant dirty inputs: failed final-card audit update and this claim card only
- Depends on: `arch-5-final-00-v4-and-outcome` rolled back after one V4 attempt
- Blocks: a newly claimed ARCH-5 final candidate
- Risk statement: regenerating broad capability facts could conceal a contract change, so the allowed diff is restricted to the one source hash in deterministic provenance.
- Retry count / last failure class: `0 / none`

## Product outcome

The generated capability bundle truthfully identifies the reviewed ARCH-4 print implementation as its current source without changing any advertised capability or protocol.

## Scope

### Allowed write

- `artifacts/ai-capabilities/generation-evidence.json`
- this task card and generated `docs/development-plan/TASK_BOARD.md`

### Forbidden write

- product source, tests, fixtures, contracts, package/config, component catalog and all non-provenance capability outputs

## Acceptance

- [ ] generation changes only the recorded SHA256 for `buildCoursePrintArtifacts.ts`
- [ ] no capability index/schema/diagnostic/limit/catalog snapshot changes
- [ ] deterministic capability check passes from the resulting tree
- [ ] independent reviewer confirms scope and attribution

## Validation

- Generate once with `npm run generate:ai-capabilities`.
- Inspect the exact diff, then run `npm run check:ai-capabilities` and `git diff --check`.
- Do not run product tests: the task changes deterministic provenance metadata only and the new final V4 owns all product verification.

## Rollback

- Revert the generated evidence and this task if any capability content changes; reopen the owning capability/ARCH-4 task instead.

## Result evidence

- Pending one deterministic generation, exact-diff inspection and independent review.
