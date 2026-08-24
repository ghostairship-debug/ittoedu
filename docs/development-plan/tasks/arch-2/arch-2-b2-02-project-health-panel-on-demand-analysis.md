# S1 Task Card — Project Health Panel On-demand Analysis

## State and assignment

- Policy version: 2
- Risk tier: S1
- Task class: implementation
- Necessity / skip condition: `ProjectHealthPanel` is permanently mounted and invokes health, information-release and visual-density analysis before its closed-state return; if claim-time evidence shows the closed Panel already invokes none of its three collectors while the open Panel uses the latest project, skip implementation and record the existing behavior.
- Complexity delta: subtractive
- Validation ceiling: V1
- Validation budget: 10 minutes
- Reviewer budget: 1
- Evidence reuse: bind the focused component result to the product commit; reuse across task-card/report/task-board/generated-only changes, and invalidate only when the Panel, focused test, collector signatures, editor Store hook behavior, or React/Vitest configuration changes.
- Invalidating paths: `src/renderer/ui/ProjectHealthPanel.tsx`; `tests/unit/projectHealthPanel.test.tsx`; `src/shared/projectHealth.ts`; `src/shared/informationRelease.ts`; `src/shared/visualDensity.ts`; `src/renderer/store/editorStore.ts`; React/Vitest configuration
- Task ID: `arch-2-b2-02-project-health-panel-on-demand-analysis`
- Phase / wave: `ARCH-2 / W2-B2 Diagnostics on-demand analysis`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Diagnostics UI Worker / independent UI reviewer / Coordinator`
- Claimed at / released at: `2026-08-24T17:31:10+08:00 / —`
- Worktree / branch: `C:/Users/74755/Documents/HTML课件编辑器-worktrees/arch2-b2-panel-on-demand / codex/arch2-b2-panel-on-demand`
- Baseline HEAD: `8c3c177`
- Context: bootstrap-manual from fresh repo-index `16c787f`; later commits changed admission/task docs only, and the exact Panel/App source was re-read at claim
- Freshness / relevant dirty inputs: clean root worktree; no concurrent `ProjectHealthPanel.tsx` or focused-test writer
- Depends on: `arch-2-b2-00-remaining-domain-admission` done
- Blocks: ARCH-2 W2-B2 and phase gate
- Retry count: `0`

## Product outcome

Keeping the Engineering Health panel closed performs none of that Panel's full health, information-release or visual-density analyses; opening it computes current results and preserves the existing summary, navigation and export controls.

## Current fact and evidence

`App.tsx` always mounts the Panel. In `ProjectHealthPanel.tsx`, Store subscriptions and all three `useMemo` analyses occur before `if (!open) return null`, so every project/package identity change performs hidden work. App's separate Toolbar health summary is a retained current consumer and remains out of scope.

## Non-goals

No V8→V9 diagnostic migration, collector optimization, cache, new Diagnostics API/framework, App change, Store change, Toolbar summary change, report/code/navigation change or visual redesign.

## Scope and locks

### Allowed write

- `src/renderer/ui/ProjectHealthPanel.tsx`
- new `tests/unit/projectHealthPanel.test.tsx`

### Required read

- the Panel's permanent mount in `src/renderer/App.tsx`
- current collector contracts and existing Store test setup

### Forbidden write

- App, Store, shared collectors, diagnostics navigation/codes, contracts/Schema, other UI/styles/tests, dependencies and task-board/generated files

### Do not read unless needed

- Legacy diagnostic inventories and frozen task history; this card does not migrate their ownership

### Hotspot locks

- none; the Panel file has one isolated writer

## Change budget

- Task timebox: 25 minutes
- Main source files: 1
- New/moved files: one focused test; no moves
- Public exports: 0; a private open-only child is allowed
- Deletion allowed: hidden-state collector subscriptions/work only
- Dependency/lockfile changes: no
- UI copy/behavior changes: none while open; closed state remains visually null
- Schema/contract changes: no
- Generated diff: none; defer repo-index refresh to the ARCH-2 gate
- Target tests / expected validation time: one focused Vitest file, under 10 minutes
- Max implementation retries: 2

## Implementation outline

Split or gate the expensive content behind an `open=true` mount boundary so the outer closed component returns before Store subscriptions and collector hooks. Add one focused test that observes the three Panel-owned collectors across closed→open and verifies the existing summary appears.

## Acceptance

- [ ] Closed `ProjectHealthPanel` invokes its own three analysis functions zero times.
- [ ] Opening uses the current project/package state and renders the existing health summary.
- [ ] App's Toolbar summary call remains untouched and is not asserted away.
- [ ] Open-state locate/export/copy and all shared collector behavior remain unchanged.
- [ ] No public API, cache, framework or unrelated file is added.

## Minimal validation

- `npx vitest run tests/unit/projectHealthPanel.test.tsx`
- Inspect exact scope and run `git diff --check`; do not run broad product/E2E/desktop checks.

## Rollback

- Start point: `8c3c177` plus this claim commit
- Implementation commit: one product/test commit
- Old path remains: rollback remounts the existing component behavior; no data or contract migration exists

## Consumers and index

- Consumer delta: hidden Panel collector invocations `3 → 0`; App Toolbar `collectProjectHealth` remains `1`
- Legacy record IDs: `LEG-006` / `LEG-007` retained and unchanged
- Semantic index impact: none
- Generated refresh: defer-to-wave-gate

## Result evidence

- Actual change/product commit and evidence key: pending
- Behavior before/after: pending
- Validation results: pending
- Consumer delta: pending
- Remaining risks: pending
- Rollback commit or start point: `8c3c177`
- Next allowed task: ARCH-2 W2-B2 / phase gate after global-controls task also closes

## Findings / next allowed task

No adjacent Diagnostics migration is allowed in this card.

## Ready checklist（Coordinator）

- [x] dependsOn satisfied
- [x] context fresh or Bootstrap verified
- [x] evidence and paths valid
- [x] write lock available
- [x] budget/validation/rollback complete
- [x] no related user dirty change
- [x] no product escalation triggered
