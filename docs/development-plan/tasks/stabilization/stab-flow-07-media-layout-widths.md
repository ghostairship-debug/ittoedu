# S2 Task Card — Flow Media Layout Widths

> 本卡是任务状态唯一真相；任务板只从任务卡生成。

## State and assignment

- Policy version: 2
- Risk tier: S2
- Task class: implementation
- Necessity / skip condition: 审计 FLOW-03 已确认紧凑/正文/宽幅三档在编辑器或 Player 中可能投影成近似相同宽度；若 Wave A 后两端已从同一现有 layout 语义产生可区分的实际 bounding rect，则跳过。
- Complexity delta: neutral
- Validation ceiling: V1
- Validation budget: 15 minutes
- Reviewer budget: 1
- Evidence reuse: focused 结果绑定 product commit；仅文档/generated 变化时复用，命中下列编辑器/Player 投影、媒体样式或 focused 测试时失效。真实 bounding rect 由 Wave C 的单一浏览器纵切统一证明。
- Invalidating paths: src/renderer/ui/FlowWorkspace.tsx; src/player/surfaces/flow/FlowSurfaceHost.ts; src/renderer/styles/globals.css; tests/unit/flowWorkspaceMedia.test.tsx; tests/unit/flowSurfaceHost.test.ts
- Task ID: stab-flow-07-media-layout-widths
- Phase / wave: post-audit stabilization / C-flow-authoring
- Status: draft
- Owner / Reviewer / Integrator: Flow Media Layout Worker / independent Editor-Player parity reviewer / Coordinator
- Claimed at / released at: — / —
- Worktree / branch: assigned at claim
- Baseline HEAD: record at claim
- Context: inspect current layout projection in Editor and Player after Wave A
- Freshness / relevant dirty inputs: verify Flow media renderer/style diffs at claim
- Depends on: stab-wave-a-core-usability
- Blocks: stab-flow-08-video-authoring-basics; stab-wave-c-flow-authoring
- Retry count: 0

## Product outcome

Flow 图片与视频的紧凑、正文、宽幅三档在 Editor 与真实 Player 中都产生一致且肉眼可辨的实际宽度，不再只是属性值变化而画面几乎不变。

## Current contract, canonical write and non-goals

- 审计依据：FLOW-03。
- 当前合同：只使用 Flow media block 已有 layout / wrap 语义，不增加宽高、object-fit 或断点字段。
- Canonical write: 属性编辑继续写回当前 media block；Editor 与 Player 各自从同一字段投影，不持久化测量值。
- 非目标：不新增 crop/focal/aspect 字段、不重做媒体属性面板、不在本卡扩展图片或视频作者能力。

## Scope, locks and acceptance

- Allowed write: Editor/Player 的现有 layout class/style 投影、必要的共享映射和最多两个 focused 单测。
- Forbidden write: contracts/schema、媒体高级字段、Published producer 结构、替换流程、Wave C E2E spec、dependencies/generated。
- Hotspot lock: FlowWorkspace 在 Wave A、公式与格式任务之后由 Coordinator 串行接入；Player renderer 可独立写。
- Acceptance:
  - [ ] 三档 layout 各自映射到确定且不同的有效宽度约束。
  - [ ] 同一 block 在 Editor 与 Player 使用同一档位语义。
  - [ ] responsive 容器内不溢出，且不靠保存瞬时 bounding rect。
  - [ ] Wave C 能对两端各三档 actual bounding rect 做单一纵切断言。

## Minimal validation

- npx vitest run tests/unit/flowWorkspaceMedia.test.tsx
- npx vitest run tests/unit/flowSurfaceHost.test.ts
- 静态核对三档映射与 Editor/Player parity，并运行 git diff --check；本卡不运行 Playwright。

## Result and rollback

- Result evidence: pending；完成时记录 product commit、三档映射表、focused 结果与 Reviewer 结论。
- Outcome boundary: V1 只证明映射实现候选；真实浏览器 actual bounding rect 由 Wave C 证明。
- Rollback: 独立 revert 映射/样式/测试提交；不改数据合同。
- Semantic index impact: canonical-update only if published capability wording changes
- Generated refresh: defer-to-wave-gate
