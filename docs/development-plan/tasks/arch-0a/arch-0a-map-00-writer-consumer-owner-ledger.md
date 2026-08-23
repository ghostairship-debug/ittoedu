# S1 Task Card — ARCH-0A FACT/MAP and Legacy Inventory

## State and assignment

- Task ID: `arch-0a-map-00-writer-consumer-owner-ledger`
- Phase / wave: `ARCH-0A / wave 1`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Inventory Worker / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 Asia/Shanghai / —`
- Worktree / branch: `shared workspace, inventory-only write scope / codex/architecture-stabilization`
- Baseline HEAD: `6893d25449511ef281c9399d6dd740d126a25bb6`
- Claim commit: `commit containing this card`
- Context: `bootstrap-manual`
- Freshness / relevant dirty inputs: clean baseline; other workers have non-overlapping fixture and index scopes
- Depends on: `arch-0a-bsl-00-baseline-and-budgets (done)`
- Blocks: ARCH-0A gate; Legacy migration/deletion cards
- Retry count: `0`

## Product outcome

The program has one evidence-backed inventory of canonical carriers, writers, all consumer categories, tests, hotspot owners, Legacy replacements, deletion gates, and starting counts.

## Current fact and evidence

Plan prose identifies several debts, but no canonical current FACT/MAP ledger or unique machine-readable Legacy consumer ledger exists. Current source evidence includes the active V9 selector, V8 projection, App export/health consumers, Published V2 producer, save/recovery paths, and release verifier.

## Non-goals

- No source, test, contract, generated-index, or product behavior change.
- No inferred consumer is labeled confirmed without a path/symbol.
- No deletion or migration.

## Scope and locks

### Allowed write

- `docs/development-plan/inventories/FEATURE_CONSUMER_OWNER_LEDGER.md`
- `docs/development-plan/inventories/legacy-consumers.json`
- This task card result fields.

### Required read

- `PROJECT_COGNITION_INDEX.md`
- `docs/development-plan/20-modules/**` only as routed by the reading matrix
- `docs/development-plan/30-execution/09_LEGACY_CLEANUP_AND_DELETION_PROOF.md`
- Precise source symbols/imports and 1–3 relevant tests per high-risk journey.

### Forbidden write

- `src/**`, `tests/**`, `scripts/**`, contracts/Schema
- `package.json`, `package-lock.json`
- `repo-index/**`, other task cards and baselines

### Do not read unless needed

- Whole historical task/assessment sets and build artifacts.

### Hotspot locks

- None; read-only inspection plus canonical inventory files.

## Change budget

- Task timebox: `1 Worker day`
- Main source files: `0`
- New/moved files: `2 canonical ledgers`
- Public exports: `0`
- Deletion allowed: `no`
- Dependency/lockfile changes: `no`
- UI copy/behavior changes: `no`
- Schema/contract changes: `no`
- Generated diff: `no`
- Target tests / expected validation time: `JSON parse, path/symbol existence, Git diff hygiene; under 5 minutes`
- Max implementation retries: `2`

## Characterization

- Current successful behavior: plans point to high-value facts and preserve paths.
- Known failure: counts and consumer categories are not reproducible and no Legacy record ID can yet gate deletion.
- Async/stale/history/save/preview implications: ledger must explicitly cover all these categories without changing them.

## Implementation outline

1. Record Feature status, carrier, writers, runtime/preview/export/build/fixture/release consumers, tests, owner, replacement, and delete gate.
2. Create stable Legacy IDs with every field required by the eight deletion questions.
3. Count records and confirmed consumers by category; distinguish retained compatibility from removable Legacy debt.
4. Validate every current evidence path and preserve unknowns rather than guessing.

## Acceptance

- [ ] All current module areas and first seven high-risk journeys have an evidence entry
- [ ] Legacy ledger has stable IDs and all required fields
- [ ] Starting counts are reproducible from the ledger
- [ ] Current, target, and transitional facts are not mixed
- [ ] No product/generated/contract changes

## Minimal validation

- Parse `legacy-consumers.json` and assert stable unique IDs/required fields.
- Verify every exact evidence path exists; record symbol-only evidence separately.
- `git diff --check`
- Manual: cross-check App HTML/Web/PPTX/PDF/preflight/health and release consumers.

## Rollback

- Start point: `6893d25449511ef281c9399d6dd740d126a25bb6`
- Implementation commit: pending
- Old path remains: plan prose and manual Bootstrap remain available.

## Consumers and index

- Consumer delta: `0`; establishes starting counts.
- Legacy record IDs: created by this card.
- indexImpact: `semantic-update`

## Result evidence

- Pending Worker result.

## Findings / next allowed task

- Only confirmed records may seed migration/delete cards; unknown reachability becomes characterization work.

## Ready checklist (Coordinator)

- [x] dependsOn satisfied
- [x] Bootstrap context verified
- [x] evidence and paths valid
- [x] write locks available
- [x] budget/validation/rollback complete
- [x] no related user dirty change
- [x] no product escalation triggered
