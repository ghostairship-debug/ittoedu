# repair-v8-03-sample-v9 发布示例改为真实 V9

- Status / Owner: active / codex/repair-v8-03
- Risk / Hotspot: S2 / none
- Outcome / Why now: `examples/sample-project.h5lesson` 与其生成/发布验证仍消费 Project V8；CMP-03 已使真实 Slide Phaser Component 可在 Published V2 播放，现可用最小 V9 sample 解除这一 release consumer，而不迁移旧示例设计。
- Write scope / Baseline: baseline `e61cd82d3229b8245f4c8ce126a85b3f4285b2fc`；仅允许修改 `scripts/build-examples.ts`、`examples/sample-project.h5lesson`、`tests/unit/exampleGenerationBoundary.test.ts`、`scripts/verify-release.ts` 中 sample 专属适配/断言及一个必要的 focused sample E2E；禁止修改通用 release 流程、PDF/PPTX 行为、render-host benchmark、portability、产品宿主、Schema/合同、App/main/preload 或 generated 输出。
- Acceptance: generator 通过当前 V9 factory 建两页 Slide、保留默认全局教师控制器、真实导入 `examples/sample-counter.h5component` 并用现有 Slide component authoring command 放到第 2 页；保存的 V9 archive 内嵌组件字节且可重开；Published V2 离线 sample 在第 2 页出现真实 Phaser canvas，点击后计数改变，零 `pageerror`、零外部网络；sample 专属 release 断言读取 V9/Published controller 位置且不改变 PDF/PPTX 语义。
- Focused validation: `npm run build:player && npm run check:sample-examples`；`npx vitest run tests/unit/exampleGenerationBoundary.test.ts`；运行 sample 专属 verifier 或 focused Playwright oracle。
- S2 safety / rollback: generator 只写 committed sample 或临时目录；回滚起点为上述 baseline。若需要改变通用 release、静态导出、产品宿主或其它 fixture，停止并拆卡。
