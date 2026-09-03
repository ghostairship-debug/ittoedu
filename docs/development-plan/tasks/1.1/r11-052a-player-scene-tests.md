# r11-052a-player-scene-tests PlayerScene 测试迁移

- Status / Owner: queued /
- Outcome / Evidence: 处理 `playerSceneMotionLifecycle.test.ts`、`playerSceneComponentEventBuffer.test.ts`、`playerSceneAnimationMode.test.ts` 三个 V1 Player 内部机制测试文件；受支持行为只由 V9/Published V2 最近层测试承接。
- Write scope: 上述三个旧测试文件、`tests/unit/publishedDomInteractionSurfacePort.test.ts`（仅承接 2 条动画时长钳制用例）。
- Write locks: none
- Acceptance: 三文件测的 motion flush 排序/组件事件挂载缓冲/页面可见性缓存按退役行为删除 8 条用例（实现代码本身是 LEG-002 删除目标）；2 条动画时长钳制用例迁入 `publishedDomInteractionSurfacePort.test.ts`（V2 有同款 `MAX_MOTION_DURATION_MS=10_000` 钳制但缺测试）；三文件无 V8 拒绝用例需保留（`publishedCourseProtocol.test.ts:567` 已覆盖拒绝档）；PM map/matrix 对三文件零引用，052d 无需为本卡更新；目标测试通过。
- Validation: 只运行本卡实际修改的测试文件与实际承接用例的 V2 文件（一条 `npx vitest run ...` 命令，不得运行全量）；不运行 `check:preservation`。
