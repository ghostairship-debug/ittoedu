# S2 Task Card — Mixed Navigation Failure Atomicity

> 本卡来自 ARCH-2 phase-gate 的可复现跨系统风险；只修失败补偿，不重写 Surface host 生命周期。

## State and assignment

- Policy version: 2
- Risk tier: S2
- Task class: integration
- Necessity / skip condition: `MixedCourseNavigator` 当前在跨 Surface 跳转时先释放旧 host，再激活/定位目标；若 claim 时 activation/location 失败已经能恢复旧 host 与旧 location、保持 navigator current/history 不变并继续后续导航，则跳过实现并记录现有证据。
- Complexity delta: neutral
- Validation ceiling: V2
- Validation budget: 15 minutes
- Reviewer budget: 1
- Evidence reuse: 将 focused navigator、一个 Published V2 Mixed integration 和 root TypeScript 结果绑定到产品提交；仅任务卡/报告/生成物变化时复用，命中下列产品、测试、Player port 或测试配置时失效。
- Invalidating paths: `src/player/surfaces/mixed/MixedCourseNavigator.ts`; `tests/unit/mixedCourseNavigatorBeforeNavigate.test.ts`; `src/player/surfaces/SurfaceHost.ts`; `src/player/surfaces/publishedDynamicHosts.ts`; root TypeScript or Vitest configuration
- Task ID: `arch-2-b2-03-mixed-navigation-failure-atomicity`
- Phase / wave: `ARCH-2 / phase-gate finding`
- Status: `done`
- Owner / Reviewer / Integrator: `Mixed Navigation Worker / independent Player reviewer / Coordinator`
- Claimed at / released at: `2026-08-24T17:53:02+08:00 / 2026-08-24T18:06:42+08:00`
- Worktree / branch: `C:/Users/74755/Documents/HTML课件编辑器-worktrees/arch2-mixed-navigation-rollback / codex/arch2-mixed-navigation-rollback`
- Baseline HEAD: `38d4fd0`
- Context: Bootstrap-manual from current source plus the read-only ARCH-2 gate audit; the last generated index is intentionally deferred until the phase gate.
- Freshness / relevant dirty inputs: clean root worktree; no concurrent Player/Mixed writer
- Depends on: `arch-2-b1-13-runtime-interaction-validation-gate`, `arch-2-b2-01-cross-surface-global-playback-controls`, and `arch-2-b2-02-project-health-panel-on-demand-analysis` done
- Blocks: ARCH-2 phase gate
- Risk statement: a rejected navigation currently leaves navigator bookkeeping on the old location while the visible Player may have no active host or the target host active, so retry/back behavior and user-visible playback truth diverge.
- Retry count / last failure class: `1 / independent review found that previous-surface release failure remained outside compensation; final commit checks and compensates that result before target activation`

## Product outcome

If a Mixed course cannot activate or locate the target Surface, the teacher/player remains on the previously visible location with unchanged back history; the original failure remains visible, and a later valid navigation can still succeed normally.

## Current fact and evidence

`#transitionTo` releases the previous Surface before target activation and location. It commits `#history/#current` only afterward, but has no compensation for activation, `prepareTransition`, or location failure. The existing rejected-navigation test covers only `onBeforeNavigate`, which fails before any host mutation.

## Ownership decision

Fix `MixedCourseNavigator`, which owns previous/target identity and navigation commit timing. Keep the explicit `releaseSurfaceSession` port contract: a legal `MixedCoursePlayerPort` is not required to make `activateSurface` release the previous host. Do not change `CoursePlayer` or individual hosts.

## Scope and locks

### Allowed write

- `src/player/surfaces/mixed/MixedCourseNavigator.ts`
- focused additions in `tests/unit/mixedCourseNavigatorBeforeNavigate.test.ts`

### Required read

- `src/player/surfaces/CoursePlayer.ts` and `SurfaceHost.ts` as read-only port evidence
- the existing Published V2 Mixed navigator integration and `publishedDynamicHosts.ts` preparation/cancel ownership

### Forbidden write

