# g20-m22-domain 演示页轻编辑第二档规则

- Status / Owner: active / 主会话
- Outcome / Evidence: M22-T01/T02 仍 not_run；在不重叠的演示页规则文件中先完成可撤销的属性与简单互动 planner，方案见 D:/g20-work/specs/gpt-handoff/plans/M22.md。
- Write scope: 新建 lightSlideEditing.ts、slideLightCommands.ts 与两份指定单测；共享 UI、NativeSelectionContext、App 媒体入口只由主会话在 M16 接线后串行处理。
- Write locks: authoring-slide
- Acceptance: 透明度、字体、行距、场景背景、页面对齐、音频点击播放和点击跳页使用现有正式字段/交互，拒绝无效目标且不写双 History。
- Validation: npm run typecheck；指定 M22 planner vitest；M16 合入后排队运行 M22 Electron 与 M21 回归。
