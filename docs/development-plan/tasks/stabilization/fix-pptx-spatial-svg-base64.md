# S1 Task Card — Spatial PPTX SVG Base64

## State and assignment

- Policy version: 2
- Risk tier: S1
- Task class: implementation
- Necessity / skip condition: Mixed/Spatial fixture 当前可复现缺失媒体与 PptxGenJS base64-header error；若 claim 时导出已含 Spatial media/relationship 且错误消失，则跳过实现并记录现状。
- Complexity delta: neutral
- Validation ceiling: V1
- Validation budget: 10 minutes
- Reviewer budget: 1
- Evidence reuse: 复用绑定 implementation product commit 的 PPTX focused 结果；后续仅任务卡、报告、task-board 或 generated 变化时不重跑。
- Invalidating paths: `src/renderer/export/course/buildCoursePptx.ts`; `src/renderer/export/base64.ts`; `tests/unit/coursePptxExport.test.ts`; `tests/fixtures/architecture-baseline/mixed-spatial.h5lesson`; PptxGenJS/export dependency or test configuration
- Task ID: `fix-pptx-spatial-svg-base64`
- Phase / wave: `current stabilization / export fix`
- Status: `claimed`
- Owner / Reviewer / Integrator: `PPTX Export Worker / Export Reviewer / Coordinator`
- Claimed at / released at: `2026-08-24T16:56:34+08:00 / —`
- Worktree / branch: `shared root / codex/architecture-stabilization`
- Baseline HEAD: `7f46423`
- Context / freshness: reproduce with the Mixed/Spatial fixture at claim; repo-index optional
- Depends on: `none`
- Blocks: Mixed/Spatial PPTX outcome green
- Retry count: `0`

## Product outcome

Mixed/Spatial PPTX contains the rendered Spatial SVG media and relationships instead of silently producing empty Spatial pages with a PptxGenJS base64-header error.

## Evidence, scope and acceptance

- Current fact: `buildCoursePptx.ts#addSpatialFramePage` passes a percent-encoded SVG data URI to PptxGenJS, which requires a `base64,` payload and omits the media while returning non-empty PPTX bytes.
- Allowed write: `src/renderer/export/course/buildCoursePptx.ts`, `tests/unit/coursePptxExport.test.ts`, and this card.
- Required read: existing base64 helper, representative Mixed/Spatial fixture and the focused export test.
- Forbidden write: Published producer, App, PDF/main, HTML/Web, Player, contracts, dependencies and shared render pipelines.
- Non-goals: no raster pipeline, new dependency, Schema change, or acceptance based only on page count/non-empty bytes.
- Acceptance: use the existing UTF-8/base64 helper; remove the header error; prove SVG media plus relationship entries in the focused test; leave other export paths untouched.
- Change / retry budget: one product file, one focused test, two-hour task timebox, at most two implementation attempts.
- Stop condition: if PptxGenJS cannot consume the existing base64 SVG without rasterization, a new dependency or shared-path changes, re-scope to S2/product review.

## Minimal validation

- `npx vitest run tests/unit/coursePptxExport.test.ts`
- Inspect the focused test's unzipped `ppt/media` and slide-relationship assertions; `git diff --check`.

## Result and rollback

- Product commit / result: pending.
- Rollback: revert the one adapter conversion from the claim baseline.
- Remaining risk: PptxGenJS SVG support only; no Published or PDF path change.
- Legacy record: `LEG-004` read-only context; no count change.
- Semantic index impact: `none`
- Generated refresh: `defer-to-wave-gate`