- `CoursePlayer.ts`, Slide/Flow/Spatial hosts, `publishedDynamicHosts.ts`, renderer Store/UI, Schema/contracts, fixtures, performance harness, E2E, dependencies and unrelated tests

### Hotspot locks

- Mixed Player navigation: one writer; Published producer/hosts remain read-only

## Change budget

- Task timebox: 35 minutes
- Main source files: 1
- New/moved files: 0
- Public exports/types: 0 unless a private helper is insufficient
- Schema/dependency/generated changes: none
- Expected validation: two focused Vitest invocations plus root TypeScript, under 15 minutes
- Max implementation retries: 2

## Compensation contract

- Same-Surface target failure restores the previous location without suspending/reactivating that same host.
- Cross-Surface activation failure reactivates and relocates the previous Surface.
- Cross-Surface failure after target activation explicitly releases the target before reactivating and relocating the previous Surface.
- First-start failure leaves no target host falsely active when compensation is possible.
- Successful compensation still throws the original navigation failure and does not call `onNavigate` or mutate `#current/#history`.
- If compensation also fails, expose both the original and rollback failures with `AggregateError` or an equivalent causal structure; never claim atomic recovery.
- A later valid navigation remains usable and adds only its normal history entry.

## Execution steps

1. Add failing port-level assertions for target activation failure and post-activation location failure; prove current/history and active/located host state diverge before the fix.
2. Add the smallest Navigator-owned compensation around the existing transition commit point while preserving the explicit release port contract and normal call order.
3. Prove retry success and the unchanged Published V2 Mixed normal path.

## Must preserve

- serialized queue, abort and `onBeforeNavigate` semantics
- normal same-Surface and cross-Surface call order
- `prepareTransition` / outer cancellation ownership
- one successful navigation → one history entry; no history/current commit on failure
- no authoring, Schema, Store or individual host changes

## Validation

- `npx vitest run tests/unit/mixedCourseNavigatorBeforeNavigate.test.ts`
- `npx vitest run tests/integration/architectureBaselineFlows.test.tsx -t "switches every Mixed location through the Published V2 navigator"`
- `npx tsc --noEmit`
- Inspect exact scope and run commit diff check; do not run full unit/E2E/desktop suites.

## Rollback

- Start point: `38d4fd0` plus this claim commit
- Product commit: one independently revertible Navigator/test commit
- No persisted data or contract migration; reverting restores prior failure behavior

## Result evidence

- Reproduction and behavior before/after: initial port-level assertions produced `4` expected failures: activation failure left no active host, target-location failure left the target active, same-Surface failure left the visible location diverged, and rollback failure lost dual causality. A reviewer then added the missing release-failure case, which showed the old path resolving and switching to Flow. After the fix, release/activation/prepare/location failures compensate to the prior host/location before rethrowing; navigator current/history/onNavigate commit only on success, and retry adds only its normal history entry.
- Product commit: root `eb224da` (isolated-worker source `689bc38`). Only `MixedCourseNavigator.ts` and its focused unit test changed; `CoursePlayer`, hosts, Published integration and contracts remain untouched.
- Validation/review: `npx vitest run tests/unit/mixedCourseNavigatorBeforeNavigate.test.ts` passed `13/13`; the targeted Published V2 Mixed integration passed `1/1` (`4` unrelated tests skipped); `npx tsc --noEmit` and commit diff check passed. Independent Player review first rejected the unchecked previous-release result, then approved the corrected commit with no findings.
- Remaining risks: `prepareTransition` failure is covered by the same catch/compensation structure and its existing outer cancellation owner but has no duplicate focused case. An optional port with no `releaseSurfaceSession` cannot physically release a newly activated target after first-start location failure; the current product `CoursePlayer` provides the port. Existing `onNavigate` callback-throw semantics remain outside host-transition atomicity.
- Generated refresh: defer-to-ARCH-2-phase-gate
- Next allowed task: ARCH-2 phase gate

## Ready checklist（Coordinator）

- [x] dependency and reproducible gate blocker evidenced
- [x] Navigator versus Player ownership decided
- [x] allowed/forbidden paths and single writer valid
- [x] validation, compensation and rollback bounded
- [x] no contract, dependency or user-data escalation
