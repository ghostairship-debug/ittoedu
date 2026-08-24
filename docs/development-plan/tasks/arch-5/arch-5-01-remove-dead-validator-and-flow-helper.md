# S1 Task Card — Remove Dead V8 Validator and Flow Helper

## State and assignment

- Policy version: 2
- Risk tier: S1
- Task class: integration
- Necessity / skip condition: both exact candidates passed ARCH-5 eight-category admission at product `2834f26`. Skip/retain immediately if claim-time scan finds a new production, dynamic, IPC, release, public or compatibility consumer.
- Complexity delta: subtractive
- Validation ceiling: V2
- Validation budget: 25 minutes
- Reviewer budget: 1
- Evidence reuse: reuse `ARCH_5_DELETION_ADMISSION_REPORT.md` static/history/package matrices while its listed product/config/semantic inputs remain unchanged. Product deletion invalidates only the named focused TypeScript/test/index evidence, not ARCH-4 PDF/HTML output evidence.
- Invalidating paths: `src/renderer/project/validateProjectArchive.ts`; `src/renderer/project/createFlowCourseProject.ts`; `src/renderer/course/courseLocationCommands.ts`; `tests/unit/courseLocationCommands.test.ts`; `scripts/validate-project.ts`; `tests/unit/validateProject.test.ts`; `tests/unit/aiCapabilities.test.ts`; `package.json`; main/preload/IPC/recovery/release configs; `docs/development-plan/inventories/legacy-consumers.json`; `repo-index/semantic/features.json`; golden tasks/expected/evaluator and repo-index generator/config
- Task ID: `arch-5-01-remove-dead-validator-and-flow-helper`
- Phase / wave: `ARCH-5 / qualified cleanup`
- Status: `done`
- Owner / Reviewer / Integrator: `Coordinator / independent deletion reviewer / Coordinator`
- Claimed at / released at: `2026-08-24T20:24:10+08:00 / 2026-08-24T20:37:20+08:00`
- Worktree / branch: `shared root / codex/architecture-stabilization`
- Baseline HEAD: `5bff98e`
- Context: manual Bootstrap plus the fresh ARCH-4 repo-index; deletion targets and governance consumers were fully enumerated and independently approved by ARCH-5 admission.
- Freshness / relevant dirty inputs: product deletion fixed at `3bcbebf`; only this card, canonical Legacy/semantic/golden facts and their generated views change in the closure commit
- Depends on: `arch-5-00-deletion-admission` done
- Blocks: ARCH-5 final-candidate / V4
- Retry count / last failure class: `1 / reviewer found GT-023 symbol-query expectations did not match the intended Context Pack ranking; changed it to the existing legacy-release feature route, preserved thresholds, and received APPROVE`

## Product outcome

The repository and its generated knowledge no longer carry an unreachable V8 archive validation stack or a Flow page helper that exists only to demonstrate its own failure; current V9 validation and supported Flow page creation remain unchanged and directly covered.

## Current fact and evidence

- `validateProjectArchive.ts` has zero external runtime/type consumers; every export is file-local. The active CLI and both package aliases use `scripts/validate-project.ts` and reject V8.
- `appendBlankFlowPage` has zero production incoming consumer and one obsolete-negative test consumer; `addCourseFlowPage` is the supported, mixed-print-aware command.
- Full eight-category matrices and Git/package evidence are in `ARCH_5_DELETION_ADMISSION_REPORT.md`.

## Non-goals

- No V8 consumer migration beyond these zero-consumer targets.
- No changes to current V9 validator/report shape, contracts/Schema, package scripts, App/Store/UI, IPC, Recovery, release semantics or teacher-visible behavior.
- No deprecation adapter, facade or alternate validator.
- Do not rewrite frozen ARCH-3/4 historical reports.

## Scope and locks

### Allowed write

- delete `src/renderer/project/validateProjectArchive.ts`
- `src/renderer/project/createFlowCourseProject.ts`
- `src/renderer/course/courseLocationCommands.ts`
- `tests/unit/courseLocationCommands.test.ts`
- after the product commit: LEG-010 in `docs/development-plan/inventories/legacy-consumers.json`, `repo-index/semantic/features.json`, GT-016/023 in golden tasks/expected, this card, generated task board and `repo-index/generated/**`

### Required read

- current V9 CLI/tests, admission report, relevant package/release config and exact post-delete reference results

### Forbidden write

- `scripts/validate-project.ts`, its tests, `tests/unit/aiCapabilities.test.ts` ratchet, contracts/Schema, package/lockfile, App/Store/Workspace/Properties, main/preload, fixtures, release artifacts, other Legacy records/features/golden tasks or product behavior

