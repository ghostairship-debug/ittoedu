# S2 Task Card — ARCH-5 Final Candidate V4 and Outcome Review, Candidate 3

## State and assignment

- Policy version: 2
- Risk tier: S2
- Task class: final-candidate
- Necessity / skip condition: candidate 2 exposed exactly two Vitest failures, now closed by reviewed test-only commit `580f73f` and Store fix `4560c8f`. Run the complete fixed candidate once; any product/test/config change after claim invalidates this card.
- Complexity delta: neutral
- Validation ceiling: V4
- Validation budget: 120 minutes
- Reviewer budget: 2
- Evidence reuse: candidate-2 capability/type/mostly-green Vitest is diagnostic only, not final proof. Focused repair evidence prevents redundant narrow reruns, while this V4 re-establishes the complete suite/build on one commit. Reuse the already-reviewed ARCH-4 Mixed PDF and current performance evidence.
- Invalidating paths: all tracked product source, tests, fixtures, package/lockfile, TypeScript/Vite/Vitest/Playwright/Electron/build/release config, contracts, capability generator inputs/bundle, repo-index semantic/golden/generator/query/config and representative fixture manifest; final docs/task/generated/output-only closure changes invalidate only their own checks
- Task ID: `arch-5-final-05-v4-and-outcome`
- Phase / wave: `ARCH-5 / final candidate 3`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Coordinator / independent pipeline reviewer + independent representative-outcome reviewer / Coordinator`
- Claimed at / released at: `2026-08-24T21:08:26+08:00 / pending`
- Worktree / branch: `shared root / codex/architecture-stabilization`
- Baseline HEAD: `fb595c5`; product candidate `4560c8f`
- Context: all implementation/integration repairs are terminal; candidate 3 begins clean after a deterministic first-failure record and no hidden full-suite retry
- Freshness / relevant dirty inputs: this claim card and generated task board only
- Depends on: `arch-5-final-03-update-navigation-rollback-test` and `arch-5-final-04-preserve-controller-insertion-tab` done
- Blocks: ARCH-5 closure and active goal completion
- Risk statement: this is candidate 3's only broad verification/build/package run. A failure remains visible and reopens a narrow owner; it is never repaired in place or erased by a retry.
- Retry count / last failure class: `0 / none`

## Product outcome

The fixed Course Project V9 candidate passes repository-wide engineering gates, produces inspectable Windows desktop artifacts, and demonstrates Slide-heavy, Flow-heavy and Mixed/Spatial open/save-reopen/play/export outcomes without claiming teacher `accepted`.

## Candidate boundary

- Product/test commit: `4560c8f` including ancestor test correction `580f73f`; governance baseline `fb595c5`.
- No product source, test, fixture or config repair inside this card. Existing ignored outputs are evidence only; representative sources remain immutable.

## Scope and locks

### Allowed write

- new `docs/development-plan/baselines/ARCH_5_FINAL_CANDIDATE_REPORT.md`
- this card, generated task board and final `repo-index/generated/**`
- ignored evidence under `output/playwright/`, existing E2E output roots and `release/verification/`
- Windows artifacts under configured `release/`
- one ignored temporary packaged-V9 smoke script under `tmp/`, deleted immediately after use

### Forbidden write

- all product source/tests/fixtures/config/contracts/semantic/golden facts, package/lockfile, prior phase evidence and user data

### Hotspot locks

- Coordinator holds the exclusive full-suite Electron/output/release/generated-index lock.

## One V4 sequence

1. Run `npm run verify` once: capability freshness, all three TypeScript projects, complete Vitest and complete Playwright E2E. The E2E pre-hook builds Player, fixtures/examples, renderer and Electron.
2. Reuse full-suite representative coverage: `architectureBaselineFlows` covers all three archives; `imageReplacementVerticalSlice` covers Slide full slice plus Flow/Mixed save-reopen/current-location try-run in Electron.
3. Package the already-built outputs once with `npx electron-builder --win portable dir --x64`; do not call `dist:win`, which repeats build/test.
4. Run one packaged V9 smoke through the unpacked executable's production preload/IPC/protocol/security boundary and capture `output/playwright/arch-5-packaged-mixed.png`.
5. Inspect package metadata/hashes and latest Slide, Flow, Mixed Flow/Spatial and packaged screenshots; reuse the ARCH-4 Mixed PDF.
6. Obtain independent pipeline/outcome reviews, write report/card, generate task board/repo-index once and run exact-state closure checks.

## Explicit applicability

- Do not run `scripts/verify-release.ts` or `scripts/verify-w3-windows-portability.ts`; both construct/open Project V8 and conflict with the current V9-only authoring contract.
- External catalog exact-count/license verification is not a product acceptance gate; capability freshness and complete component-catalog E2E remain mandatory.
- No performance rerun: the two repairs changed neither a registered hot path nor a performance fixture/tool/config.

## Acceptance

- [ ] capability, TypeScript, complete Vitest and complete E2E pass once on candidate 3
- [ ] fresh Player/renderer/Electron outputs and Windows portable/unpacked artifacts are valid
- [ ] three representative source hashes remain fixed and copy-based flows pass
- [ ] screenshots show expected Slide, Flow and Mixed/Spatial content without obvious unusable output
- [ ] final contracts/task-board/repo-index freshness and quality checks pass
- [ ] pipeline, engineering, outcome, art and accepted statuses are separated
- [ ] no source/fixture/config/user-data mutation occurs during V4

## Validation

- Full product sequence once: `npm run verify`.
- Package existing build once: `npx electron-builder --win portable dir --x64`.
- Final exact-state closure: `npm run check:contracts`; `npm run check:task-board`; `npm run repo:index:check`; `npm run repo:index:quality`; `git diff --check`.
- Artifact/representative inspection is read-only except one ignored temporary packaged smoke and screenshot.

## Failure rule

- Do not rerun broad verification to obtain green. Fixture hash change, V9 save/reopen corruption, Surface/Player/export regression, package startup failure or product-test failure blocks completion and reopens a narrow owner.
- Aesthetic weakness may keep outcome at `engineering candidate`; it cannot be called `accepted`.

## Rollback

- Baseline `fb595c5`; product `4560c8f`. Final docs/generated/output/package artifacts are separable; no data migration occurs.

## Result evidence

- Pending candidate-3 V4, package/visual evidence, two independent reviews and exact-state closure.

## Ready checklist（Coordinator）

- [x] both candidate-2 failures have explicit roots, commits and focused green evidence
- [x] Store reviewer final APPROVE after one blocked revision
- [x] candidate input tree is clean and fixed
- [x] broad command/package sequence is non-duplicative
- [x] representative fixtures are immutable and output paths isolated
