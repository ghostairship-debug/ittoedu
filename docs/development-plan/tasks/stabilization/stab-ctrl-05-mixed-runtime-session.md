# S2 Task Card — Mixed Teacher Controller Runtime Session

> Audit coverage: `CTRL-03`.

## State and assignment

- Policy version: 2
- Risk tier: S2
- Task class: integration
- Necessity / skip condition: Mixed mounts three independent controller Session maps, splitting one global controller's collapse state and leaving restart incomplete; skip only if one integration probe already proves shared collapse, Surface-session offsets, restart reset and zero project writes.
- Complexity delta: subtractive
- Validation ceiling: V2
- Validation budget: 15 minutes
- Reviewer budget: 1
- Evidence reuse: Bind the single Mixed Session integration result to the product commit; docs/task-board/generated-only changes reuse it unless a listed Session/host/test path changes.
- Invalidating paths: `src/player/teacherControllerRuntimeSession.ts`; `src/player/surfaces/publishedDynamicHosts.ts`; `src/player/surfaces/mixed/MixedCourseNavigator.ts`; `src/player/surfaces/slide/SlidePublishedAdapter.ts`; `src/player/surfaces/flow/FlowSurfaceHost.ts`; `src/player/surfaces/spatial/SpatialSurfaceHost.ts`; `tests/integration/teacherControllerMixedSession.test.ts`
- Task ID: `stab-ctrl-05-mixed-runtime-session`
- Phase / wave: `post-audit stabilization / B-ownership-controller`
- Status: `done`
- Owner / Reviewer / Integrator: `Player Session Worker / Session Boundary Reviewer / Stabilization Integrator`
- Claimed at / released at: `2026-08-25 / 2026-08-25`
- Worktree / branch: `shared integration workspace with Player Controller Session firewall / codex/architecture-stabilization`
- Baseline HEAD: `1347c0b` (first Wave B lanes closed; product bytes end at `a2f7386`)
- Context Pack + manifest hash | bootstrap-manual: generated repo-index is intentionally stale after first-wave product commits; manual Bootstrap must recheck the three host Session maps, dynamic/Mixed wiring, stable controller ID and restart callback before writing.
- Freshness / relevant dirty inputs: worktree and listed product/test paths were clean at claim; the completed ctrl-03 host changes are part of the baseline and must be preserved.
- Depends on: `stab-wave-a-core-usability`
- Blocks: `stab-ctrl-06-safe-default-collapsed`; `stab-wave-b-ownership-controller`
- Risk statement: Sharing offsets across unlike surfaces causes jumps; retaining per-host collapse maps keeps duplicate truth and incomplete restart.
- Hotspot lock release: `Player Controller Session` lock released after product commit `b737820`.
- Retry count / last failure class: `1 / independent review found restart bypassed the coordinated global-interaction reset and cleared shared controller state before all Surface resets succeeded; both transaction-boundary defects were repaired before approval.`

## Product outcome

One global controller keeps collapsed/expanded state across Mixed surfaces, keeps drag offsets only within each Surface session, and returns to authored defaults after course restart without modifying the project.

## Canonical and Session boundary

- V9/Published content/frame are immutable runtime inputs.
- Course-runtime Session owns collapse by stable global controller ID; Surface-runtime Session owns offset by controller ID plus Surface session.
- Navigation preserves Session values; `course.restart` clears collapse and every offset, then rehydrates authored `defaultCollapsed` and zero offset.
- Consolidate existing maps only; no generic state machine, persisted override or dual write.

## Scope and acceptance

- Allowed write: existing controller Session helper, dynamic/Mixed host wiring, minimum three host adapters and the one named integration test.
- Required read: stable global IDs, host mount lifecycle and restart path.
- Forbidden write: V9/Published producer/contracts, authoring Store/history, persisted runtime state, dependencies and generated files.
- Hotspot lock and order: `Player Controller Session` has one writer, `Stabilization Integrator`; serialize with ctrl-03 because host files overlap, not because TOC is a product prerequisite.
- Acceptance:
  - [x] Collapse follows the controller across Slide→Flow→Spatial; offsets remain Surface-session scoped.
  - [x] Navigation away/back preserves Session state; restart clears all Session state and restores authored defaults.
  - [x] Project revision, history, archive and Published input remain byte/structure equivalent.
  - [x] Standalone single-Surface behavior remains compatible.

## Minimal validation

- `npx vitest run tests/integration/teacherControllerMixedSession.test.ts`
- `git diff --check`

## Result and rollback

- Start point: `1347c0b`.
- Product/integration commit and rollback: `b737820` (`fix(controller): unify mixed runtime session`); one commit and one revert boundary removes the three host-local maps from authority and introduces one course collapse store plus Surface-scoped offsets.
- Result evidence: at product commit `b737820`, the Mixed integration proves Slide→Flow→Spatial collapse continuity, per-Surface offset retention, navigation preservation, zero project/history/archive writes, failure rollback and subsequent successful restart to authored defaults. The integrated stabilization run passed 11 files / 165 tests, `npm run typecheck` passed and `git diff --check` passed; only the registered jsdom Canvas diagnostic remained.
- Independent review: the Session Boundary Reviewer initially blocked two restart transaction defects, then approved the repaired candidate: controller restart now dynamically dispatches through the coordinated course restart, Mixed hosts defer shared-state clearing until every Surface reset succeeds, failed restart preserves navigation/controller/global-interaction Session state, and standalone hosts retain self-clear behavior.
- Outcome conclusion boundary: integration automation establishes at most `engineering candidate`.
- Stop condition: persisted per-location state, two authoritative maps or unrelated restart changes require re-scope.
- Rollback: `git revert b737820` restores the prior host-local runtime maps and restart wiring; no persisted migration is involved.
- Semantic index impact: `canonical-update`
- Generated refresh: `defer-to-wave-gate`
