# S2 Task Card — ARCH-2 B1-03 Published Interaction Controller Core

> 本卡是任务状态唯一真相；only Coordinator integrates/closes it.

## State and assignment

- Task ID: `arch-2-b1-03-published-interaction-controller`
- Phase / wave: `ARCH-2 / W2-B1 pure Published Interactions`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Player Interactions Worker / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 Asia/Shanghai / pending`
- Worktree / branch: `shared workspace, new player/interactions-only scope / codex/architecture-stabilization`
- Baseline HEAD: `db21bb6`
- Claim commit: `pending`
- Context Pack + manifest hash | bootstrap-manual: `feature:interactions; fresh/high/safe-for-S2; source 16556796, semantic 2616aecc`
- Freshness / relevant dirty inputs: `new Player interaction paths clean; Published hosts/producer locked out`
- Depends on: `ARCH-2 W2-A gate done`
- Blocks: `Published Interaction host integration`
- Risk statement: `Published V2 carries rules but no current host executes them; a copied legacy engine would duplicate formats and can steal Runtime/Component gestures.`
- Retry count / last failure class: `0 / none`

## Product outcome

A Store-independent Published controller executes the smallest standard click rule subset through a Surface-owned node/navigation port, with cancellation, ordering, diagnostics and teardown, without directly mutating arbitrary DOM or authoring state.

## Supported first slice

- trigger: enabled `node.click`;
- condition: none or current Slide `scene.in`;
- actions: `node.enter`, `node.exit`, `scene.go/next/previous/replay`, `course.restart`;
- standard step timing: delay plus `after-previous` / `with-previous`; terminal navigation stops later actions;
- unsupported trigger/action/condition is diagnosed and skipped honestly.

## Surface port boundary

- `bindNodeClick(nodeId, listener)` returns disposer/null and honors carrier gesture ownership in the later host adapter.
- `executeNodeMotion(action, signal)` returns success; controller does not set arbitrary DOM styles.
- Navigation is an injected Published session port; no renderer Store or V8 PlayerScene.
- One AbortController per rule execution; repeated trigger cancels previous run; destroy cancels timers/listeners idempotently.

## Scope and locks

### Allowed write

- New `src/player/interactions/PublishedInteractionController.ts`
- New `src/player/interactions/PublishedInteractionSurfacePort.ts`
- New `tests/unit/publishedInteractionController.test.ts`
- This task card result fields

### Required read

- Interaction V1 contract and old `InteractionEngine` timing only as donor behavior
- Published Course V2 navigation/session ports and diagnostic shape

### Forbidden write

- Renderer/Store/UI, old InteractionEngine/PlayerScene
- Published producer, CoursePlayer/session or any Surface host
- Contracts/Schema, Runtime/Component code, package/lockfile, fixtures, repo-index

## Validation

- click binding, condition, serial/parallel timing and terminal navigation;
- repeat cancellation, destroy cleanup, motion/navigation failure diagnostics;
- unsupported rule parts are explicit, no silent success;
- author-hidden/location/camera visibility remains Surface-port responsibility;
- no renderer Store dependency ratchet; focused tests and `npx tsc --noEmit`.

## Rollback

- Pure controller has no host consumer until integration and can be reverted independently.

## Result evidence

- Pending Worker implementation and review.
