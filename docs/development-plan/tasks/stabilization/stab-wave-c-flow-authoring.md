# S2 Task Card — Post-audit Wave C Flow Authoring Gate

> 本卡只消费实现卡证据并运行一次集成纵切；任务板只从任务卡生成。

## State and assignment

- Policy version: 2
- Risk tier: S2
- Task class: wave-gate
- Necessity / skip condition: 公式入口、格式状态/信息架构与媒体作者能力分别通过 V1 后仍可能在同一 FlowWorkspace 和真实 Player 中互相回归；只有同一 integrated product commit 已有等价的单 spec V2 证据时才跳过。
- Complexity delta: neutral
- Validation ceiling: V2
- Validation budget: 20 minutes
- Reviewer budget: 1
- Evidence reuse: 复用 `stab-wave-a-core-usability` 在产品 `0999b1c` 上的真实拖选、空块几何与完整 Electron 证据。后续 FlowWorkspace、NodesTab 和 Properties 变化命中五张依赖卡的广义 invalidating paths，因此在同一 product commit 上只刷新一次实际受影响的聚焦 consumer 合集，再运行一次本卡 E2E spec 和一次 `npm run typecheck`。仅任务卡、报告、task-board 或 generated 变化时复用。
- Invalidating paths: src/renderer/ui/FlowWorkspace.tsx; src/renderer/ui/FlowBlockContextToolbar.tsx; src/renderer/ui/PropertiesTab.tsx; src/renderer/ui/NodesTab.tsx; src/renderer/course/flowEditorView.ts; src/renderer/course/flowOverlayProjection.ts; src/renderer/course/flowEditorCommands.ts; src/player/surfaces/flow/FlowSurfaceHost.ts; src/renderer/styles/globals.css; tests/e2e/stabilizationCoreUsability.spec.ts; tests/e2e/stabilizationFlowAuthoring.spec.ts; tests/fixtures/course-project-v9/flow.h5lesson; tests/fixtures/course-project-v9/multi-asset.h5lesson; playwright.config.ts; tsconfig.json; tsconfig.e2e.json
- Task ID: stab-wave-c-flow-authoring
- Phase / wave: post-audit stabilization / C-flow-authoring gate
- Status: wave-validated
- Owner / Reviewer / Integrator: Validation Worker / independent Flow vertical-slice reviewer / Stabilization Integrator
- Claimed at / released at: `2026-08-25 / 2026-08-25`
- Worktree / branch: `shared integration workspace; validation spec is the only product-adjacent write / codex/architecture-stabilization`
- Baseline HEAD: final integrated product commit `23f2d00`; final spec commit `97d35a5`; refreshed Wave A/task closure `53d6997`.
- Context: exact-source Bootstrap covers the five dependency cards, refreshed Wave A evidence, existing Electron launch/save/archive/preview helpers, `flow.h5lesson`, `multi-asset.h5lesson`, Flow editor/Player media projections and the one new gate spec.
- Freshness / relevant dirty inputs: Wave A was freshly `wave-validated` at product `0999b1c`. Wave C then exposed and closed two narrow interaction defects: toolbar command click isolation at `d6c95fc` and inline terminal-key isolation at `23f2d00`. A fresh desktop build was produced after the final product repair. Exact current consumers passed `17/17` plus `21/21`; unrelated focused suites reuse the original `82/82` evidence because neither narrow repair changed their media/model/Player paths.
- Depends on: `stab-wave-a-core-usability`; `stab-flow-03-formula-edit-entry`; `stab-flow-04-stable-context-toolbar`; `stab-flow-05-content-outline-and-overlays`; `stab-flow-07-media-layout-widths`; `stab-flow-08-video-authoring-basics`; `stab-flow-09-toolbar-neighbor-hit-isolation`; `stab-flow-13-toolbar-command-hit-isolation`; `stab-flow-14-inline-terminal-key-isolation`
- Blocks: stab-audit-closure-gate
- Retry count / last failure class: `10 / last failure was a test-contract mismatch that forced the Player's valid local data URL to be blob-only; final rerun passed 1/1`

## Product outcome

一个真实浏览器纵切证明 Flow 的三个复合作者行为在同一候选版本中同时可用：独立公式入口稳定；真实选区驱动格式状态且正文大纲/浮层语义诚实；当前合同内的图片/视频编辑与 Editor/Player 布局一致。

## Scope, evidence and non-goals

