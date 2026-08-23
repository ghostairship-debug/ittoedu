# S1 Task Card — ARCH-0B Semantic Recall Tuning

## State and assignment

- Task ID: `arch-0b-idx-03c-semantic-recall-tuning`
- Phase / wave: `ARCH-0B / quality tuning 2`
- Status: `done`
- Owner / Reviewer / Integrator: `Semantic Worker / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 Asia/Shanghai / done 2026-08-24 03:05 Asia/Shanghai`
- Worktree / branch: `shared workspace, semantic-only scope / codex/architecture-stabilization`
- Baseline HEAD: `531d8d589391613b17414bbb0ed4f1dbd6fe68f0`
- Claim commit: `1d7027fa939b46059e7b4053273bf10096fc19f9`
- Context: `unchanged corpus correctness signature fe47d786 + per-task required-recall gaps`
- Freshness / relevant dirty inputs: ranking tuning is disjoint; corpus/expected/evaluator read-only
- Depends on: `arch-0b-idx-03a done; corrected quality evaluator at 531d8d5`
- Blocks: unchanged-corpus quality rerun 2
- Retry count: `0`

## Product outcome

Existing Feature records recall a bounded set of canonical contracts and high-signal tests required to verify the current behavior, without adding more Features or copying complete expected sets.

## Current fact and evidence

After tuning wave 1, task Hit@5 is 100% but Recall@15 is 72.5%/66.15%. Remaining misses cluster around V9/Published contracts, save/preview tests, Flow media/product tests, compiler configs, desktop/E2E, Legacy compatibility proof and local Catalog tests.

## Non-goals

- No query/ranker/evaluator/corpus/expected/generated/config/package/product change.
- No new Feature, call graph, or per-task exact ordering.

## Scope and locks

### Allowed write

- `repo-index/semantic/features.json`
- `tests/unit/repoIndexSemantic.test.ts`
- This task card

### Required read

- Corrected quality report/signature and current per-task missing relations
- FACT/MAP, Legacy ledger and current test/contract paths

### Forbidden write

- query/context/evaluator/corpus/expected/generated/config/modules/package/product/contracts

### Hotspot locks

- Feature semantic only.

## Change budget

- Task timebox: `1 Worker day`
- Feature count fixed at 22; no new aliases unless needed for current terminology
- `highSignalFiles` max 12, `highSignalTests` max 8, Catalog boundary max 5
- No dependency/UI/Schema/generated change
- Max implementation retries: `2`

## Implementation outline

1. Add shared V9/Published contract paths to the Features that consume them.
2. Add sparse current high-signal tests for image/save/preview/Flow/delivery/desktop/Legacy/Catalog.
3. Add renderer/player/vitest/playwright configs to Repo Knowledge evidence.
4. Add local Catalog ledger/tests without changing external-source status.

## Acceptance

- [x] Feature count/alias uniqueness unchanged
- [x] Every added path exists and is justified by current module/consumer evidence
- [x] Signal budgets remain bounded
- [x] Image/Flow/Save/Preview/Delivery/Desktop/Repo/Legacy/Catalog recall classes covered
- [x] Corpus/expected/query/evaluator untouched by this task

## Minimal validation

- `npx vitest run tests/unit/repoIndexSemantic.test.ts`
- Path/budget/alias/diff checks
- Coordinator full unchanged quality after ranking tuning

## Rollback

- Start point: `68163868df08abb6aab647971429af513cfee87c`
- Implementation commit: `54cf7e7d5ebc2e3b992b48a8241ccbddc7a1168a`
- Old path remains: wave-1 semantic is safe but below recall gate.

## Consumers and index

- Consumer delta: semantic validation signals only
- Legacy record IDs: read-only evidence
- indexImpact: `semantic-update + regenerate`

## Result evidence

- Preserved the exact 22-Feature ID order, every canonical-file order and all confidence/status semantics. No Feature, alias, module or external-source claim was added.
- Added sparse current signals for the corrected gaps: the image replacement journey now recalls the V9 carrier plus Media/Session tests; Flow recalls media/product/archive tests; Components recalls Published mounting and local Catalog tests; Save/Preview/HTML/PPTX recall V9/Published contracts, build evidence and the Legacy ledger where applicable.
- DeveloperTab now recalls the retained Legacy `projectSchema`; Desktop recalls renderer asset/component consumers, E2E and Electron compiler boundary; Repo Knowledge recalls renderer/player Vite, Vitest and Playwright configs; Legacy release recalls compatibility policy, render benchmark and format-isolation tests.
- Kept the five-path Catalog boundary intact, including the ambiguous UI/status evidence required by the current query contract; added the canonical owner ledger as a separate Components high-signal file. No external component repository was invented.
- Budget result: maximum `highSignalFiles=11/12`, `highSignalTests=7/8`, `catalogBoundaryFiles=5/5`; every signal list is duplicate-free and every path exists.
- Validation: `npx vitest run tests/unit/repoIndexSemantic.test.ts` passed `1 file / 5 tests`, including exact Feature order/count, alias uniqueness, path existence, budgets, targeted signal locks and temporary-directory generator validation. `git diff --check` passed.
- Scope: this task changed only `repo-index/semantic/features.json`, `tests/unit/repoIndexSemantic.test.ts` and this card. Concurrent query/context-pack/query-test writes are disjoint and were not modified. Corpus, expected, evaluator, modules, generated facts, package and product files remain untouched by this task.
- indexImpact: `semantic-update + regenerate`; Coordinator owns the unchanged-corpus quality rerun and generated refresh.
- Coordinator integration gate passed twice on the unchanged corpus: controlled Recall@15 `95%`, broad Recall@15 `85.38%`, Hit@5 `100%`, and no forbidden, wrong-high or confidence mismatch. This task's bounded semantic signals are accepted; generated refresh remains owned by the ARCH-0B phase gate.

## Ready checklist (Coordinator)

- [x] corrected gap list fixed
- [x] semantic lock available
- [x] expected/query read-only
- [x] no product escalation
