# g20-task0 窗口标题与 AI 能力说明

- Status / Owner: active / 主会话
- Outcome / Evidence: 窗口标题固定为果铃编辑器，AI 能力说明面向通用内容工作台；交接任务包 0.1/0.2 已授权，执行方案见 D:/g20-work/specs/gpt-handoff/plans/TASK0.md。
- Write scope: 0.1 限 useCourseProjectLifecycle.ts、appState.ts 及对应单测和标题 E2E；0.2 限两份 AUTHORING 指南、generate-ai-capabilities.ts、generationCapabilities.ts；生成物只由主会话串行生成。清单外停止并交回。
- Write locks: main-preload, generated-index
- Acceptance: 工作台与编辑器原生标题均固定，dirty 关闭保护与界面提示保留；能力描述不把产品限定为课件，Skill 与协议标识不变。
- Validation: npm run typecheck；目标 vitest；主会话排队运行隔离 profile 的标题 Electron spec 与静态四检查。
