# S1 Task Card — ARCH-0B Semantic Signal Tuning

## State and assignment

- Task ID: `arch-0b-idx-03a-semantic-signal-tuning`
- Phase / wave: `ARCH-0B / quality tuning 1`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Semantic Worker / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 Asia/Shanghai / —`
- Worktree / branch: `shared workspace, semantic-only scope / codex/architecture-stabilization`
- Baseline HEAD: `8a0d223e8d668849d4c5db3f5c7bb84e42000687`
- Claim commit: `commit containing this card`
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

- [ ] Feature count remains ≤22 and alias normalization stays unique
- [ ] New journey/aliases cite current plan/source evidence
- [ ] `highSignalFiles`/`highSignalTests`/`catalogBoundaryFiles` paths all exist and remain small
- [ ] Repo Knowledge identifies all three tsconfigs and adapter/config/test boundaries
- [ ] Components distinguishes local Catalog metadata boundary from external source
- [ ] Fixed corpus/expected/query/evaluator untouched

## Minimal validation

- `npx vitest run tests/unit/repoIndexSemantic.test.ts`
- JSON/path/alias uniqueness and diff hygiene
- Coordinator runs unchanged quality only after query tuning integration

## Rollback

- Start point: `f46f48e3bdecf480be2abd0bedc82bc8e5196ffe`
- Implementation commit: pending
- Old path remains: current 21 Feature semantic remains valid but lower recall.

## Consumers and index

- Consumer delta: semantic navigation signals only
- Legacy record IDs: `LEG-001`–`LEG-010` read-only evidence
- indexImpact: `semantic-update + regenerate`

## Result evidence

- Pending.

## Ready checklist (Coordinator)

- [x] fixed gap report available
- [x] semantic lock available
- [x] expected/query files read-only
- [x] no relevant user dirty changes
- [x] no product escalation
