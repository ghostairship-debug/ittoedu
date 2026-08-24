# S1 Task Card — ARCH-3 Remaining Edge Re-admission

> 本卡只复审两张首 consumer 卡后的剩余跨 Surface 边与重复实现；不把 import 改名当作架构成果。

## State and assignment

- Policy version: 2
- Risk tier: S1
- Task class: docs
- Necessity / skip condition: `arch-3-01` 与 `arch-3-02` 已完成，初次准入明确要求重新核对剩余 Flow/Spatial 边；若当前产品 HEAD 已没有剩余边或同构实现，则以零张实现卡和现状证据结束。
- Complexity delta: neutral
- Validation ceiling: V0
- Validation budget: 15 minutes
- Reviewer budget: 1
- Evidence reuse: 决定绑定 `cf846e0` 的产品源码、当前 focused tests 与直接 source/import/reference 计数；只改本卡、报告、后续任务卡或生成任务板不失效。
- Invalidating paths: `src/renderer/course/flowSharedAuthoringAdapters.ts`; `src/renderer/project/createFlowCourseProject.ts`; `src/renderer/course/courseProjectMutation.ts`; `src/renderer/course/spatialAuthoringHistory.ts`; `src/renderer/authoring/spatialWorldAuthoring.ts`; `src/renderer/authoring/v9SlideContentEdit.ts`; relevant focused tests and TypeScript resolution config
- Task ID: `arch-3-03-remaining-edge-readmission`
- Phase / wave: `ARCH-3 / remaining-edge re-admission`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Coordinator + Remaining Edge Auditor / independent re-admission reviewer / Coordinator`
- Claimed at / released at: `2026-08-24T18:49:17+08:00 / pending`
- Worktree / branch: `shared root, read-only product audit / codex/architecture-stabilization`
- Baseline HEAD: `cf846e0`
- Context: first-consumer cards and their independent reviews are done; product tree is clean and the previous repo-index remains product-fresh for admission, with exact source re-read at claim.
- Freshness / relevant dirty inputs: clean root before this claim; all product hotspots read-only
- Depends on: `arch-3-01-neutral-project-mutation-first-flow-consumer` and `arch-3-02-neutral-layer-item-hit-test-first-spatial-consumer` done
- Blocks: any second-wave ARCH-3 implementation card and ARCH-3 phase gate
- Retry count / last failure class: `0 / none`

## Product outcome

ARCH-3 continues only for remaining edges whose removal measurably reduces Surface coupling or duplicate behavior, while dead APIs, type-only tidiness and imports that cannot eliminate a boundary are explicitly retained or deferred.

## Questions to decide

1. Which remaining Flow-named consumer is online and can fully remove its Slide edge?
2. Should the dead `appendBlankFlowPage` helper migrate, remain, or become an ARCH-5 deletion candidate?
3. Is the Spatial project mutation implementation behaviorally identical to the neutral helper and sufficiently consumed to justify one compatibility alias?
4. Does the remaining Spatial content-edit edge have a real consumer and behavior-level reason for another seam?
5. Would Store or generic helper migration remove a boundary, or merely add a second import?

## Scope and locks

### Allowed write

- new `docs/development-plan/baselines/ARCH_3_RE_ADMISSION_REPORT.md`
- this card, newly admitted ARCH-3 task cards, and generated `docs/development-plan/TASK_BOARD.md`

### Required read

- current remaining import/call sites, implementations, production consumers and focused tests
- first admission report and the two completed first-consumer cards

### Forbidden write

- all product source/tests/contracts/fixtures/dependencies, existing completed cards, semantic/golden facts and generated repo-index

## Decision rules

- Admit only a behavior-preserving task that removes an entire direct Surface edge or one duplicated implementation.
- Do not modernize a production-dead API before its deletion audit.
- Do not extract types or re-exported policy with no current consumer.
- Do not migrate Store/generic calls when the existing Slide edge remains or a neutral import is merely added.

## Validation

- Exact source/import/reference counts and production-consumer classification.
- One independent re-admission review.
- `npm run generate:task-board`, `npm run check:task-board`, and `git diff --check`; no product test.

## Rollback

- Start point: `cf846e0` plus this claim commit.
- Admission docs and task cards are independently revertible; no product or persisted-data change.

## Result evidence

- Pending read-only report and independent review.

## Ready checklist（Coordinator）

- [x] both first-consumer tasks and reviews complete
- [x] read-only audit and invalidation paths bounded
- [x] no product hotspot writer required
- [x] no contract, dependency or user-data escalation
