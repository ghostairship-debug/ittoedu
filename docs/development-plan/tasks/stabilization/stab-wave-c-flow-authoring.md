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
- Status: claimed
- Owner / Reviewer / Integrator: Validation Worker / independent Flow vertical-slice reviewer / Stabilization Integrator
- Claimed at / released at: `2026-08-25 / not released`
- Worktree / branch: `shared integration workspace; validation spec is the only product-adjacent write / codex/architecture-stabilization`
- Baseline HEAD: product commit `0999b1c`; refreshed Wave A/task closure `53d6997`; worktree clean at claim.
- Context: exact-source Bootstrap covers the five dependency cards, refreshed Wave A evidence, existing Electron launch/save/archive/preview helpers, `flow.h5lesson`, `multi-asset.h5lesson`, Flow editor/Player media projections and the one new gate spec.
- Freshness / relevant dirty inputs: Wave A is freshly `wave-validated` on `0999b1c`; the fresh desktop artifact from that same product commit is reusable. The exact affected focused consumers named below must be refreshed once because their declared invalidators changed after their original V1 evidence; no unrelated suite is rerun.
- Depends on: `stab-wave-a-core-usability`; `stab-flow-03-formula-edit-entry`; `stab-flow-04-stable-context-toolbar`; `stab-flow-05-content-outline-and-overlays`; `stab-flow-07-media-layout-widths`; `stab-flow-08-video-authoring-basics`; `stab-flow-09-toolbar-neighbor-hit-isolation`
- Blocks: stab-audit-closure-gate
- Retry count / last failure class: `0 / not yet run`

## Product outcome

一个真实浏览器纵切证明 Flow 的三个复合作者行为在同一候选版本中同时可用：独立公式入口稳定；真实选区驱动格式状态且正文大纲/浮层语义诚实；当前合同内的图片/视频编辑与 Editor/Player 布局一致。

## Scope, evidence and non-goals

- Allowed write: 本任务卡与单一 tests/e2e/stabilizationFlowAuthoring.spec.ts。
- Required evidence: Wave A 文本交互证据，以及 flow-03/04/05/07/08 各自绑定同一 integrated commit 的 focused 结果。
- Forbidden write: 产品代码、contracts/schema、Published producer、依赖、其他 E2E spec、repo-index 或其他 generated；`TASK_BOARD.md` 只由 Integrator 在 claim/closure 运行生成器更新。
- Non-goals: 不重复依赖卡单测、不验证 inline formula 或高级媒体字段、不扩充 E2E 行为数量、不阻塞 Wave D 独立任务。
- Hotspot order: 依赖实现必须按“选区/空块 → 页面 inert → 公式 → 工具栏/媒体”完成；本门只在最终集成后读取。

## Acceptance

- [ ] 单一 spec 最多包含三个复合行为：公式；格式/信息架构；媒体。
- [ ] 公式行为覆盖首次重渲染后两次真实 click 与显式入口。
- [ ] 格式/信息架构行为复用 Wave A 的真实 range，验证 range-only 格式、mixed 状态、正文顺序与 overlay z-order 分离。
- [ ] 媒体行为覆盖当前合同字段、替换/controls，并比较 Editor 与真实 Player 三档 actual bounding rect。
- [ ] 仅运行一次 `npm run typecheck`；依赖证据只刷新被后续 invalidating path 命中的聚焦 consumer 合集一次。

## Minimal validation

- 静态核对五张依赖卡、Wave A 与 `stab-flow-09` 证据。
- `npx vitest run tests/unit/flowWorkspace.test.tsx tests/unit/flowProductIntegration.test.tsx tests/unit/flowBlockContextToolbar.test.tsx tests/unit/flowUnifiedLayerEntry.test.tsx tests/unit/flowEditorView.test.ts tests/unit/flowUnifiedLayers.test.tsx tests/unit/flowWorkspaceMedia.test.tsx tests/unit/flowSurfaceHost.test.ts tests/unit/flowMediaBlockEdit.test.ts`
- `npm run typecheck`
- `npx playwright test tests/e2e/stabilizationFlowAuthoring.spec.ts --list`
- `npx playwright test tests/e2e/stabilizationFlowAuthoring.spec.ts --workers=1`
- 核对 spec 仅含三个复合行为并运行 `git diff --check`；不运行全量 verify、完整 E2E 或包构建。直接 Playwright 复用产品 `0999b1c` 的新鲜 desktop artifact，不重复构建。

## Result and rollback

- Result evidence: pending；完成时记录 integrated product commit、Wave A/依赖证据引用、typecheck、单 spec 结果与 Reviewer 结论。
- Outcome boundary: V2 只证明这三个 Flow 作者纵切达到 engineering candidate；不证明未覆盖能力、整体视觉或产品体验 accepted。
- Rollback: E2E spec 可独立 revert；若集成失败，按首次失败行为回退对应依赖任务提交，不在门卡修改产品代码。
- Semantic index impact: none
- Generated refresh: `task-board at claim and closure`
