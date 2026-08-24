# S2 Task Card — ARCH-5 Final Candidate V4 and Outcome Review

## State and assignment

- Policy version: 2
- Risk tier: S2
- Task class: final-candidate
- Necessity / skip condition: all admitted ARCH-0A through ARCH-5 work is terminal and product candidate `3bcbebf` is fixed. Run the full final sequence exactly once; if product/test/config inputs change, this candidate is invalid and must be re-established before another V4. Legacy release/W3 verifiers that require opening Project V8 are not applicable to the V9-only authoring contract and must not be used to manufacture a contradictory gate.
- Complexity delta: neutral
- Validation ceiling: V4
- Validation budget: 120 minutes
- Reviewer budget: 2
- Evidence reuse: the ARCH-4 actual Mixed PDF, focused HTML/PDF evidence and the ARCH-5 cleanup `3 files / 31 tests` remain fresh because `3bcbebf` only deleted unrelated zero-consumer code. The full V4 subsumes current focused unit/type evidence; do not rerun focused suites separately. Docs/task/generated/output-only closure edits do not invalidate product results; final repo-index quality runs after those inputs are fixed.
- Invalidating paths: all tracked product source, tests, fixtures, package/lockfile, TypeScript/Vite/Vitest/Playwright/Electron/build/release config, contracts, capability generator inputs, repo-index semantic/golden/generator/query/config and representative fixture manifest; final report/task-board/generated-only changes invalidate only their own freshness/index evidence
- Task ID: `arch-5-final-00-v4-and-outcome`
- Phase / wave: `ARCH-5 / final candidate`
- Status: `rolled-back`
- Owner / Reviewer / Integrator: `Coordinator / independent pipeline reviewer + independent representative-outcome reviewer / Coordinator`
- Claimed at / released at: `2026-08-24T20:41:43+08:00 / 2026-08-24T20:46:10+08:00`
- Worktree / branch: `shared root / codex/architecture-stabilization`
- Baseline HEAD: `1692f2f`; product candidate `3bcbebf`
- Context: all earlier phase reports/cards plus fresh ARCH-5 deletion ledger; product tree clean and no candidate-invalidating input changed after cleanup review
- Freshness / relevant dirty inputs: this claim card and generated task board only; they do not alter product or test inputs
- Depends on: `arch-5-01-remove-dead-validator-and-flow-helper` done
- Blocks: ARCH-5 closure and active goal completion
- Risk statement: this is the only full-suite/build/release-artifact run. A broad failure must be attributed to baseline, retained non-applicable Legacy tooling or the current candidate; it must not be hidden by retries, weaker assertions or a second data path.
- Retry count / last failure class: `1 / stale generated provenance evidence`

## Product outcome

One fixed Course Project V9 candidate passes the repository-wide engineering gate, produces inspectable Windows desktop artifacts, and demonstrates Slide-heavy, Flow-heavy and Mixed/Spatial open/save-reopen/play/export outcomes without claiming teacher `accepted`.

## Candidate boundary

- Product commit: `3bcbebf` on the combined stabilized branch.
- Governance/index closure before claim: `1692f2f`.
- No product/source/test/config repair is allowed inside this card. Any genuine regression reopens the narrow owning task and creates a new final candidate.
- Existing ignored output/release artifacts are evidence inputs only; source representative fixtures are never modified.

## Scope and locks

### Allowed write

- new `docs/development-plan/baselines/ARCH_5_FINAL_CANDIDATE_REPORT.md`
- this card, generated `docs/development-plan/TASK_BOARD.md`, final `repo-index/generated/**`
- ignored evidence under `output/playwright/`, existing E2E output roots and `release/verification/`
- Windows artifacts under configured `release/`
- one ignored temporary packaged-V9 smoke script under `tmp/`, deleted immediately after use

### Required read

- complete command results, all failed-test diagnostics if any, built/package artifact metadata
- three representative fixture manifest/hashes and the screenshots produced by the existing full E2E suite
- current ARCH-4 Mixed PDF evidence; current contracts/capabilities/index/task board

### Forbidden write

- all product source/tests/fixtures/config/contracts/semantic/golden facts, package/lockfile, prior phase reports/cards and user data

### Hotspot locks

- exclusive full-suite Electron/output/release and generated-index lock held by Coordinator

## One V4 sequence

