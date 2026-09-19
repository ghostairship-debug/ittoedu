# r19-050-internal-dogfood：完整教师任务与连续编辑验收

- Release: 1.9
- Dependencies: `r18-043-context-references`, `r18-044-tool-timeline`, `r18-045-safe-markdown-formula`, `r18-046-stop-undo-stale`, `r19-040-session-persistence-deletion`, `r19-041-session-navigation`, `r19-042-draft-workspace-continuity`, `r19-043-long-task-context`, `r19-044-course-creation-workflows`, `r19-045-material-context`, `r19-048-flow-document-delivery`, `r19-049-document-file-coauthoring`
- Optional: 否
- Write locks: `chat-ui`

日期：2026-09-18。本文是目标规格，当前实施次序、事实和验收统一见[完整实施方案](../../R19_FRONTEND_SPECIAL_IMPLEMENTATION_PLAN.md)；本轮仅文档重建。

## 目标与现状
本节点尚未完成。先按主方案 F00–F08 修实际阻断，再闭合040–049组合；051独立汇入060。保留已有效局部证据，不用旧四阶段用例、单次聊天、静态适配或启动后取消冒充完整链。代表链用按任务创作和用户明确审稿两条路径，不固定四稿。原电路 revision27 返回入口失败以最新有限收尾/候选记录为准，早期成功不能覆盖。原样本不可达则记录缺失，用当前等价反例（Flow ID 写入 `scene.go` 必须失败可见），不得声称旧课例已修。

## 范围与入口
[主方案验收矩阵](../../R19_FRONTEND_SPECIAL_IMPLEMENTATION_PLAN.md) V01–V15、[文件合同](../../R19_LESSON_DOCUMENT_WORKSPACE_CONTRACT.md)、[历史证据](../../R19_SHARED_DOCUMENT_EDITOR_IMPLEMENTATION_PLAN.md#4-剩余范围与滚动批次)。真实源码入口是 CourseChatPanel、harness/repository、材料 Owner、prepareGenerationCandidate、useCourseProjectLifecycle；跨域缺陷回实际 Owner 修，不在测试里代写作品。

## 代表链与验收
1. 从真实根目录直接建会话，不建课例/课件也能处理材料；按需建项目。至少两项不同教学目标覆盖“直接完成作品”与“用户先审当前文档再继续”，不能为测试强迫固定四稿。
2. PDF、DOCX、PPTX 各自完成原格式结构、必要正文/图示/出处读取与真实创作消费；明确范围，独立整理后的材料可移动交付。复用045证据补新入口接线，不展开格式×CLI×流程全组合。
3. 生成真实可编辑成果；连续进行局部文字/图片/参数、一次机制修改，以及有实际需要的整页/跨页/共享或实例修改。保留未改部分和手改，结构/画面/运行检查后通过原生任务修复。
4. 工作台与编辑器模式切换、停靠/隐藏、准确会话切换、@ 参考、当前页/选择及发送后浏览；选择/复制/粘贴和 / 菜单真实可用，草稿、选择、任务和历史连续。
5. 人工改稿后 AI 继续；首存/另存/停止/恢复/损坏隔离/范围删除正确；跨一次真实长上下文或恢复边界重新读取当前文件和决定，不重放已提交内容。
6. Markdown 冲突与部分撤回；Flow 混排/源文、数学、Word 实际结构编辑；三 Surface、Undo/Redo、保存重开、当前位置试运行/整课预览/离线HTML正确。CLI不可用仍能人工操作。
7. 关闭原 revision27 返回入口失败并提供当前正确可保存/重开/运行结果；原样本不可得时记录缺失，并用当前等价反例（Flow ID 写入 `scene.go` 必须失败可见），不能伪称原样本已修。其它已知主流程/数据错误回实际 Owner 修复。

## 模型、效率和证据
- Codex/OpenCode 使用实际路由 Luna，默认实际支持的 Fast；Claude 使用确认的 DeepSeek。按变化验证三CLI真实差异、生命周期与接续，保留失败/未验项，不擅换模型。
- 复用 timing/inputMetrics、当前能力按需查询；首次正确、任务自行修复、普通教师反馈、人工技术介入、最终正确结果及全程耗时分列。用户等待与机器耗时、冷/热、输入类别和原生真实usage分开，缺失标未知，不把文件字节换算模型tokens。
- 只修有实际因果证据的主要浪费；不新增缓存/调度平台，不通过删教学内容或省视觉检查提速。2.0冻结规模后的性能目标仍属2.0。
- 核对 DirectoryConversationCli 助手/终态/cwd，PathB 启动测试，LessonWorkspace 真首存，Delivery 已删模式入口及 CopyMove skip。零匹配、skip、只静态适配、mock剪贴板均不能计相应真实路径通过。
- 聚焦工程检查先行，真实连续链尽量共用有效制品；不要裸跑付费规格全文件。记录源码基线、profile/实际路由、命名用例、原始输出、作品/版本、截图/互动观察、结果与限制。

## 完成与移交
所有适用 V 项及必选组合有真实证据，无未关闭核心流程阻断/数据错误/假完成，再交060。自动化只证明 engineering candidate，不代签教师视觉/互动或 Owner accepted。不得为收尾缩减三格式、Flow/Word、三Surface、PPTX或把主链问题延期2.0。
