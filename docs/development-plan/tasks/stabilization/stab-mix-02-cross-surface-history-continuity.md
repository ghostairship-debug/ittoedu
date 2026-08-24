# S2 Task Card — Mixed Cross-Surface History Continuity

> Audit coverage: `MIX-02`.

## State and assignment

- Policy version: 2
- Risk tier: S2
- Task class: integration
- Necessity / skip condition: Spatial content survives Spatial→Slide→same Spatial navigation but undo/redo is lost when a fresh Surface session opens; skip only if one integration probe already preserves canonical undo/redo, rejects stale overwrite and keeps camera outside history.
- Complexity delta: subtractive
- Validation ceiling: V2
- Validation budget: 15 minutes
- Reviewer budget: 1
- Evidence reuse: Bind the one cross-Surface integration result to the product commit; docs/task-board/generated-only changes reuse it unless the listed Store/Spatial-session/spec paths change.
- Invalidating paths: `src/renderer/store/editorStore.ts`; `src/renderer/course/spatialEditorCommands.ts`; `tests/integration/mixedCrossSurfaceHistory.test.tsx`
- Task ID: `stab-mix-02-cross-surface-history-continuity`
- Phase / wave: `post-audit stabilization / B-ownership-controller`
- Status: `draft`
- Owner / Reviewer / Integrator: `Mixed History Worker / Canonical History Reviewer / Stabilization Integrator`
- Claimed at / released at: `not claimed / not released`
- Worktree / branch: `isolated worker worktree; integration on codex/architecture-stabilization`
- Baseline HEAD: `d2371aa` (refresh after Wave A)
- Context Pack + manifest hash | bootstrap-manual: `bootstrap-manual`
- Freshness / relevant dirty inputs: Root audit/plan/generated changes are read-only; characterize current Store session opening at claim.
- Depends on: `stab-wave-a-core-usability`
- Blocks: `stab-wave-b-ownership-controller`
- Risk statement: Reusing stale Surface state can overwrite newer canonical content; creating another history or persisting camera would create duplicate truth.
- Retry count / last failure class: `0 / none`

## Product outcome

After a Spatial edit, switching to Slide and returning to that Spatial surface preserves undo/redo over the same canonical Course Project; camera movement remains Session-only.

## Canonical and Session boundary

- Store's one Course Project V9 document and one logical action history remain authoritative across navigation.
- Spatial session may carry selection/draft/camera view but must rebind to the current project/revision; it does not own a competing project history.
- Camera pan/zoom produces no V9 revision/history/save/export change. This card does not add a camera-retention policy.

## Scope and acceptance

- Allowed write: `editorStore.ts`, the existing Spatial session/history command seam and the one named integration spec.
- Required read: Surface switch/open, stale generation/revision guard, undo/redo and save source.
- Forbidden write: Slide/Flow command refactor, second history/project copy, camera persistence, owner/clipboard behavior, App/save recovery, contracts, dependencies and generated files.
- Hotspot lock and order: `Store/History` has one writer, `Stabilization Integrator`; serialize with other Store cards by lock, not additional product dependencies.
- Acceptance:
  - [ ] Spatial edit→Slide→same Spatial→undo/redo removes/restores exactly that edit on one revision/history sequence.
  - [ ] Returning with stale Surface state cannot overwrite a later canonical edit.
  - [ ] The same integration spec proves camera pan/zoom creates no canonical history, revision or save diff.
  - [ ] Save/reopen preserves content and intentionally starts a new editor history session.

## Minimal validation

- `npx vitest run tests/integration/mixedCrossSurfaceHistory.test.tsx`
- `git diff --check`

## Result and rollback

- Start point: Wave A gate commit.
- Product/integration commit and rollback: pending; one Store integration commit and one revert boundary, with no double-write period.
- Result evidence: pending single integration result covering history, stale state and camera exclusion.
- Outcome conclusion boundary: V2 establishes at most `engineering candidate`; Wave B owns browser integration.
- Stop condition: camera product-policy change, App/save ownership or contract change requires re-scope.
- Semantic index impact: `canonical-update`
- Generated refresh: `defer-to-wave-gate`

