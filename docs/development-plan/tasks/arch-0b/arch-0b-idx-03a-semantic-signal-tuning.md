# S1 Task Card — ARCH-0B Semantic Signal Tuning

## State and assignment

- Task ID: `arch-0b-idx-03a-semantic-signal-tuning`
- Phase / wave: `ARCH-0B / quality tuning 1`
- Status: `target-green`
- Owner / Reviewer / Integrator: `Semantic Worker / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 Asia/Shanghai / —`
- Worktree / branch: `shared workspace, semantic-only scope / codex/architecture-stabilization`
- Baseline HEAD: `8a0d223e8d668849d4c5db3f5c7bb84e42000687`
- Claim commit: `fb9f4a63dc68eba549f0de0b39fef5f14fb2b099`
- Context: `fixed GT-001..025 baseline c22c6fd5 + FACT/MAP + current semantic`
- Freshness / relevant dirty inputs: query tuning is disjoint; corpus/expected/evaluator are read-only
- Depends on: `arch-0b-idx-03 golden baseline implementation at 8a0d223; IDX-01C done`
- Blocks: unchanged-corpus quality rerun
- Retry count: `0`

## Product outcome

Stable semantic records expose a small set of real journey, terminology, compiler-boundary, Catalog-boundary, consumer and test signals so Context Packs recall current evidence without copying the golden expected lists.

## Current fact and evidence

Quality baseline has no wrong-high result but misses cross-feature image replacement, the historical `activateCourseLocation` term, three-tsconfig ownership, exact App/CLI consumers and local Catalog metadata. Current Features mostly contain only 2–4 canonical paths/tests.

## Non-goals

- No query/evaluator/generated/config/package/product/contract change.
- No per-GT hardcoded record, complete import graph, or rewrite of expected evidence.

## Scope and locks

### Allowed write

- `repo-index/semantic/features.json`
- `tests/unit/repoIndexSemantic.test.ts`
- This task card

### Required read

- Fixed golden tasks/expected and quality gap report (read-only)
- FACT/MAP, Legacy ledger, V9/Published/Surface module docs
- Every added path/test in current source

### Forbidden write

- query/context/evaluator/corpus/expected/generated/config/modules/invariants/exclusions
- product/contracts/package/lockfile/other cards

### Hotspot locks

- Feature semantic single owner only.

## Change budget

- Task timebox: `1 Worker day`
- Semantic budget: at most one new evidence-backed journey Feature (total ≤22); enrich existing records with aliases and small `highSignalFiles`, `highSignalTests`, or `catalogBoundaryFiles`
- Product/dependency/UI/Schema/generated changes: `no`
- Target validation: semantic suite + path/alias/field checks; under 2 minutes
- Max implementation retries: `2`

## Implementation outline

1. Add one `feature:image-replacement-journey` from ARCH-1/FACT evidence, not from expected ordering.
2. Map `activateCourseLocation` as an evidenced terminology alias on the current Mixed Preview/location boundary; do not invent a Symbol.
3. Add three tsconfigs, adapter/config/test setup as Repo Knowledge high signals.
4. Add sparse contract/consumer/test signals to affected current Features.
5. Add local Catalog boundary files/tests under Components while keeping external source excluded.

## Acceptance

- [x] Feature count remains ≤22 and alias normalization stays unique
- [x] New journey/aliases cite current plan/source evidence
- [x] `highSignalFiles`/`highSignalTests`/`catalogBoundaryFiles` paths all exist and remain small
- [x] Repo Knowledge identifies all three tsconfigs and adapter/config/test boundaries
- [x] Components distinguishes local Catalog metadata boundary from external source
- [x] Fixed corpus/expected/query/evaluator untouched

## Minimal validation

- `npx vitest run tests/unit/repoIndexSemantic.test.ts`
- JSON/path/alias uniqueness and diff hygiene
- Coordinator runs unchanged quality only after query tuning integration

## Rollback

- Start point: `f46f48e3bdecf480be2abd0bedc82bc8e5196ffe`
- Implementation commit: not created; Worker leaves a target-green uncommitted diff for Coordinator review
- Old path remains: current 21 Feature semantic remains valid but lower recall.

## Consumers and index

- Consumer delta: semantic navigation signals only
- Legacy record IDs: `LEG-001`–`LEG-010` read-only evidence
- indexImpact: `semantic-update + regenerate`

## Result evidence

- Added the fixed optional fields `highSignalFiles`, `highSignalTests`, and `catalogBoundaryFiles` only in Feature semantic; tests enforce path existence, uniqueness, POSIX form, and budgets of `8 / 6 / 5` respectively.
- Added one evidence-backed `feature:image-replacement-journey`, bringing the Feature total to exactly 22. It links the current App/Store/Session writer chain to Media/sidecar/history, V9 save, Published preview/HTML consumers and existing high-signal tests without referencing the parallel uncommitted race-characterization test.
- Added evidenced `activateCourseLocation` terminology and Mixed location tests to `feature:preview-player`.
- Added all three tsconfigs plus package/config/adapter/test-setup signals and `typecheck`/`tsconfig`/`compiler boundary` aliases to `feature:repo-knowledge`.
- Added sparse contract, consumer and test signals to Flow, Spatial, Runtime, Interactions, Global Layers/Controller, Save/Recovery, Preview/HTML/Web/PPTX/Print, Diagnostics, DeveloperTab, Desktop IPC and Legacy Release. No Feature exceeds the signal budgets.
- Added local Components Catalog boundary paths (snapshot, main manager, shared model, renderer status and UI) plus Catalog/integrity tests; the existing external-source exclusion remains authoritative and no external implementation path was added.
- Validation: `npx vitest run tests/unit/repoIndexSemantic.test.ts` → 1 file / 5 tests passed, including temporary generator validation; JSON parse and diff hygiene passed.
- Scope: only `repo-index/semantic/features.json`, carrier/signal assertions in `tests/unit/repoIndexSemantic.test.ts`, and this card changed by this Worker. Query/context/evaluator, golden corpus/expected, generated/config, Modules/invariants/exclusions, package/lockfile, product/contracts and other cards remain untouched.

## Findings / next allowed task

- Coordinator may regenerate after the disjoint query tuning lands, then rerun the unchanged GT-001..025 quality gate.
- High-signal fields are navigation hints, not a replacement import graph and not a new dependency-policy source.
- External Catalog queries must remain low-confidence even when local Catalog boundary files are recalled.

## Ready checklist (Coordinator)

- [x] fixed gap report available
- [x] semantic lock available
- [x] expected/query files read-only
- [x] no relevant user dirty changes
- [x] no product escalation
