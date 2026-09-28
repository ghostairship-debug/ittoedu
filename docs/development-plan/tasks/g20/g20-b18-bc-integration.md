# g20-b18-bc-integration M23 HTML 工作台与 M24 通用工具

- Status / Owner: active / 主会话
- Outcome / Evidence: A 的 M17-T05 已在 `5238be33` 验证；M23 三项、M24 四项当前仍 `not_run`。主会话是唯一集成人和共享热点 Owner，六个独立 worktree 并行开发叶子。
- Write scope: 主会话独占 `D:/g20-work/specs/gpt-handoff/plans/M23.md` §7 的 B0/I 文件与 `D:/g20-work/specs/gpt-handoff/plans/M24.md` §8 的接线和生成文件；六个叶子的精确且不重叠文件清单分别为 M23 §7 B1/B2/B3、M24 §§4/6/7 C1/C3/C4。清单之外停止写入并报告，由主会话重新划域；B4/C2 待共享接口落定再派。
- Write locks: main-preload, generated-index, app-save-recovery, workspace-shell
- Acceptance: HTML 文档经正式 TextDriver/DocumentSession 保存与撤销；独立预览只读同目录资源且不能访问编辑器或顶层导航；五个工具通过同一目录、执行器和 MCP，完成各自正式 Electron 用例与指定回归。
- Validation: M23/M24 目标 Vitest 与 `npm run typecheck`；串行隔离 Electron 用例、真实截图和 `evidence.json`；`npm run check:g20-import-boundaries`、`npm run check:contracts`、能力生成/计划校验。
