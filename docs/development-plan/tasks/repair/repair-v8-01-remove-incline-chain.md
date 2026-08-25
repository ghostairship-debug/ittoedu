# repair-v8-01-remove-incline-chain 删除无 consumer 的 incline-motion V8 全链

- Status / Owner: queued /
- Risk / Hotspot: S2 / none
- Outcome / Why now: EXA-02 已完成；incline-motion 的 V8 课例、组件源码/包和孤立生成脚本没有 package、测试、发布或产品 consumer，继续保留只制造已退役课例与 V8 archive/export 假依赖。
- Write scope / Baseline: baseline `a1ccc9cc0703d1e4d323baa21d256921c7360879`；仅允许删除 `scripts/build-incline-motion-lesson.ts`、`examples/incline-motion-3d-component/**`、`examples/incline-motion-3d.h5component`、`examples/incline-motion-3d-lesson.h5lesson`，并更新 `docs/development-plan/inventories/legacy-consumers.json` 中 LEG-008 对应的当前 confirmed endpoint/fact/evidence（保留 historical baseline/startingCounts）；禁止修改产品 archive/export/Player、其他示例、迁移旧内容或写 Integrator 独占的计划/能力/generated 输出。
- Acceptance: 精确链全部删除；`package.json`、scripts、src、tests、examples 中对 `build-incline-motion-lesson|incline-motion-3d` 的活引用为 0；剩余 sample/lesson/render 生成检查不受影响；V8 产品入口不恢复，inventory 不再把已删 endpoint 列为当前 confirmed consumer。
- Focused validation: `git grep -n -I -E "build-incline-motion-lesson|incline-motion-3d" -- package.json scripts src tests examples` 应无结果；`npm run check:examples`；repo-index 由 Integrator 合并后统一生成并检查。
- S2 safety / rollback: 删除前以精确静态、配置、测试和发布 consumer 查询确认 0；若发现动态 consumer，停止并恢复该链，不用 V8→V9 迁移兜底；回滚起点为 baseline，用户工程与真实数据不在写入范围。
