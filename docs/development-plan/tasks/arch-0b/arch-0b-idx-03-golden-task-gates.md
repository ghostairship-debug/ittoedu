# S1 Task Card — ARCH-0B IDX-03 Golden Task Gates

## State and assignment

- Task ID: `arch-0b-idx-03-golden-task-gates`
- Phase / wave: `ARCH-0B / wave 4`
- Status: `implementing`
- Owner / Reviewer / Integrator: `Quality Worker / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 Asia/Shanghai / —`
- Worktree / branch: `shared workspace, golden-corpus/evaluator-only scope / codex/architecture-stabilization`
- Baseline HEAD: `d6fe7e0c57e480f4eed35dc55e0fd5adf893b2a6`
- Claim commit: `47e79cce01904dfc5580e45871fdd4b637892659`
- Context: `fresh repo:context + 25-task corpus design + Bootstrap comparison`
- Freshness / relevant dirty inputs: clean worktree; repo:index and task board fresh
- Depends on: `arch-0b-idx-02-query-context-pack (done)`
- Blocks: ARCH-0B exit; ARCH-2 broad multi-agent gate
- Retry count: `1; evaluator Feature/free-text exactness correction after Coordinator review`

## Product outcome

Twenty-five evidence-backed real tasks quantify whether repo-index improves navigation without high-confidence misdirection, with a recorded 15-task controlled milestone and a hard broad-dispatch gate.

## Current fact and evidence

No current golden-task corpus, expected path/contract/test set, evaluator, Hit@5/Recall@15 metrics, Bootstrap comparison, or quality command exists.

## Non-goals

- No brittle single exact ranking.
- No fabricated historical result or semantic tuning that hides a failed query.
- No product source, contract, or generated-fact change.

## Scope and locks

### Allowed write

- `repo-index/golden-tasks/tasks.json`
- `repo-index/golden-tasks/expected.json`
- `scripts/repo-index/evaluateGoldenTasks.ts`
- `tests/unit/repoIndexGoldenTasks.test.ts`
- `package.json` quality script only
- `docs/development-plan/baselines/ARCH_0B_INDEX_QUALITY.md`
- This task card.

### Required read

- Frozen historical task titles/evidence only as routed by the current plan
- Current query/context output and strict manifest
- Current module/journey inventory and high-signal tests/contracts

### Forbidden write

- Product source/contracts/lockfile
- semantic/generated facts, query implementation, other cards

### Hotspot locks

- None; corpus/evaluator only. Coordinator owns any follow-up semantic or generated refresh.

## Change budget

- Task timebox: `2 Worker days`
- Main source files: `2 corpus files + evaluator + focused test + evidence`
- Public exports: evaluator DTO only
- Deletion/dependency/UI/Schema/generated changes: `no`
- Target tests / expected validation time: `25-task quality run + deterministic rerun + Bootstrap comparison, under 5 minutes`
- Max implementation retries: `2`; semantic tuning attempts: `3`

## Characterization

- Corpus must cover Slide, Flow, Spatial, Media, Components, Runtime/Interaction, layers/controller, save/recovery, Preview/Player/HTML/Web/PPTX/PDF/DOCX, diagnostics, DeveloperTab, main/preload/IPC, and all three tsconfigs.
- Expected data records must-appear and forbidden-high-rank evidence, not a unique order.

## Acceptance

- [x] First 15-task controlled milestone recorded before the 25-task gate
- [x] 25 tasks cover every required module and desktop/compiler boundary
- [x] Canonical file Hit@5 ≥ 90%
- [ ] Required contract/high-signal test Recall@15 ≥ 85%
- [x] High-confidence wrong answer count = 0
- [x] Generation < 10 seconds, query P95 < 2 seconds, same inputs byte-identical
- [x] Low confidence and external Catalog source queries correctly degrade
- [x] Bootstrap time/context-volume comparison shows observable improvement

## Minimal validation

- Focused golden evaluator tests
- Quality command twice with identical results
- `npm run repo:index:check`, `npm run check:task-board`, and diff hygiene
- Manual audit of every high-confidence result and every fallback.

## Rollback

- Start point: IDX-02 completion commit
- Implementation commit: pending; hard quality gates failed, so this card remains implementing and no commit was created
- Old path remains: manual Bootstrap is mandatory if gates fail.

## Consumers and index

- Consumer delta: adds a quality gate for development tooling
- Legacy record IDs: none
- indexImpact: `none unless findings require a separate Coordinator semantic update`

## Result evidence

