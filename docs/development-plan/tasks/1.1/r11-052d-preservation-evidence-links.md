# r11-052d-preservation-evidence-links 保全证据路径更新

- Status / Owner: queued / Integrator
- Outcome / Evidence: 052a–052c 与 052e–052h 已把保全行为迁入正式 V2 consumer 测试；仅同步 PM 条目引用的测试路径，不改变保全行为文字。
- Write scope: `docs/development-plan/baselines/v1.1-preservation-map.json`、`docs/development-plan/roadmap/PRESERVATION_MATRIX.md`。禁止修改产品、测试与 PM 行为描述。
- Write locks: none
- Acceptance: 两份保全事实源不再引用已删除的旧渲染器测试，且每个移动证据都指向当前存在、直接承接同一行为的测试。完成时删除本卡并按蓝图实例化 `r11-053-legacy-list`。
- Validation: `npx vitest run tests/unit/preservationChecker.test.ts tests/unit/developmentRoadmap.test.ts`；`npm run check:development-roadmap`。禁止运行 `check:preservation`。
