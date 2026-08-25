# repair-v8-05a-render-host-v9 Render Host 新增 V9/V2 五路径基准

- Status / Owner: active / codex/repair-v8-05a
- Risk / Hotspot: S2 / none
- Outcome / Why now: render-host benchmark 与 browser oracle 仍以 Project V8/Legacy Player 为唯一输入，阻塞 release verifier 最终切换；CMP-03 已补齐五路径中最后一个真实 API 4 Phaser Component Published host，现可先并行建立 V9/V2 行为基准。
- Write scope / Baseline: baseline `e61cd82d3229b8245f4c8ce126a85b3f4285b2fc`；仅允许修改 `scripts/build-render-host-benchmark.ts`、在 `examples/render-host-benchmark/` 新增并稳定命名的 V9 archive/V2 HTML/JSON 及必要 README/notices、`tests/integration/renderHostBenchmark.test.ts` 与 `tests/e2e/render-host-benchmark.spec.ts`；禁止删除或改写仍被 release verifier 消费的旧 V8 artifacts，禁止修改 `scripts/verify-release.ts`、`tests/unit/exampleGenerationBoundary.test.ts`、产品宿主、Schema/合同、sample、portability 或 generated 输出。
- Acceptance: 使用真实 V9 factory/authoring/import API 构建五个 Slide：Native、scene-local API 2 Phaser Runtime、scene-local API 2 DOM+Three Runtime、scene-local API 4 DOM Component、scene-local API 4 Phaser Component；同时生成可重开的 V9 archive 与 Published V2 standalone。focused browser oracle 保留原生点击、Three drag/wheel/reset、表格排序、仪表点击、25 轮切换/replay 压力，并断言无 mount/Canvas/WebGL/RAF 泄漏、无 `pageerror`、无外部网络；旧 V8 benchmark 与其 release consumer 在本卡期间保持字节及行为可用。
- Focused validation: `npm run build:player && npm run check:render-benchmark:fixture`；`npx vitest run tests/integration/renderHostBenchmark.test.ts`；`npx playwright test tests/e2e/render-host-benchmark.spec.ts`。
- S2 safety / rollback: 只写 fixture 或临时浏览器输出；回滚起点为上述 baseline。若需改 release verifier 或删除旧 V8 artifact，停止，等待后续 V8-06/V8-05B 独立卡。