- Allowed write: 本任务卡与单一 tests/e2e/stabilizationFlowAuthoring.spec.ts。
- Required evidence: Wave A 文本交互证据，以及 flow-03/04/05/07/08 各自绑定同一 integrated commit 的 focused 结果。
- Forbidden write: 产品代码、contracts/schema、Published producer、依赖、其他 E2E spec、repo-index 或其他 generated；`TASK_BOARD.md` 只由 Integrator 在 claim/closure 运行生成器更新。
- Non-goals: 不重复依赖卡单测、不验证 inline formula 或高级媒体字段、不扩充 E2E 行为数量、不阻塞 Wave D 独立任务。
- Hotspot order: 依赖实现必须按“选区/空块 → 页面 inert → 公式 → 工具栏/媒体”完成；本门只在最终集成后读取。

## Acceptance

- [x] 单一 spec 最多包含三个复合行为：公式；格式/信息架构；媒体。
- [x] 公式行为覆盖首次重渲染后两次真实 click 与显式入口。
- [x] 格式/信息架构行为复用 Wave A 的真实 range，验证 range-only 格式、mixed 状态、正文顺序与 overlay z-order 分离。
- [x] 媒体行为覆盖当前合同字段、替换/controls，并比较 Editor 与真实 Player 三档 actual bounding rect。
- [x] `npm run typecheck` 只运行一次；后续产品修复仅刷新被命中路径的 renderer/E2E TypeScript legs 与精确 focused consumers。

## Minimal validation

- 静态核对五张依赖卡、Wave A 与 `stab-flow-09` 证据。
- `npx vitest run tests/unit/flowWorkspace.test.tsx tests/unit/flowProductIntegration.test.tsx tests/unit/flowBlockContextToolbar.test.tsx tests/unit/flowUnifiedLayerEntry.test.tsx tests/unit/flowEditorView.test.ts tests/unit/flowUnifiedLayers.test.tsx tests/unit/flowWorkspaceMedia.test.tsx tests/unit/flowSurfaceHost.test.ts tests/unit/flowMediaBlockEdit.test.ts`
- `npm run typecheck`
- `npx playwright test tests/e2e/stabilizationFlowAuthoring.spec.ts --list`
- `npx playwright test tests/e2e/stabilizationFlowAuthoring.spec.ts --workers=1`
- 核对 spec 仅含三个复合行为并运行 `git diff --check`；不运行全量 verify、完整 E2E 或包构建。最终产品修复后只刷新一次 `23f2d00` 的 desktop artifact，直接 Playwright 复用该产物。

## Result and rollback

- Result evidence: integrated product `23f2d00`; final spec `97d35a5`. The initial nine-file affected set passed `82/82` at `0999b1c`. After the two exact interaction repairs, `flowWorkspace.test.tsx` passed `17/17` and the toolbar/product-integration pair passed `21/21` on the final product. The one mandated `npm run typecheck` passed on the original integrated candidate; after renderer/spec invalidation, renderer TypeScript and E2E TypeScript passed separately, while the fresh desktop build also passed Electron TypeScript. The build emitted only the pre-existing inline-dynamic-import and large-chunk warnings. `--list` reports one test, and source inspection confirms exactly three `test.step` blocks in one Electron app/profile/archive. The final real Electron run passed `1/1` in about one minute with the strict diagnostics gate intact. Formula entry, native range/mixed formatting, saved exact runs/revision, content-outline/overlay separation, current media authoring fields, same-kind replacement, controls, local asset resolution and Editor/Player three-tier actual rects all completed in one session. The measurement derives query-container content width from the computed box model and derives visual scale from border-box `offsetWidth`, so a vertical scrollbar is not misclassified as a transform. Player accepts its two valid local URL representations (`blob:` or typed `data:`), while the no-external-request gate remains authoritative. The independent Wave C Reviewer concluded `APPROVE` at product `23f2d00` / spec `97d35a5`: structure is exactly one test / three steps / one app / one temp profile / one archive, the box-model correction and local URL assertions match Editor/Published V2/Player behavior, and no product or spec blocker remains.
- Pipeline status: pass at product `23f2d00` / spec `97d35a5`.
- Outcome status: `engineering candidate`; automation proves only the three scoped Flow authoring outcomes, not whole-product visual acceptance.
- Outcome boundary: V2 只证明这三个 Flow 作者纵切达到 engineering candidate；不证明未覆盖能力、整体视觉或产品体验 accepted。
- Rollback: E2E spec 可独立 revert；若集成失败，按首次失败行为回退对应依赖任务提交，不在门卡修改产品代码。
- Semantic index impact: none
- Generated refresh: `task-board at claim and closure`
