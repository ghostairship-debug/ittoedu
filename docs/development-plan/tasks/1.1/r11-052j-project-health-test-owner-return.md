# r11-052j-project-health-test-owner-return 工程健康测试 Owner 回归

- Status / Owner: queued / unassigned
- Outcome / Evidence: 将仍直接消费 V8 `projectHealth.ts` 的界面测试迁回正式 Course Project V9 健康诊断 Owner；保持问题摘要、定位与面板展示行为，不再以待删除兼容模块作为测试入口。
- Write scope: `tests/unit/projectHealthPanel.test.tsx` 及其直接所需的现有 V9 测试工厂、必要的同伴测试断言、本卡与任务板。禁止修改健康诊断产品实现、scanner、inventory、timeout/retry 或 V8 拒绝行为。
- Write locks: none
- Acceptance: 面板测试只通过正式 V9 健康诊断路径构造诊断；原有错误/警告/信息计数与定位交互覆盖保持；`projectHealth.ts` 不再被该测试引用。
- Validation: `npx vitest run tests/unit/projectHealthPanel.test.tsx tests/unit/courseProjectHealth.test.ts tests/unit/projectHealthNavigation.test.ts`。
