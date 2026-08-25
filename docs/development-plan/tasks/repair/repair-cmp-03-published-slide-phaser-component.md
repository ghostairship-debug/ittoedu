# repair-cmp-03-published-slide-phaser-component Slide 场景 Phaser Component 真实发布播放

- Status / Owner: active / codex/repair-cmp-03
- Risk / Hotspot: S2 / none
- Outcome / Why now: 教师可通过真实组件导入和 Slide authoring command 创建、编辑、保存 Component API 4 Phaser 实例，Published V2 producer 也已携带代码与素材；但 Slide host 当前对 `renderMode: phaser` 无条件显示静态后备，阻塞 sample、render-host benchmark、portability 与 release verifier 的 V9/V2 替代行为门。
- Write scope / Baseline: baseline `c6b386911097c80f8bb0cb1eae15e81edca91c7f`；仅允许新建一个 Slide scene-local Published Phaser Component mount，窄改 `src/player/surfaces/publishedComponentMount.ts` 的包解析/API 4 context 共性、`src/player/surfaces/slide/SlidePublishedAdapter.ts` 的 scene 路由和生命周期，以及新增 V9 fixture、unit/integration 与 `tests/e2e/publishedPhaserComponentV2.spec.ts`；禁止修改 Schema、Published producer、App/main/preload、Flow/Spatial/global/shared host、capture/PDF/PPTX、Legacy PlayerApp/renderNode 与 generated 输出。
- Acceptance: fixture 通过真实组件导入及 Slide component authoring command 创建 scene-local API 4 Phaser 实例；当前位置、整课预览、离线/在线单 HTML 与网页包执行同一真实组件 host；context 只暴露声明的 Phaser 面，画面、命中、emit、props、frame、order 正确；跨 generation、暂离/恢复、replay、restart 与 session destroy 无残留 Canvas、RAF、监听器或 Game，停止 loop 后 Core DESTROY 仍恰好一次；注册/create/lifecycle 失败只隔离当前实例并显示一次后备。
- Focused validation: `npx vitest run tests/unit/publishedComponentMount.test.ts tests/unit/buildPublishedCourseV2.test.ts <新增 mount/integration 测试>`；`npm run typecheck`；`npm run build:player && npx playwright test tests/e2e/publishedPhaserComponentV2.spec.ts`。
- S2 safety / rollback: 全部使用内存或临时 V9 fixture；回滚起点为 active 时记录的新 baseline。若需要改变 global/shared、Flow/Spatial、capture、producer、合同或 Legacy Player，停止并拆卡；sample/benchmark/portability/release 的迁移不随本卡实施。