1. Run `npm run verify` exactly once. It explicitly covers capability freshness, all three TypeScript projects, the complete Vitest unit/integration suite, and the complete Playwright E2E suite. The E2E pre-hook builds Player, examples/fixtures, renderer and Electron, thereby satisfying the fresh desktop build without a duplicate `build:desktop` invocation.
2. Reuse the full-suite representative tests rather than rerunning them: `architectureBaselineFlows` covers all three archives in-process; `imageReplacementVerticalSlice` covers the Slide full slice and Flow/Mixed save-reopen/current-location try-run in real Electron.
3. Package the already-built outputs once with Electron Builder for Windows x64 portable + unpacked targets; do not invoke `dist:win` because it would repeat the full build/test sequence.
4. Run one packaged V9 smoke against the unpacked executable, opening a representative V9 copy through the real preload/IPC path, checking the production protocol/security boundary and capturing under `output/playwright/`.
5. Inspect package metadata/signatures/hashes and visually inspect the latest Slide, Flow, Mixed Flow/Spatial and packaged screenshots. Reuse the one ARCH-4 Mixed PDF; do not regenerate it.
6. Write the final report/card, then generate task board and repo-index once and run the final contract, task-board, repo-index freshness and golden-quality checks on that exact closure state.

## Explicit applicability

- `scripts/verify-release.ts` and `scripts/verify-w3-windows-portability.ts` are not invoked: both construct/open Project V8 in the editor and therefore contradict the current V9-only authoring contract. Their retained Legacy ownership was not selected for deletion/migration in ARCH-4/5.
- External catalog count/license verification is not a product acceptance gate; capability freshness and the full component catalog E2E fixture remain in the mandatory sequence.
- Performance evidence is reused: cleanup deleted unreachable code and did not touch a registered hot path, performance tool, fixture or build configuration.

## Acceptance

- [ ] contract, capability, task-board and repo-index/quality checks pass
- [ ] all TypeScript, unit/integration and full E2E checks pass exactly once
- [ ] fresh Player/renderer/Electron outputs and Windows package artifacts are valid
- [ ] three representative sources retain hashes and their copy-based flows pass
- [ ] screenshots show expected Slide, Flow and Mixed/Spatial content without obvious unusable output
- [ ] pipeline, engineering, outcome, art and accepted statuses are reported separately
- [ ] no source/fixture/config/user-data mutation occurred during V4

## Validation

- Full product sequence: `npm run verify` once.
- Package-only after existing builds: `npx electron-builder --win portable dir --x64`.
- Closure checks on final docs/state: `npm run check:contracts`; `npm run check:task-board`; `npm run repo:index:check`; `npm run repo:index:quality`; `git diff --check`.
- Artifact/representative inspection uses read-only metadata, the existing full-suite outputs and one temporary packaged-V9 smoke; it does not add another product suite.

## Failure rule

- Do not rerun the full sequence merely to obtain a green result. Classify the first failure and either fix/reopen its narrow owner on a new candidate, or record a pre-existing/non-applicable retained Legacy condition with direct evidence.
- A source fixture hash change, V9 save/reopen corruption, missing Surface, Player/export regression, package startup failure or product test failure blocks completion.
- Aesthetic weakness may keep outcome at `engineering candidate`; it cannot be mislabeled `accepted`.

## Rollback

- Start point: `1692f2f` / product `3bcbebf`.
- Final report/card/generated/output/package artifacts are separable from product commits.
- Product rollback points remain each prior reviewed implementation commit; no user archive is migrated.

## Result evidence

- The single `npm run verify` attempt stopped in its first subcommand, before TypeScript, tests, builds or packaging. `check:ai-capabilities` reported only `来源溯源证据过期 generation-evidence.json`.
- Read-only hash comparison found exactly one stale recorded source: `src/renderer/export/course/buildCoursePrintArtifacts.ts` recorded `3d77c0df...`, current `0d651908...`. That file changed in reviewed ARCH-4 commits `a887469` and `c49330c`; capability content outputs were not reported stale.
- This candidate is retained as failed audit evidence and is not rerun. A narrow provenance-refresh task must produce a new clean baseline before a new final-candidate card may run V4.

## Ready checklist（Coordinator）

- [x] every admitted implementation/integration/phase task is terminal
- [x] product candidate and invalidating inputs are fixed
- [x] full command sequence is non-duplicative
- [x] representative sources are immutable and output paths are isolated
- [x] Playwright skill prerequisite `npx` is available
- [x] no product escalation or accepted decision is inferred