- Added immutable 25-task corpus and separate expected evidence under `repo-index/golden-tasks/`; first 15 are explicitly `controlled-15`, final 10 are `extended-25`.
- Added evaluator `scripts/repo-index/evaluateGoldenTasks.ts` with unique mode-aware ranked paths, task-level Hit@5, diagnostic `canonicalRecallAt5`, Recall@15, forbidden/high-confidence/fallback checks, P95/generation/determinism, and reproducible Bootstrap locator/path-byte comparison.
- Added `npm run repo:index:quality` and focused `tests/unit/repoIndexGoldenTasks.test.ts`; focused suite passes 1 file / 4 tests.
- Recorded controlled and broad results in `docs/development-plan/baselines/ARCH_0B_INDEX_QUALITY.md` before any tuning. Expected evidence was not reduced or rewritten after observation.
- Controlled 15: task Hit@5 `13/15 = 86.67%` (fail), canonical relation recall at 5 `36/75 = 48.0%` diagnostic, required Recall@15 `30/80 = 37.5%` (fail), high-confidence wrong `0`, forbidden Top 5 `0`, expected low-confidence `1/1`, one expectation mismatch (`GT-002`).
- Broad 25: task Hit@5 `21/25 = 84.0%` (fail), canonical relation recall at 5 `55/125 = 44.0%` diagnostic, required Recall@15 `52/130 = 40.0%` (fail), high-confidence wrong `0`, forbidden Top 5 `0`, expected low-confidence `4/4` including external `GT-024/025`, one expectation mismatch (`GT-002`).
- Zero-hit tasks: controlled `GT-001/002`; broad adds `GT-020/025`. Every task has at least one required Recall@15 miss; remaining tasks have partial canonical coverage.
- Performance/determinism pass with large margin: query P95 `<11 ms`, generation max `<1.3 s`, temporary generations byte-identical, repeated query signature identical.
- Context volume: 15-task Context Packs `98,474` bytes versus Bootstrap expected read paths `4,495,567` bytes; 25-task `165,905` versus `7,189,215`. Locator timings are reported separately and are not represented as human time.
- `npm run typecheck` passed all three TypeScript projects. `repo:index:check` and `check:task-board` were run read-only and are expected stale because corpus/package/evaluator/card inputs have not been regenerated/integrated by the Coordinator.
- Correctness retry after semantic-signal tuning kept corpus/expected/thresholds unchanged and fixed evaluator-only mode semantics: Feature/free-text no longer rank their broad alphabetical `matchedFiles`/`matchedSymbols` set as exact; symbol/path/changed remain exact-first. The focused suite again passed `1 file / 4 tests`.
- Corrected controlled 15: task Hit@5 `15/15 = 100%` (pass), canonical relation recall at 5 `55/75 = 73.33%` diagnostic, required Recall@15 `58/80 = 72.5%` (fail), high-confidence wrong/forbidden/expectation mismatch `0/0/0`, low-confidence `1/1` correct.
- Corrected broad 25: task Hit@5 `25/25 = 100%` (pass), canonical relation recall at 5 `86/125 = 68.8%` diagnostic, required Recall@15 `86/130 = 66.15%` (fail), high-confidence wrong `0`, expectation mismatch `0`, low-confidence `4/4` correct, and one real forbidden Top 5 hit in `GT-024` (fail).
- Corrected quality signature: `fe47d786c024aec000e28615c8ff35cfcdaae583c9b5de5b7490c12f8807f3fd`; temporary generation hash matched at `sha256:4201ce8aa87b0c8333e91d92641a0b40c72536b8634c21bdb5203fc28faed6a4`, query determinism passed, query P95 remained `<17 ms`, and generation max was `1,270.98 ms`.
- The task remains `implementing`: controlled/broad Recall@15 are below 85%, and broad forbidden Top 5 is nonzero. No query, semantic, corpus, expected, threshold, generated fact, package or product file was changed for this retry.

## Findings / next allowed task

- Broad multi-agent dispatch remains blocked. Do not change the corpus or expected sets to pass.
- The semantic-signal tuning plus evaluator correction removed all zero-hit and expectation gaps. Remaining bounded work is relation recall for `GT-001/002/003/004/006/010/011/012/013/014/017/018/019/020/022/023/024/025` and the `GT-024` forbidden UI Top 5 relation; do not change the corpus or expected sets to pass.
- After tuning, rerun the unchanged quality corpus twice. This card may move to target-green only when both the controlled and broad hard gates pass.

## Ready checklist (Coordinator)

- [x] IDX-02 done and index fresh
- [x] 25 evidence-backed task candidates selected
- [x] corpus/evaluator scope and budget validated
- [x] no relevant user dirty changes
- [x] no product escalation
