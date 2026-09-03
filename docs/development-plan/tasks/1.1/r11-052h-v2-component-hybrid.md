# r11-052h-v2-component-hybrid V2 Slide scene-local Component hybrid 宿主

- Status / Owner: blocked / Integrator（解除条件：r11-052g 完成并由协调者改为 queued）
- Outcome / Evidence: Component API 4 与 Published V2 正式声明 `hybrid`；当前通用 DOM mount 把 create context 硬编码为 `renderMode: 'dom'`，Slide 只把纯 `phaser` 送入 Phaser owner，导致 hybrid 静默退化。052g 完成后只补 Published V2 Slide scene-local hybrid，不宣称 Flow、Spatial 或 global hybrid。
- Write scope: `src/player/surfaces/publishedComponentMount.ts`；`src/player/surfaces/slide/publishedSlidePhaserComponentMount.ts`；`src/player/surfaces/slide/SlidePublishedAdapter.ts`；`tests/unit/publishedComponentMount.test.ts`；`tests/integration/publishedPhaserComponentSlideHostIntegration.test.ts`。禁止修改 Component API 4、Published V2 Schema、Flow/Spatial host 或能力索引；需要双实例同步时停止。
- Write locks: published-producer
- Acceptance: Slide scene-local hybrid definition 的 `create` 恰好一次，同时获得真实 `dom.root` 与 `phaser.{Phaser,scene,root}`；同一 lifecycle/generation 处理 props、resize、visibility、suspend/resume、capture、authoring target invalidation、错误隔离和 destroy，重挂载不泄漏 DOM/Canvas/事件。通用 DOM mount 只接受 `dom`；Flow、Spatial、global hybrid 明确 fallback/diagnostic，不得继续静默按 DOM 运行。既有纯 dom 与纯 phaser 行为不变。完成时删除本卡，把 `r11-052b-old-renderer-tests` 改为 queued 并重新生成任务板。
- Validation: `npx vitest run tests/unit/publishedComponentMount.test.ts tests/integration/publishedPhaserComponentSlideHostIntegration.test.ts`；`npm run typecheck`。
