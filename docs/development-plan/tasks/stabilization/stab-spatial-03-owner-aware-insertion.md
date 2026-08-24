# S2 Task Card — Owner-aware Spatial Insertion

> 本卡是任务状态唯一真相；任务板只从任务卡生成。

## State and assignment

- Policy version: 2
- Risk tier: S2
- Task class: integration
- Necessity / skip condition: 审计 `SPATIAL-01` 已确认 Spatial 全局层 UI 承诺可添加元素，而 Store 在 Spatial session 存在时优先调用 world 插入并可返回 `wrong-owner`；若 claim 时每个当前可见且公开承诺的插入入口都从明确 authoring scope/address 路由到真实 owner，且无真实入口/consumer 或不支持的 owner/type 已隐藏、只读或明确禁用，则跳过实现。
- Complexity delta: subtractive
- Validation ceiling: V2
- Validation budget: 15 minutes
- Reviewer budget: 1
- Evidence reuse: 执行后将每个支持的 Spatial 插入入口、owner、canonical delta 和一次历史绑定 product commit；仅任务卡/报告/任务板/generated 变化时复用，命中下列路由、命令或 focused 测试时失效。
- Invalidating paths: `src/renderer/ui/ElementsTab.tsx`; `src/renderer/store/editorStore.ts` 的 add text/formula/shape/image/video/component/runtime Spatial 分支；`src/renderer/course/spatialEditorCommands.ts` 的 world insert commands；`src/renderer/course/globalLayerCommands.ts`; `tests/unit/spatialProductIntegration.test.tsx`; `tests/unit/spatialEditorCommands.test.ts`
- Task ID: `stab-spatial-03-owner-aware-insertion`
- Phase / wave: `post-audit stabilization / B-ownership-controller`
- Status: `draft`
- Owner / Reviewer / Integrator: `Spatial Insertion Worker / independent owner-routing reviewer / Coordinator`
- Claimed at / released at: `— / —`
- Worktree / branch: `assigned at claim`
- Baseline HEAD: `record at claim`
- Context Pack + manifest hash | bootstrap-manual: `query Spatial Elements insertion and currently exposed owner carriers at claim`
- Freshness / relevant dirty inputs: `verify the audit paths and related user changes at claim`
- Depends on: `stab-wave-a-core-usability`
- Blocks: `stab-wave-b-ownership-controller`
- Risk statement: 同一插入按钮在错误 owner 写入会破坏全课/本表面/世界语义；修复不得复制对象模拟 owner、偷改 Schema 或让成功提示先于 canonical commit。
- Retry count / last failure class: `0 / none`

## Product outcome

教师从 Spatial 当前可见且公开承诺的插入入口添加受支持元素时，元素进入该入口明确承诺的真实 owner，并通过当前 canonical command 产生一次可撤销写入；没有真实入口/consumer 或当前 carrier 不支持的项目不被伪装成可用。

## Current fact, canonical write and non-goals

- 审计证据：ElementsTab 在全局层承诺跨场景元素，`editorStore` 的多种 add 方法却因 Spatial session 优先固定调用 `addSpatialWorld*`，world command 再正确拒绝非 world scope。
- Canonical write: 插入目标由当前 Course Project V9 authoring scope/address 和真实公开入口确定；适用时分别写该地址指向的 `globalLayerItems`、`surfaceLayerItems` 或 Spatial `world.layerItems`，并通过当前 active history 一次提交。
- 非目标：不新增 `projectMode`、通用载体、逐 location 副本、隐式 owner 降级或 V10；不要求 owner 对称，也不为没有真实入口/consumer 的 surface 新增 scope 入口或通用状态机。

## Scope, locks and acceptance

- Allowed write: ElementsTab 的 Spatial owner-aware 可用性，Store 中现有插入方法的 Spatial 路由，当前公开 owner 所需的既有 command，及两个 focused 测试。
- Required read: `authoringAddress`、effective layer owner、Spatial scope 切换、素材/组件资源事务与 order 分配。
- Forbidden write: Schema/contracts、Player/Published/export、Slide/Flow 插入语义、媒体文件对话框协议、Dependencies/generated。
- Hotspot lock: Spatial 的 Store / Properties / Clipboard / History 由同一 Coordinator/Integrator 串行接入；五张 Spatial 卡可并行调查、实现纯命令和编写独立测试，只有命中 Store / Nodes / Properties 的接入提交必须串行。
- Acceptance:
  - [ ] 每个当前可见且公开承诺的 owner/type 入口至少有一个受支持对象完成“插入 → canonical owner → selection → 一条 history → undo/redo”。
  - [ ] surface 若没有真实入口/consumer，则隐藏、只读或以 skip evidence 关闭；不得为通过矩阵而新增 scope 入口。
  - [ ] 插入不再仅因 Spatial session 存在就固定落到 world；status 文案与实际 owner 一致。
  - [ ] 不支持的 owner/type 组合禁用或不显示，并给出教师可理解的原因；不得 fallback 到另一 owner。
  - [ ] 插入后的有效 order 唯一，稳定 authoringAddress 指向实际 carrier。
  - [ ] 失败、stale、locked、容量或资源错误为零写入。

## Minimal validation

- `npx vitest run tests/unit/spatialProductIntegration.test.tsx tests/unit/spatialEditorCommands.test.ts`
- 检查当前公开 owner/type 的 canonical owner 与一次 history，并核对无 consumer 的 surface 处置，运行 `git diff --check`；不运行全量 `verify`、完整 E2E 或 `build:desktop`。

## Result and rollback

- Result evidence: `pending`; 完成时记录 product commit、各 owner 的 before/after、禁用组合、focused 结果及 Reviewer 结论。
- Outcome boundary: 只证明已公开的 Spatial 插入入口诚实且 canonical；不宣称所有元素支持所有 owner、Spatial 整体 `accepted`。
- Rollback: 以一个可独立 revert 的集成提交恢复原路由；无合同或用户数据迁移，不修改既有项目载体。
- Semantic index impact: `canonical-update`
- Generated refresh: `defer-to-wave-gate`
