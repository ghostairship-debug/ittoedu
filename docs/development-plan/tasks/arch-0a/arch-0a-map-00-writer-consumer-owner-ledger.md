# S1 Task Card — ARCH-0A FACT/MAP and Legacy Inventory

## State and assignment

- Task ID: `arch-0a-map-00-writer-consumer-owner-ledger`
- Phase / wave: `ARCH-0A / wave 1`
- Status: `done`
- Owner / Reviewer / Integrator: `Inventory Worker / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 Asia/Shanghai / 2026-08-24 Asia/Shanghai`
- Worktree / branch: `shared workspace, inventory-only write scope / codex/architecture-stabilization`
- Baseline HEAD: `6893d25449511ef281c9399d6dd740d126a25bb6`
- Claim commit: `3bb5c746dd46e6b2b4e7a2110c6fc6b2d67e44dd`
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

- [x] All current module areas and first seven high-risk journeys have an evidence entry
- [x] Legacy ledger has stable IDs and all required fields
- [x] Starting counts are reproducible from the ledger
- [x] Current, target, and transitional facts are not mixed
- [x] No product/generated/contract changes

## Minimal validation

- Parse `legacy-consumers.json` and assert stable unique IDs/required fields.
- Verify every exact evidence path exists; record symbol-only evidence separately.
- `git diff --check`
- Manual: cross-check App HTML/Web/PPTX/PDF/preflight/health and release consumers.

## Rollback

- Start point: `6893d25449511ef281c9399d6dd740d126a25bb6`
- Implementation commit: `58238d48cef99ca0806d6bfa3f2c300e53803c6c`
- Old path remains: plan prose and manual Bootstrap remain available.

## Consumers and index

- Consumer delta: `0`; establishes a starting inventory of `10` Legacy records, `116` confirmed consumer relations, and `104` unique confirmed `path#symbol` endpoints.
- Legacy record IDs: `LEG-001` through `LEG-010`.
- indexImpact: `semantic-update`

## Result evidence

- Added canonical Feature/writer/consumer/owner ledger at `docs/development-plan/inventories/FEATURE_CONSUMER_OWNER_LEDGER.md`: 19 current module areas and first seven high-risk journeys, with exact evidence paths and explicit current/target/unknown separation.
- Added canonical machine-readable Legacy ledger at `docs/development-plan/inventories/legacy-consumers.json`: stable unique IDs, all seven deletion-proof consumer categories on every record, replacement/removal/zero-reference/persisted-compatibility/tests/stable-since/rollback/indexImpact fields, and reproducible starting counts.
- Baseline split: `5 active-debt`, `2 reachability-unproven`, `2 retained-compatibility`, `1 dead-candidate`. No retained V8 fixture is represented as product V8-open support.
- Validation: JSON parse; required-field/category/unique-ID/count assertions; all JSON and Markdown evidence paths; textual `path#symbol` resolution; all recorded zero-reference observed counts; new-file and tracked `git diff --check` hygiene.
- Scope check: only the two canonical inventory files and this task card are changed by this task; no source, test, script, package, contract, generated-index, baseline, or other task-card write.
- Coordinator review: independently recalculated all 116 category relations and 104 unique endpoints, verified all JSON paths/tests exist, reran every zero-reference query with exact matching counts, and reviewed all ten status/replacement/removal/persisted-compatibility summaries.

## Findings / next allowed task

- Only confirmed records may seed migration/delete cards; unknown reachability becomes characterization work.
- `LEG-003` App no-source Preview/HTML/Web and `LEG-005` PDF raster fallback retain `reachability-unproven`; do not create a sessionless V9 state to keep them alive.
- `LEG-008` V8 archive/example/release toolchain and `LEG-009` V8 test helper are retained compatibility records, not deletion approvals and not product import support.
- `LEG-010` has definition-only static evidence, but deletion still waits for generated index, dynamic/config/package, and release inspection proof.

## Ready checklist (Coordinator)

- [x] dependsOn satisfied
- [x] Bootstrap context verified
- [x] evidence and paths valid
- [x] write locks available
- [x] budget/validation/rollback complete
- [x] no related user dirty change
- [x] no product escalation triggered
