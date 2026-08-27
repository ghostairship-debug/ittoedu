# online-network-preflight 在线轻量网络声明预检

- Status / Owner: queued /
- Risk / Hotspot: S2 / published-producer
- Outcome / Why now: 在线轻量 HTML 有真实导出入口，但现有预检只检查远程素材，未核对实际发布 Runtime/Component 网络依赖与 `network.connectOrigins`；结果可在预检通过后被生成 CSP 拦截，风险证据已满足总纲 9.5 启动条件。
- Write scope / Baseline: baseline `e4a3d07`；只允许修改 V9 导出预检/`src/renderer/export/course/buildCoursePackages.ts`、必要的既有 finding 定义与生成能力索引、`exportPreflight.ts` 消费以及直接测试；禁止修改 V9/Published V2 Schema、CSP 生成合同、网络权限模型或新增远程脚本能力。
- Acceptance: 仅 `online-lightweight` 对实际发布且 enabled 的 Runtime/Component 做检查；能精确识别的 https/wss/fetch origin 未被 `connectOrigins` 精确声明时产生可定位 blocker，动态不可确定依赖产生诚实 warning；声明齐全通过，offline portable 与 web package 不新增 blocker，现有 CSP 行为不变。
- Focused validation: `npx vitest run tests/unit/coursePackageExport.test.ts`；`npx vitest run tests/integration/courseExportPreflightApp.test.tsx`；`npm run typecheck`。
- S2 safety / rollback: 使用无真实网络请求的 Published/V9 fixture；新增 finding 必须复用单一 V9 collector/预检事实且不把合法外链本身判错；失败只阻断不完整的在线轻量导出，可整体回滚到 `e4a3d07`。