### Hotspot locks

- product deletion plus semantic/golden/generated integration remain under the single Coordinator writer

## Change budget

- Task timebox: 25 minutes
- Main source files: two edits plus one deleted isolated module
- Test files: one focused test edit
- Public exports: remove only the two admitted dead exports/modules
- Deletion allowed: exact targets above
- Dependency/lockfile changes: none
- UI copy/behavior changes: none
- Schema/contract changes: no
- Generated diff: one closure refresh after semantic facts are updated
- Max implementation retries: 1

## Implementation outline

1. Reconfirm exact consumer counts at claim.
2. Delete the isolated V8 validator module and the Flow helper/import/comment; rewrite the one test around supported behavior.
3. Run focused product validation and independent deletion review; commit the product deletion as one rollback boundary.
4. Mark LEG-010 removed with the actual product commit, remove the stale semantic high-signal path, convert GT-023 to current V9 replacement proof, remove the deleted GT-016 path, and regenerate/check repo-index without weakening thresholds; the corpus quality gate stays in the final V4.
5. Close the task and hand the unchanged product candidate to the single final V4 card.

## Acceptance

- [x] deleted module and helper have no remaining production/test/dynamic/package consumer
- [x] current V9 CLI and supported Flow page behavior remain directly covered
- [x] Flow-named project factory no longer imports the Slide mutation helper
- [x] LEG-010, semantic/golden facts and generated repo-index describe the post-delete state
- [x] no compatibility layer, contract/product behavior or dependency is added

## Minimal validation

Product evidence:

1. `npx vitest run tests/unit/courseLocationCommands.test.ts tests/unit/validateProject.test.ts tests/unit/aiCapabilities.test.ts`
2. `npx tsc --noEmit`
3. scoped exact symbol/module/edge scan plus `git diff --check`

Closure-only knowledge checks: generate/check task board and generate/check repo-index. The golden corpus quality command is deferred to the single final V4; no build, Electron, E2E, full suite or representative course run here.

## Rollback

- Start point: admission closure commit
- Product deletion commit: `3bcbebf`
- Old path remains: no; direct revert restores both isolated implementations without changing persisted data

## Consumers and index

- `validateProjectArchiveBytes`: exact source definition `1 → 0`; module exports/incoming consumers `isolated file → removed`
- `appendBlankFlowPage`: production incoming `0 → 0`, test consumer files `1 → 0`, exact source/test mentions `5 → 0`
- Flow project factory → Slide mutation direct edge `1 → 0`
- Legacy record: LEG-010 `dead-candidate → removed`
- Semantic index impact: canonical-update
- Generated refresh: completed once after product/semantic closure

## Result evidence

- Product deletion commit: `3bcbebf`, `1 insertion / 309 deletions`; one isolated 285-line V8 module was removed and no replacement layer was added.
- Focused product evidence: `npx vitest run tests/unit/courseLocationCommands.test.ts tests/unit/validateProject.test.ts tests/unit/aiCapabilities.test.ts` passed `3 files / 31 tests`; `npx tsc --noEmit` passed.
- Post-delete scans: both deleted symbols are absent from `src/** scripts/** tests/** examples/**` and package/build config; the Flow factory → Slide mutation import edge is absent; diff hygiene passed.
- Independent deletion reviewer: final APPROVE, no blocker. It confirmed the current V9 CLI is untouched, the supported Flow positive assertions remain, imports are clean, and the four-path product diff stays within scope. Its one golden-routing finding was fixed: GT-023 now selects `feature:legacy-release`, whose targeted evaluator ranking places the removal record in Top 5 and the V9 CLI/package/compatibility/tests in Top 15 without changing global thresholds.
- Canonical closure: LEG-010 is `removed` with exact-zero evidence and rollback `3bcbebf`; `feature:legacy-release` no longer names the deleted file; GT-016/023 now reference only existing/current paths; task-board and repo-index were generated and checked after these inputs were fixed. Golden corpus quality remains reserved for final V4 as required by Policy v2.
- Remaining risk: only the full final-candidate suite/build and representative-course outcome review remain; no cleanup-specific product risk is open.
- Next allowed task: ARCH-5 final-candidate / V4.

## Ready checklist（Coordinator）

- [x] admission task done and reviewer APPROVE
- [x] exact targets/replacements/rollback are bounded
- [x] no product or generated writer conflict
- [x] validation stays below final V4
- [x] no product escalation triggered
