# repair-rtp-04-published-global-api2-runtime 全局 API 2 Runtime 单实例发布播放

- Status / Owner: active / codex/repair-rtp-04
- Risk / Hotspot: S2 / none
- Outcome / Why now: 全局开发面板与 producer 已能创建、保存并发布 `globalLayerItems` 中的 API 2 Runtime，但 Published session 会预挂载所有 Surface host；若各 host 独立执行会产生重复实例，当前只能显示 fallback。需要由 session 持有唯一实例，并把同一内层容器迁入当前 host 已有的 global wrapper。
- Write scope / Baseline: baseline `7d17fed384804e998e15ae21380ed98259acf897`；仅允许写 `src/player/surfaces/publishedDynamicHosts.ts`、`src/player/surfaces/runtime/publishedCanvasRuntimeMount.ts`、可新增一个窄幅 `publishedGlobalCanvasRuntimeOwner.ts`，确有必要时只给 Slide/Flow/Spatial host 增加只读 mount-target port，以及对应 integration fixture/test 与一条 focused Playwright delivery oracle；禁止修改 Schema、Published producer、Legacy Player、capture、API 3、Runtime action/event/node 合同、App/main/preload、计划与 generated 输出。
- Acceptance: 每个 enabled global API 2 item 在一个 `PublishedCourseSession` 中只 create 一次；Slide→Flow→Spatial→Slide、普通换页、replay 与 surface reset 仅迁移现有容器并保留实例身份、内部状态、既有 wrapper 的 order/坐标/显隐/命中；`restartCourse()` 恰好销毁旧实例一次并重建一次，`session.destroy()` 幂等且停止态 Phaser Core 也完成 DESTROY；注册/create/lifecycle 失败只让该 item fallback 一次，`enabled:false` 与 global API 3 继续 fallback；当前位置、整课预览、离线/在线单 HTML 与网页包共用行为。
- Focused validation: 新增 Mixed 三 host integration 测试，覆盖 create/destroy/suspend/resume、DOM 身份、迁移、排序、restart/destroy 与失败隔离；复用 Runtime authoring/producer 单测；`npm run typecheck`；`npm run build:player && npx playwright test <新增 global API2 delivery spec>`。
- S2 safety / rollback: 只使用内存或临时 V9 fixture，不改用户工程、Schema 或 producer；回滚起点为 baseline。若必须新增统一置顶 overlay、复制每 host 实例、开放 API 3/actions/events/nodes/capture/Component 或改变 Legacy 行为，停止并拆卡，不扩大本纵切。
