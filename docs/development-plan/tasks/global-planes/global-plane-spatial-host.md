# global-plane-spatial-host Spatial 全局物理平面

- Status / Owner: active / Codex
- Risk / Hotspot: S2 / none
- Outcome / Why now: canonical 与 Published 已能给出有效全局 Underlay/Overlay，但 Spatial 作者态和 Player 仍把所有 viewport 项放进单一 HUD 且世界 SVG 自带不透明背景；本切片建立真实的 Underlay → world/surface → Overlay 物理根与同序命中链。
- Write scope / Baseline: baseline `119ed2d`；仅允许修改 `src/player/surfaces/spatial/{spatialModel,SpatialSurfaceHost}.ts`、`src/renderer/course/spatialEditorView.ts`、`src/renderer/phaser/v9SpatialHitAdapter.ts`、`src/renderer/ui/Workspace.tsx`、Spatial 专属样式和直接单元/集成/e2e 测试、本任务卡与派生任务板；禁止修改 Schema、Published producer、Flow/Slide、共享合成规则、Mixed Runtime owner、能力/Skill 文件，越界即停止。
- Acceptance: 作者态、试运行、Player 与 HTML 的 Spatial DOM 严格为 global Underlay viewport → 透明 world SVG/HTML/surface → global Overlay viewport；控制器固定 Overlay；同平面按 stackOrder；命中顺序 Overlay → surface/world → Underlay，plane 根 pointer-events:none、item 按 hitPolicy；旧 `spatial-hud-layer` 继续指向 Overlay；选择框独立高于画布；相机只作用 world 且 Mixed Runtime mount owner 不变。
- Focused validation: `npx vitest run tests/unit/spatialSurfaceHost.test.ts tests/unit/spatialSurfaceHostCtrl.test.ts tests/unit/spatialWorkspaceAuthoring.test.ts`；`npx vitest run tests/integration/courseLayerCompositionParity.test.ts tests/integration/publishedInteractionSpatialHostIntegration.test.ts tests/integration/publishedGlobalCanvasRuntimeMixedHostIntegration.test.ts`；`npm run typecheck`；`npm run build:player`；真实 Chromium 全局平面回归。
- S2 safety / rollback: 仅改渲染投影、DOM/CSS、命中排序与直接测试，不写真实课件；不触碰相机持久化或 Runtime owner，失败整体回滚本切片。
