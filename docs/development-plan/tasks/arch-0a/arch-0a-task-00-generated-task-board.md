# S1 Task Card — ARCH-0A Generated Task Board

## State and assignment

- Task ID: `arch-0a-task-00-generated-task-board`
- Phase / wave: `ARCH-0A / bootstrap tooling`
- Status: `done`
- Owner / Reviewer / Integrator: `Coordinator / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 Asia/Shanghai / 2026-08-24 Asia/Shanghai`
- Worktree / branch: `primary workspace / codex/architecture-stabilization`
- Baseline HEAD: `c3a2510`
- Claim commit: `68612648ada6330f270a4538bd62f95c44216318`
- Context: `bootstrap-manual`
- Freshness / relevant dirty inputs: three claimed cards may change only their own status/results; generator must tolerate current card set deterministically
- Depends on: `arch-0a-bsl-00-baseline-and-budgets (done)`
- Blocks: ARCH-0A automatic task-state visibility
- Retry count: `0`

## Product outcome

Task cards remain the only writable task state while a deterministic generated board exposes the current queue and fails when stale.

## Current fact and evidence

Task-card location and board rules are active, and the first cards now exist, but no task-board generator, check, or `TASK_BOARD.md` exists.

## Non-goals

- No parallel task database, claim service, scheduler, or product runtime feature.
- No editing of other task statuses.
- No repo-index facts/query implementation.

## Scope and locks

### Allowed write

- `scripts/generate-task-board.ts`
- `tests/unit/taskBoardGenerator.test.ts`
- `docs/development-plan/TASK_BOARD.md` (generated only)
- `package.json` scripts only
- This task card.

### Required read

- Task protocol and task templates
- All current `docs/development-plan/tasks/**/*.md` headers/fields

### Forbidden write

- Other task cards, product source, contracts, lockfile
- `repo-index/**`, generated product/capability artifacts

### Hotspot locks

- Task-board generated view; Coordinator only.

## Change budget

- Task timebox: `half Coordinator day`
- Main source files: `1 script + 1 focused test + package scripts + generated board`
- Public exports: parsing/render helpers for tests only
- Deletion/dependency/UI/Schema changes: `no`
- Generated diff: `TASK_BOARD.md only`
- Target tests / expected validation time: `focused unit + generate/check + diff hygiene, under 2 minutes`
- Max implementation retries: `2`

## Characterization

- Task cards contain stable bullet fields and are the state truth.
- Board is missing; readers would otherwise scan every card or hand-copy statuses.

## Acceptance

- [x] Generator discovers cards recursively and validates stable unique IDs/statuses
- [x] Board includes phase, status, owner, dependency, blockers, and outcome without becoming writable truth
- [x] Ordering and LF output are deterministic with no HEAD/time/absolute path
- [x] `--check` never writes and fails on stale/malformed board
- [x] Package scripts expose generate/check without lockfile change

## Minimal validation

- `npx vitest run tests/unit/taskBoardGenerator.test.ts`
- `npm run generate:task-board && npm run check:task-board`
- `git diff --check`

## Rollback

- Start point: `c3a2510`
- Implementation commit: the commit containing the generator, focused tests, generated board, and this result update
- Old path remains: task cards can still be read directly.

## Consumers and index

- Consumer delta: adds one read-only development view.
- Legacy record IDs: none
- indexImpact: `regenerate` after ARCH-0B integration

## Result evidence

- Behavior before/after: readers previously had to scan every task card and no stale-view check existed; the generated Markdown board now derives all writable state from cards and detects card changes.
- Validation: `npx vitest run tests/unit/taskBoardGenerator.test.ts` — 3/3 pass; generate then check pass; all three TypeScript project checks pass; `git diff --check` passes.
- Determinism/safety: stable sorting and LF output; committed board contains no HEAD, timestamp, absolute path, or machine identity; check mode only reads and compares.
- Consumer delta: one development-only generated view and two package script entrypoints; no product consumer.
- Remaining risk: task-card field names are intentionally a strict protocol; a future protocol change must update the generator and focused tests together.
- Rollback: revert the implementation commit; task cards remain directly readable.

## Ready checklist (Coordinator)

- [x] dependsOn satisfied
- [x] Bootstrap context verified
- [x] evidence and paths valid
- [x] generated-view lock available
- [x] budget/validation/rollback complete
- [x] no related user dirty change
- [x] no product escalation triggered
