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
- Status: `claimed`
- Owner / Reviewer / Integrator: `Player Session Worker / Session Boundary Reviewer / Stabilization Integrator`
- Claimed at / released at: `2026-08-25 / not released`
- Worktree / branch: `shared integration workspace with Player Controller Session firewall / codex/architecture-stabilization`
- Baseline HEAD: `1347c0b` (first Wave B lanes closed; product bytes end at `a2f7386`)
- Context Pack + manifest hash | bootstrap-manual: generated repo-index is intentionally stale after first-wave product commits; manual Bootstrap must recheck the three host Session maps, dynamic/Mixed wiring, stable controller ID and restart callback before writing.
- Freshness / relevant dirty inputs: worktree and listed product/test paths were clean at claim; the completed ctrl-03 host changes are part of the baseline and must be preserved.
- Depends on: `stab-wave-a-core-usability`
- Blocks: `stab-ctrl-06-safe-default-collapsed`; `stab-wave-b-ownership-controller`
- Risk statement: Sharing offsets across unlike surfaces causes jumps; retaining per-host collapse maps keeps duplicate truth and incomplete restart.
- Retry count / last failure class: `0 / none`

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
  - [ ] Collapse follows the controller across Slide→Flow→Spatial; offsets remain Surface-session scoped.
  - [ ] Navigation away/back preserves Session state; restart clears all Session state and restores authored defaults.
  - [ ] Project revision, history, archive and Published input remain byte/structure equivalent.
  - [ ] Standalone single-Surface behavior remains compatible.

## Minimal validation

- `npx vitest run tests/integration/teacherControllerMixedSession.test.ts`
- `git diff --check`

## Result and rollback

- Start point: Wave A gate commit.
- Product/integration commit and rollback: pending; one commit and one revert boundary, with old per-host maps removed from authority.
- Result evidence: pending single integration result; Wave B owns real-browser runtime integration.
- Outcome conclusion boundary: integration automation establishes at most `engineering candidate`.
- Stop condition: persisted per-location state, two authoritative maps or unrelated restart changes require re-scope.
- Semantic index impact: `canonical-update`
- Generated refresh: `defer-to-wave-gate`
