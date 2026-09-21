# r20-contextual-authoring 轻量上下文共编集成

- Status / Owner: active / Codex
- Outcome / Evidence: 用户已授权推进2.0；Markdown精确选区、预览应用、撤销重做及真实文件重开已通过浏览器确定性链。正在修复AI应用与人工输入并发历史，并汇合2.0设置、首次说明和内置Skill交付。
- Write scope: Codex持有共享锁及主工作树，已集成文档生命周期、Flow精确选区、CLI诊断与首次发送说明。当前隔离委派：Leibniz/Terra high在r20-skill-delivery完成courseAgentSkills/profile/目录Skill资源/service及专用测试；Lorentz/Sol high在r20-first-use完成repository/记录占用窄模块、lessonWorkspace统计操作与LessonConversationNavigation及专用测试（禁止写localAgent/service.ts）；Herschel/Luna high只读核对真实CLI/PPTX最小验收入口。CourseChatPanel、LessonConversationChat、SharedDocumentEditor、Flow候选范围守卫及最终集成只由主会话写入。子任务禁止提交，返回后顺序集成。
- Write locks: contracts-schema, chat-ui, workspace-shell, authoring-flow, ai-session, generated-index, cli-adapters, main-preload
- Acceptance: Markdown及Flow选择成为精确目标，卡片与聊天同一冻结提交路径，stale零写入，人工保存/重开/撤销不回退；2.0其余生产门有真实证据才晋升。
- Validation: 定向选区/源文/控制器测试；typecheck；真实UI选择、修改、保存重开和停止验收。
