# r11-054b-player-payload-shells Player / payload 空壳删除

- Status / Owner: queued / unassigned
- Outcome / Evidence: 精确删除五个零消费者的旧 Player/payload 空壳；Published Course V2、CoursePlayer 与 RuntimeHost 保持唯一播放路径，旧工程与旧发布数据继续 fail-loud。
- Write scope: `src/player/{CourseRuntimeKernel,PlayerApp,PlayerScene,payload,publishedLesson}.ts`、`docs/development-plan/inventories/legacy-consumers.json`、本卡、后继卡与任务板。
- Write locks: legacy-inventory
- Acceptance: 五个精确路径不存在；LEG-002 Player 目标无回归消费者；V2 parser、CoursePlayer 与 RuntimeHost 替代测试通过。
- Validation: `npx vitest run tests/unit/runtimeHostV2.test.ts tests/unit/publishedCourseProtocol.test.ts tests/integration/player-payload.test.ts`、`npm run typecheck`、`npm run check:legacy-ready`。
