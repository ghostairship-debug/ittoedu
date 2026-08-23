# S2 Task Card — ARCH-1 First Vertical Slice Phase Gate

## State and assignment

- Task ID: `arch-1-gate-00-first-vertical-slice`
- Phase / wave: `ARCH-1 / phase gate`
- Status: `done`
- Owner / Reviewer / Integrator: `Coordinator / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 04:21 Asia/Shanghai / done 2026-08-24 04:38 Asia/Shanghai`
- Worktree / branch: `primary gate workspace / codex/architecture-stabilization`
- Baseline HEAD: `566cce215cab8f9cb03e4dc91beb5194ad2a154c`
- Claim commit: `a61c24e64327b1bf7dd8983dc28a46344e4ef3ef`
- Context: `fresh/high image-replacement Feature Context Pack; source ac459f18, semantic d084e338, config 103c4aa4, tool 0895bc33; VS-06 completion is the semantic status delta owned here`
- Freshness / relevant dirty inputs: `clean index/worktree; gate owns semantic/ledger/report/ratchet/generated locks`
- Depends on: `ARCH-0A/0B done; VS-01–04 done; VS-05 target-green; VS-05B and VS-06A done; VS-06 wave-validated`
- Blocks: `ARCH-2 cross-Surface Feature migration`
- Retry count: `0`

## Product outcome

ARCH-1 closes only when one real image-replacement action proves stable target identity, one canonical V9 document/resource transaction, one history step, save/reopen, current-location and full Preview, HTML/Web delivery, bounded representative regressions, and a dependency ratchet that prevents the new seams from reversing.

## Scope and locks

### Allowed write

- `docs/development-plan/baselines/ARCH_1_GATE_REPORT.md`
- Image-replacement rows in `docs/development-plan/inventories/FEATURE_CONSUMER_OWNER_LEDGER.md`
- Image-replacement record in `repo-index/semantic/features.json`
- `tests/unit/repoIndexSemantic.test.ts` current-status assertion only
- `tests/unit/architectureDependencyRatchet.test.ts`
- `tests/unit/repoIndexGoldenTasks.test.ts` timeout-only reliability adjustment; corpus/evaluator/assertions remain read-only
- `artifacts/ai-capabilities/generation-evidence.json` provenance-only refresh after the Web export source fix
- VS-05/VS-06 task result status fields, this task card and generated task board
- Coordinator-generated `repo-index/generated/**`

### Forbidden write

- Product source, contracts/Schema, package/lockfile, other semantic/ledger rows, golden corpus/expected/evaluator/thresholds, representative fixtures

## Acceptance

- [x] All ARCH-1 behavior/validation task cards are wave-validated or done
- [x] Target/document/resource/history/save/reopen/Preview/HTML/Web behavior is evidenced without V8 double-write
- [x] Core/Surface/Feature seams remain narrow and a dependency ratchet forbids concrete reverse dependencies/raw Store export/old async action
- [x] Three representative projects and the saved replacement copy are valid; source hashes are unchanged
- [x] Focused/full unit/type/build/dedicated desktop checks pass at the phase boundary
- [x] Performance comparison is recorded under the ARCH-0A protocol without inventing unsupported thresholds
- [x] Consumer/owner and semantic current facts reflect the implemented path and remaining LEG-001 debt
- [x] Index/task-board/contracts/capabilities/quality checks pass after final refresh
- [x] Pipeline, engineering, outcome and accepted status are reported separately

## Minimal validation

- `npm test`
- `npm run typecheck && npm run build:desktop`
- Dedicated VS-06 `3/3` result plus focused VS-02–06 tests
- `npx tsx scripts/build-architecture-baseline-fixtures.ts --check`
- Three source validators plus saved redone-copy validator
- `npx tsx scripts/measure-architecture-baseline.ts`
- boundary ratchet test
- repo-index quality/check, task board, contracts, capabilities, diff hygiene

## Rollback

- Start point: pre-ARCH-1 tag `pre-architecture-stabilization-20260824-6c7616f`; phase implementation commits are independently listed on VS task cards
- Gate/report/generated integration commit: `b0e3715d8b2091ecd8816b6bc46712c355dee763`
- Old path remains recoverable only by reverting the single VS-05 hotspot commit; no migration or user fixture overwrite is required.

## Result evidence

- Phase decision: `pass`; detailed matrix, performance, findings, risk and status separation are in `docs/development-plan/baselines/ARCH_1_GATE_REPORT.md`.
- User behavior: exact target, cloned bytes, one mixed Slide history frame, legacy/delta alignment, ABA rejection, save/reopen, current-location/full Preview and HTML/Web parity are green. Shared original asset remains byte-identical. No contract, Schema or persisted migration changed.
- Boundaries: new `architectureDependencyRatchet` passed `4/4`; Core stays free of concrete Surface/Feature/UI, Slide history stays free of App/UI/Media/raw Store, Player stays free of renderer Store, and the old nodeId action/V8 mutation bypass cannot return unnoticed.
- Validation: full `npm test` passed `217 files / 1,338 tests`; focused gate suite passed `12 files / 112 tests`; dedicated Electron passed `3/3`; typecheck and desktop build passed; deterministic fixtures and four validators passed.
- Performance: same-machine 21-sample/5-warmup run had no first threshold breach; functional export states are unchanged and Mixed/Spatial PPTX remains explicitly red.
- Development truth: ledger and semantic image-replacement records now describe the accepted path and ARCH-2 ratchet. Final repo-index contains `670` inputs, `5,691` symbols, `14,127` edges and `1,531` tests; quality signature `6905ce034511e28c6f2adeca3cdbe3609699400eacc2be04b7ff5433919077c4` passes controlled `95%` and broad `85.38%` recall.
- Validation reliability: the golden real-corpus test timeout is now 90 seconds because the full parallel suite measured 48 seconds; standalone execution remains below 20 seconds. No quality relation, evaluator, threshold or assertion changed.
- Pipeline status `pass`; engineering status `accepted for ARCH-1`; outcome status `art candidate`; teacher/product accepted `not claimed`.
- Next allowed phase: `ARCH-2 cross-Surface Features, one real behavior per card with App/Store hotspot serialization`.

## Ready checklist

- [x] dependencies complete or wave-validated
- [x] fresh Context Pack and clean tree
- [x] semantic/ledger/generated locks available
- [x] no product or contract decision required
