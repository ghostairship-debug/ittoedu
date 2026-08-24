# S2 Task Card — ARCH-5 Final Candidate V4 and Outcome Review, Candidate 2

## State and assignment

- Policy version: 2
- Risk tier: S2
- Task class: final-candidate
- Necessity / skip condition: the first candidate stopped before product verification because provenance metadata was stale; narrow task `arch-5-final-01-refresh-ai-provenance` corrected exactly that one hash and passed independent review. Run the new fixed candidate once; any candidate-invalidating product/test/config change requires a new narrow owner and candidate.
- Complexity delta: neutral
- Validation ceiling: V4
- Validation budget: 120 minutes
- Reviewer budget: 2
- Evidence reuse: the failed candidate ran only `check:ai-capabilities`, so no TypeScript/test/build/package result is reused. ARCH-4 actual Mixed PDF and earlier focused evidence remain fresh; the new V4 subsumes focused product checks and must not duplicate them.
- Invalidating paths: all tracked product source, tests, fixtures, package/lockfile, TypeScript/Vite/Vitest/Playwright/Electron/build/release config, contracts, capability generator inputs, generated capability bundle, repo-index semantic/golden/generator/query/config and representative fixture manifest; final docs/task/generated/output-only closure changes invalidate only their own checks
- Task ID: `arch-5-final-02-v4-and-outcome`
- Phase / wave: `ARCH-5 / final candidate 2`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Coordinator / independent pipeline reviewer + independent representative-outcome reviewer / Coordinator`
- Claimed at / released at: `2026-08-24T20:49:06+08:00 / pending`
- Worktree / branch: `shared root / codex/architecture-stabilization`
- Baseline HEAD: `b3558fa`; product candidate `3bcbebf`
- Context: the deterministic capability bundle now includes the reviewed ARCH-4 print-source SHA256; all prior implementation tasks are terminal
- Freshness / relevant dirty inputs: this claim card and generated task board only; no product/test/config input is dirty
- Depends on: `arch-5-final-01-refresh-ai-provenance` done and independently approved
- Blocks: ARCH-5 closure and active goal completion
- Risk statement: this is the only broad verification/build/package run for candidate 2. Failures must remain visible and must not be erased through an unrecorded retry or source repair inside the card.
- Retry count / last failure class: `0 / none`

## Product outcome

One fixed Course Project V9 candidate passes repository-wide engineering gates, produces inspectable Windows desktop artifacts, and demonstrates Slide-heavy, Flow-heavy and Mixed/Spatial open/save-reopen/play/export outcomes without claiming teacher `accepted`.

## Candidate boundary

- Product commit: `3bcbebf`; generated-provenance baseline: `b3558fa`.
- No product/source/test/config repair is allowed inside this card. A genuine regression reopens the narrow owning task and creates another candidate.
- Existing ignored outputs are evidence inputs only; representative source fixtures are immutable.

## Scope and locks

### Allowed write

- new `docs/development-plan/baselines/ARCH_5_FINAL_CANDIDATE_REPORT.md`
- this card, generated `docs/development-plan/TASK_BOARD.md`, final `repo-index/generated/**`
- ignored evidence under `output/playwright/`, existing E2E output roots and `release/verification/`
- Windows artifacts under configured `release/`
- one ignored temporary packaged-V9 smoke script under `tmp/`, deleted immediately after use

### Forbidden write

- all product source/tests/fixtures/config/contracts/semantic/golden facts, package/lockfile, prior phase evidence and user data

### Hotspot locks

- exclusive full-suite Electron/output/release and generated-index lock held by Coordinator

## One V4 sequence

1. Run `npm run verify` once for candidate 2: capability freshness, all three TypeScript projects, complete Vitest and complete Playwright E2E. The E2E pre-hook builds Player, examples/fixtures, renderer and Electron.
2. Reuse full-suite representative coverage: `architectureBaselineFlows` covers all three archives; `imageReplacementVerticalSlice` covers the Slide full slice and Flow/Mixed save-reopen/current-location try-run in real Electron.
3. Package already-built outputs once with Electron Builder for Windows x64 portable and unpacked targets; avoid `dist:win`, which would repeat builds/tests.
4. Run one packaged V9 smoke against the unpacked executable through production preload/IPC/protocol/security boundaries and capture `output/playwright/arch-5-packaged-mixed.png`.
5. Inspect package metadata/hashes and latest Slide, Flow, Mixed Flow/Spatial and packaged screenshots. Reuse the ARCH-4 Mixed PDF without regenerating it.
6. Obtain independent pipeline and outcome reviews, write the final report/card, generate task board/repo-index once, and run exact-state closure checks.

## Explicit applicability

- Do not run `scripts/verify-release.ts` or `scripts/verify-w3-windows-portability.ts`: both construct/open Project V8 and conflict with the current V9-only authoring contract.
- External catalog exact-count/license verification is not a product acceptance gate; capability freshness and full component-catalog E2E remain mandatory.
- Reuse current performance evidence because cleanup changed no registered hot path, performance tool, fixture or build config.

## Acceptance

- [ ] contract, capability, task-board and repo-index/quality checks pass
- [ ] all TypeScript, unit/integration and complete E2E checks pass once for candidate 2
- [ ] fresh Player/renderer/Electron outputs and Windows package artifacts are valid
- [ ] three representative sources retain hashes and their copy-based flows pass
- [ ] screenshots show expected Slide, Flow and Mixed/Spatial content without obvious unusable output
- [ ] pipeline, engineering, outcome, art and accepted statuses are reported separately
- [ ] no source/fixture/config/user-data mutation occurred during V4

## Validation

- Full product sequence: `npm run verify` once for candidate 2.
- Package the existing build once: `npx electron-builder --win portable dir --x64`.
- Closure on final docs/state: `npm run check:contracts`; `npm run check:task-board`; `npm run repo:index:check`; `npm run repo:index:quality`; `git diff --check`.
- Artifact/representative inspection is read-only except one ignored temporary packaged-V9 smoke and its screenshot.

## Failure rule

- Do not rerun broad verification to obtain green. Classify the first failure and reopen its narrow owner or record a directly evidenced non-applicable Legacy condition.
- Fixture hash change, V9 save/reopen corruption, missing Surface, Player/export regression, packaged startup failure or product-test failure blocks completion.
- Aesthetic weakness may keep the outcome at `engineering candidate`; it cannot be called `accepted`.

## Rollback

- Baseline `b3558fa`; product `3bcbebf`. Final docs/generated/output/package artifacts remain separable from product history.

## Result evidence

- Pending the single candidate-2 V4, package/visual evidence, two independent reviews and exact-state generated closure.

## Ready checklist（Coordinator）

- [x] all admitted implementation/integration tasks are terminal
- [x] stale capability provenance was fixed narrowly and independently approved
- [x] candidate inputs are fixed and clean
- [x] command sequence is non-duplicative
- [x] representative sources are immutable and output paths isolated
