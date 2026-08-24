# S1 Task Card — Collapsed Footprint And Flow TOC Recoverability

> Audit coverage: `CTRL-01`, `CTRL-02`.

## State and assignment

- Policy version: 2
- Risk tier: S1
- Task class: integration
- Necessity / skip condition: Collapsed runtime chrome still captures the full 900×64 frame and Flow TOC can translate the recovery pill outside a clipped 1280×720 stage; skip only if focused host probes already prove three-Surface pass-through and default-position TOC recoverability.
- Complexity delta: neutral
- Validation ceiling: V2
- Validation budget: 14 minutes
- Reviewer budget: 1
- Evidence reuse: Bind the two focused runtime results to the product commit; docs/task-board/generated-only changes reuse them unless a listed layout/DOM/host/test path changes.
- Invalidating paths: `src/shared/teacherControllerLayout.ts`; `src/player/teacherControllerDom.ts`; `src/player/teacherControllerRuntimeSession.ts`; `src/player/surfaces/slide/SlidePublishedAdapter.ts`; `src/player/surfaces/flow/flowRuntimeToc.ts`; `src/player/surfaces/flow/FlowSurfaceHost.ts`; `src/player/surfaces/spatial/SpatialSurfaceHost.ts`; `tests/unit/teacherControllerRuntimeSession.test.ts`; `tests/unit/flowRuntimeToc.test.ts`
- Task ID: `stab-ctrl-03-collapsed-hit-footprint`
- Phase / wave: `post-audit stabilization / B-ownership-controller`
- Status: `done`
- Owner / Reviewer / Integrator: `Controller Runtime Worker / Runtime Footprint Reviewer / Stabilization Integrator`
- Claimed at / released at: `2026-08-25 / 2026-08-25`
- Worktree / branch: `shared integration workspace with Player Controller firewall / codex/architecture-stabilization`
- Baseline HEAD: `68cfc91` (Wave A gate released and generated index fresh)
- Context: fresh `repo:context` query on `collapsed teacher controller footprint Flow TOC runtime session` returned low confidence and required Bootstrap; the prepared manual Bootstrap resolved the visible-pill geometry, three host compositions and Flow TOC clipping path before claim.
- Freshness / relevant dirty inputs: worktree and every listed product/test path were clean at claim; the regenerated index matched source, semantic, config and tool inputs.
- Hotspot lock release: Player Controller DOM/Session and Flow host locks released after product commit `a2f7386`.
- Depends on: `stab-wave-a-core-usability`
- Blocks: `stab-ctrl-06-safe-default-collapsed`; `stab-wave-b-ownership-controller`
- Retry count: `1` (independent review found that exact pill clipping hid the existing external focus ring; the same Worker added an inset keyboard focus state without expanding the pointer footprint, and re-review approved it.)

## Product outcome

In Slide, Flow and Spatial Player, a collapsed controller captures only its visible pill; in 1280×720 Flow, opening/closing TOC never makes that pill unrecoverable.

## Current fact and Session boundary

- Authored frame and `defaultCollapsed` are immutable inputs. Collapsed footprint, TOC visibility and drag offset are runtime-only projections and never write V9.
- Reuse `teacherControllerRuntimeSession.ts` visible geometry for hit bounds and constraints; do not add a second hit model or coordinate system.
- The global controller remains viewport-owned in Flow; TOC article translation must not accumulate into its Session offset.

## Scope and acceptance

- Allowed write: existing layout/DOM/runtime footprint helpers, the minimum three host adaptations, Flow TOC composition and the two named tests.
- Required read: rotation/offset constraint, stage fit and Flow root overflow.
- Forbidden write: authoring UI, Store/History, V9/Published contracts/producer, default value, TOC redesign, dependencies and generated files.
- Hotspot lock and order: `Player Controller DOM/Session` and `FlowSurfaceHost.ts` have one writer; Coordinator serializes this card with `stab-ctrl-05-mixed-runtime-session` without inventing a semantic dependency.
- Non-goals: no persisted frame resize, responsive TOC redesign, per-Flow position or CSS-only visual proof.
- Acceptance:
  - [ ] Collapsed hit bounds equal the visible rotated/offset pill; transparent former-panel space passes through on Slide, Flow and Spatial.
  - [ ] The pill still expands/drags and expanded chrome keeps its intended full hit area.
  - [ ] At 1280×720 default position, TOC open/close/reopen keeps the full pill inside the safe stage with no accumulated jump.
  - [ ] No project revision, dirty flag or persisted frame change occurs.

## Minimal validation

- `npx vitest run tests/unit/teacherControllerRuntimeSession.test.ts tests/unit/flowRuntimeToc.test.ts`
- `git diff --check`

## Result and rollback

- Start point: Wave A gate commit.
- Product/integration commit and rollback: `a2f7386`; revert that one Player/layout/test commit independently, with no persisted-data migration or parallel hitbox path.
- Result evidence: the implementation exports one shared visible-local-rect result for constraints, hit bounds and DOM footprint; collapsed wrappers clip pointer hit-testing to the rotated pill, expanded/non-collapsible chrome restores the full frame, and Slide/Flow/Spatial hosts opt into the same footprint. Flow TOC now insets only article content while the viewport overlay stays at zero inset, so repeated open/close cannot accumulate controller offset. The inset focus-visible state remains inside the clipped pill and preserves keyboard recovery without enlarging pointer capture. At integrated product commit `a2f7386`, the nine-file focused stabilization run passed 9 files / 93 tests, `npm run typecheck` passed all three TypeScript projects, and `git diff --check` passed; output contained only the registered jsdom Canvas `getContext()` warnings. The independent Runtime Footprint Reviewer approved the shared geometry, host consistency, TOC/session boundary and repaired keyboard focus behavior without rerunning the suite. Real CSS hit pass-through remains owned by the Wave B browser gate; current outcome is `engineering candidate`.
- Outcome conclusion boundary: focused evidence establishes at most `engineering candidate`.
- Stop condition: authored-position mutation or a new layout/state system requires re-scope.
- Semantic index impact: `canonical-update`
- Generated refresh: `defer-to-wave-gate`
