# image-size-supply-chain image-size 高危供应链分诊

- Status / Owner: blocked / codex-root
- Risk / Hotspot: S2 / none
- Outcome / Why now: 当前锁图仍为 `pptxgenjs@4.0.1 -> image-size@1.2.1`，命中 `GHSA-w3rx-r6r6-pgpr` 与 `GHSA-5p2g-fcmc-qvqq` 两项 high 无限循环 DoS；官方 advisory 当前确认所有已发布 `image-size <=2.0.2` 均受影响且无 patched release。该依赖在当前 PptxGenJS 浏览器构建中不可达，因此不是产品可用性阻断；任务现被“无官方修复，替换/分叉依赖属于重大供应链决定”阻断，解除条件是 Owner 选择接受跟踪或授权兼容替代/分叉，下一决策者为产品 Owner。
- Write scope / Baseline: baseline `e4a3d07`；解除阻断后默认只允许修改 `package.json`、`package-lock.json`；若兼容验证直接失败，扩展 PPTX 源码前须重新核准；禁止 suppress/ignore advisory、私自采用未经审核的 fork 或新增笼统零 high 发布门。
- Acceptance: lock graph 不再解析受影响的 `image-size`；两项 GHSA 的 audit 结果为零且不是 suppress/ignore；PPTX 类型、Renderer 构建、对象级导出与真实文件打开不回归。
- Focused validation: `npm audit --omit=dev --json` 的两项 GHSA 为零；`npm run typecheck` 与 PPTX focused tests；`npm run build:renderer` 加真实 PPTX 打开冒烟。
- S2 safety / rollback: 当前官方 advisory 无可安装修复且原项目已归档；任何 npm alias、fork、vendoring 或移除 PptxGenJS 都先由 Owner 选择并审查来源/许可证/维护面，失败整体回滚到 `e4a3d07`。
