# S1 Task Card — Adopt the V4-Tested Render Benchmark HTML

## State and assignment

- Policy version: 2
- Risk tier: S1
- Task class: integration
- Necessity / skip condition: candidate-3 `pretest:e2e` deterministically regenerated the tracked standalone benchmark before E2E test 30 exercised those exact bytes. Adopt only that already-tested generated HTML; skip/stop if any second tracked file differs or the HTML bytes change after test completion.
- Complexity delta: neutral
- Validation ceiling: V2
- Validation budget: 8 minutes
- Reviewer budget: 1
- Evidence reuse: candidate-3 V4 proves generation order and exact behavior: `build:render-benchmark:fixture` wrote the file, then `render-host-benchmark.spec.ts` passed five render paths, 100 switches, 25 replays, capture readiness, no host leak/errors/external requests. Rerunning generator/test would add no information and could obscure the tested-byte provenance.
- Invalidating paths: `dist-player/player.iife.js`; `scripts/build-render-host-benchmark.ts`; `src/player/**`; `examples/render-host-benchmark/render-host-benchmark.html`; `tests/e2e/render-host-benchmark.spec.ts`; `package.json` pretest:e2e order
- Task ID: `arch-5-final-06-adopt-tested-render-benchmark`
- Phase / wave: `ARCH-5 / final generated closure`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Coordinator / independent tested-byte provenance reviewer / Coordinator`
- Claimed at / released at: `2026-08-24T21:57:41+08:00 / pending`
- Worktree / branch: `shared root / codex/architecture-stabilization`
- Baseline HEAD: `966d499`; tested working-tree output SHA256 `45AE90AFEBD0682B50614F63345CED9CF8E72C6989B026351B4BB55F57ED3037`
- Context: candidate 3 is otherwise complete and green; this tracked Legacy benchmark output is an explicit pretest build product, not an editor-openable V8 input or a new authoring workflow
- Freshness / relevant dirty inputs: exactly `examples/render-host-benchmark/render-host-benchmark.html`, `3,857,301` bytes, `70 insertions / 66 deletions`; written at `21:12:52`, before E2E test 30 passed at the end of the V4 run
- Depends on: candidate-3 V4 complete and green through E2E test 30
- Blocks: final report/index closure
- Risk statement: committing an untested or post-test regeneration would break candidate provenance; the task therefore forbids any regeneration and adopts only the already-tested working bytes.
- Retry count / last failure class: `0 / none`

## Product outcome

The tracked offline render-host benchmark matches the exact bundle exercised by final V4, instead of leaving a stale generated artifact or an unexplained dirty tree.

## Scope

### Allowed write

- `examples/render-host-benchmark/render-host-benchmark.html`
- this card and generated task board

### Forbidden write

- generator, Player/product source, tests, other examples/fixtures/artifacts, package/config/contracts and user data

## Acceptance

- [ ] Git diff contains only the one generated HTML before governance closure
- [ ] working SHA256 remains `45AE90...ED3037`
- [ ] generator ownership and V4 pretest-before-test ordering are directly evidenced
- [ ] candidate-3 E2E test 30 passed against these exact bytes
- [ ] independent reviewer approves adoption without a redundant rerun

## Validation

- Read-only ownership/order/hash/diff inspection and `git diff --check` only.
- Do not regenerate or rerun the benchmark: the exact dirty bytes were already exercised by candidate-3 E2E test 30 and are the subject of this adoption.

## Rollback

- Revert this generated-output commit; no source, contract or persisted user data changes.

## Result evidence

- Pending exact-scope provenance review and generated-output commit.
