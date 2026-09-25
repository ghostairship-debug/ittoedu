# 代码迁移地图与旧路径退出条件

## 现有代码入口

以下是已核查源码中的入口；目标名称表示本方案的设计职责，不表示对应新文件已经存在。迁移保留现有领域命令、V9内容、资源与可用能力，不保留普通AI编辑的外部候选必经链。

| 当前文件／符号 | 目标职责与实施动作 | 普通路径退出条件 | 任务 |
|---|---|---|---|
| `store/editorStore.ts` / `editorStoreKernel.ts` | 抽纯数据驱动与每文档Kernel；Zustand仅作视图投影与本地暂态 | 不再只有一个可写active project；切tab不更换任务的权威内容 | S02 |
| `composition/authoringToolActions.ts` `validateDestination` | 校验显式DocSession和目标结构，视图焦点不参加内容身份 | 工具不再要求当前location/owner/session generation匹配UI | S02/S04 |
| `composition/courseToolTransaction.ts` | 内容资源History提交归文档服务，浏览/选区更新移至视图监听 | 提交不再主动切用户页面或创建另一表面writer | S02/S03 |
| `authoring/tools/authoringToolFacade.ts` | 保留唯一工具注册表，输出短句柄面向模型的发现信息 | 后端无重复领域工具实现与手写副本Schema | S04 |
| `authoring/tools/executeAuthoringTool.ts` | 入口解码/局部前置检查、调用既有planner、统一commit；异步结果重验读集合 | 无假装最新revision绕过冲突；无外部候选包裹普通调用 | S03/S04 |
| `authoring/editorTransaction.ts` | 内核事务与逆操作；可先保留稳定实现，再按实测缩减全量复制 | 模型不组装事务内部字段；每token不复制整工程 | S03/S11 |
| `resourceAwareAuthoringHistory.ts` / `store/courseResourceState.ts` | 一个History同时管理内容及资源引用 | 不出现AI单独undo栈或孤立资源回滚 | S03 |
| `course/coursewareBuilderV2.ts` | 作为可组合领域能力使用，读取显式session，不激活UI才能操作 | `activate()`不再是非当前页编辑前置 | S02/S04 |
| `generation/prepareGenerationCandidate.ts` | 仅保留完整工程导入、复杂可执行内容准备等专项调用 | 日常text/style/geometry/公开属性不进入coordinator | S04/S05 |
| `generation/generationTaskController.ts` | 普通live任务交由运行控制层，构建准备能力接 S13 同一执行器工具 | live任务不等待candidate、外层read/continue与强制feedback | S05/S07 |
| `main/localAgent/harness.ts` | 抽取可复用状态/事件经验，统一自建循环拥有 API 连接、上下文与 run；live/build 为工具权限 | 去除live必产candidate约束、外层重复进程开关和同status丢事件 | S05/S07 |
| `main/localAgent/profile.ts` | 简明上下文与同源工具目录；专项build资料按需读取 | 普通调用不要求读交付说明、写candidate和拷贝目的地大对象 | S04/S05/S08 |
| 三个 native adapters | 不列为 2.0 深度嵌入必保全项；仅在有调用者时保留隔离基线/对照入口，正式开放改由统一 MCP | 产品内置循环不依赖三家原生协议；MCP 只做薄配置兼容 | S05/S12 |
| `shared/localAgentTaskContract.ts` | live任务契约与新事件类型独立于旧V1显示；新记录由统一内置 run 与外部 MCP 来源定义，不做旧聊天读迁移 | 新事件不经V1丢信息后再进入GUI | S07/S10 |
| `shared/localAgentText.ts` / `localAgentProjection.ts` | 对话显示与legacy解析分离；新内容流有单独类型 | 思考/工具详情不混进可提交正文或旧候选解析 | S06/S07 |
| `CourseChatTranscript.tsx` / `readableChatStatus.ts` | 可展开统一时间线及虚拟化；状态摘要仅是显示投影 | 不再把成功结果全部隐去，详情保留并可重开 | M09 |
| `LessonWorkspaceView.tsx` / tabs controller | DocId统一标签、轻量内容、会话正交、真实收展 | 固定`course`标签与path作为唯一identity退出 | S02/S10/M01/M02 |
| `LessonDocumentEditor.tsx` | 文档视图绑定DocSession，正文内流式投影 | `state.disk`不是渲染/AI编辑前置；候选外部路径不出现在主流程 | S02/S06/M05/M06 |
| `SharedDocumentEditor.tsx` / `editorSession.ts` | PM事务、稳定块ID、选择映射、流式目标投影 | 增量更新不反复`EditorState.create`，正文选择不要求源文绕行 | S06/M05 |
| `documentFileSession.ts` | Markdown Driver与会话的保存/恢复/撤销能力迁入统一边界 | renderer不再单独正式写文件，与主进程共享一个提交序列 | S02/S03 |
| `documentAiTaskController.ts` / `main/lessonDocumentAiTask.ts` | 以文档句柄启动流式文本编辑与正式内核提交 | 正常路径无baseline/replacement/candidate文件、disk flush前置与完成后才读 | S06/M06 |
| `LessonConversationChat.tsx` / `CourseChatPanel.tsx` | 一个Composer、统一任务和会话状态，按文档能力调用工具 | 不因MD/h5切换组件而重置模型/会话；不强制preview与scope表单 | S10/M07 |
| `ChatComposerMenus.tsx` / `materialContract.ts` | 附件实体、Blob/表示、引用句柄与原话；保留IME菜单逻辑 | `@路径文本`不冒充实际文件附件或视觉输入 | S08/M08 |
| `LessonDirectoryTree.tsx` / `lessonDesktopService.ts` | Explorer调用FileService，管理动作带结果与重绑定 | 不仅list/open；文件修改不只刷新树却遗留旧会话路径 | S09/M10 |

## 推荐模块布局

```text
src/shared/workbench/       # 跨进程数据合同：DocId、操作、任务、事件
src/core/documents/         # 纯TS：Registry、Session、事务/历史、Driver接口
src/core/drivers/           # MD、Course V9；领域模型保持独立
src/main/workbench/         # 主进程组合：持久化、恢复、权限和网关
src/main/ai/                # 自建 ExecutionEngine、Provider/图像、连接、预算、构建 job 与事件
src/renderer/workbench/     # Shell、Tab、Explorer、Composer、Timeline
src/renderer/documents/     # 正文/画布投影、选择、临时编辑和轻量工具
```

这是目标职责图，不要求先一次性移动所有源码。先用明确接口提取纯逻辑、建立writer隔离，再逐模块整理路径；单纯改文件夹名不算完成任务。

## 切换顺序

每个 Driver 切入新内核后只有一个正式 writer，不建立逐文档新旧内核切换开关。完成读/改/撤销/保存/重开的等价性验证后切入新内核；旧UI通过适配器访问新内核，而不是继续维护另一套正式Store。

同一执行器在一个任务中可调用 live 或 build 工具；权限由实际工具和授权控制，用户无需预选模式，不增加自然语言分类模型。专项任务的有效候选仍走正式文档提交，不能有另一个偷偷写真实文件的出口。

不迁移旧聊天/缓存；保留受支持文件读取和代码职责迁移地图。2.0 自身记录恢复不重放工具，新记录不并写多套 V1/V2 真相。

## 删除完成条件

对应普通任务的调用跟踪不再出现候选中间文件和外层反馈续轮；直接工具与人工入口都落到同一文档commit；正式路径旧 writer 引用为零；Provider 与 MCP wrapper 只依赖明确的共享合同与 Gateway；集成测试验证用户浏览位置不受写入影响。

不能通过删测试、改验收文字或隐藏按钮来宣布已迁移。无法保持原高级能力时，修复迁移，不把已支持内容降级成图片或黑盒导出。

## 依据
- [R01 · src/renderer/lessonWorkspace/controller/useDocumentTabsController.ts](https://github.com/ghostairship-debug/ittoedu/blob/0de8801bb7de3299129b66e293dc49c9ce298f76/src/renderer/lessonWorkspace/controller/useDocumentTabsController.ts)：LessonFileTab、activeTab、editDocument、disk 等待。
- [R02 · src/renderer/lessonWorkspace/view/LessonWorkspaceView.tsx](https://github.com/ghostairship-debug/ittoedu/blob/0de8801bb7de3299129b66e293dc49c9ce298f76/src/renderer/lessonWorkspace/view/LessonWorkspaceView.tsx)：固定 course 标签、createMarkdown、chatPane、editorFocus。
- [R08 · src/renderer/ui/chat/CourseChatPanel.tsx](https://github.com/ghostairship-debug/ittoedu/blob/0de8801bb7de3299129b66e293dc49c9ce298f76/src/renderer/ui/chat/CourseChatPanel.tsx)：480 行后 composer；projectPath 前置条件；发送与配置。
- [R09 · src/renderer/ui/chat/LessonConversationChat.tsx](https://github.com/ghostairship-debug/ittoedu/blob/0de8801bb7de3299129b66e293dc49c9ce298f76/src/renderer/ui/chat/LessonConversationChat.tsx)：send 的文档分支强制 applyPolicy:preview；正文/一般聊天路由、模型与发送条件。
- [R16 · src/shared/localAgentTaskContract.ts](https://github.com/ghostairship-debug/ittoedu/blob/0de8801bb7de3299129b66e293dc49c9ce298f76/src/shared/localAgentTaskContract.ts)：事件类型、record 身份、imageFileIds 与 adapter 接口。
- [R21 · src/main/localAgent/harness.ts](https://github.com/ghostairship-debug/ittoedu/blob/0de8801bb7de3299129b66e293dc49c9ce298f76/src/main/localAgent/harness.ts)：prepareLaunch/consume；1110–1230 行状态去重与重复 running 错误；任务权限语义。
- [R28 · src/renderer/authoring/generation/generationTaskController.ts](https://github.com/ghostairship-debug/ittoedu/blob/0de8801bb7de3299129b66e293dc49c9ce298f76/src/renderer/authoring/generation/generationTaskController.ts)：250ms 轮询、drive、候选/回执/续阶段。
- [R33 · src/renderer/documentFiles/LessonDocumentEditor.tsx](https://github.com/ghostairship-debug/ittoedu/blob/0de8801bb7de3299129b66e293dc49c9ce298f76/src/renderer/documentFiles/LessonDocumentEditor.tsx)：bindTarget；state.disk 挂载前置；正文下方 aiCandidate；末尾 aiRecords。
- [R34 · src/renderer/document/SharedDocumentEditor.tsx](https://github.com/ghostairship-debug/ittoedu/blob/0de8801bb7de3299129b66e293dc49c9ce298f76/src/renderer/document/SharedDocumentEditor.tsx)：publishLayoutSelection；sourceMap；source/layout；caller owns history。
- [R35 · src/renderer/document/editorSession.ts](https://github.com/ghostairship-debug/ittoedu/blob/0de8801bb7de3299129b66e293dc49c9ce298f76/src/renderer/document/editorSession.ts)：selection adapter；Decoration；update 中 EditorState.create；外部撤销回调。
- [R37 · src/renderer/documentFiles/documentAiTaskController.ts](https://github.com/ghostairship-debug/ittoedu/blob/0de8801bb7de3299129b66e293dc49c9ce298f76/src/renderer/documentFiles/documentAiTaskController.ts)：editor.flush；applyPolicy；每秒轮询；candidate 后才交付。
- [R38 · src/shared/lessonDocumentAiTask.ts](https://github.com/ghostairship-debug/ittoedu/blob/0de8801bb7de3299129b66e293dc49c9ce298f76/src/shared/lessonDocumentAiTask.ts)：start/read/stop；只有最终 apply，无正文增量结果。
- [R39 · src/main/lessonDocumentAiTask.ts](https://github.com/ghostairship-debug/ittoedu/blob/0de8801bb7de3299129b66e293dc49c9ce298f76/src/main/lessonDocumentAiTask.ts)：baseline.md/request.json/replacement.md/candidate.json；等待 record completed。
- [R40 · src/renderer/documentFiles/documentFileSession.ts](https://github.com/ghostairship-debug/ittoedu/blob/0de8801bb7de3299129b66e293dc49c9ce298f76/src/renderer/documentFiles/documentFileSession.ts)：undoStack/redoStack；historyGroup；aiCandidate；draft/save/observe。
- [R41 · src/renderer/authoring/tools/authoringToolFacade.ts](https://github.com/ghostairship-debug/ittoedu/blob/0de8801bb7de3299129b66e293dc49c9ce298f76/src/renderer/authoring/tools/authoringToolFacade.ts)：createAuthoringToolFacade / describeAuthoringTools；执行与发现同源。
- [R42 · src/renderer/authoring/tools/executeAuthoringTool.ts](https://github.com/ghostairship-debug/ittoedu/blob/0de8801bb7de3299129b66e293dc49c9ce298f76/src/renderer/authoring/tools/executeAuthoringTool.ts)：executeAuthoringTool；完整复制、Schema 检查、commitPort。
- [R43 · src/renderer/composition/authoringToolActions.ts](https://github.com/ghostairship-debug/ittoedu/blob/0de8801bb7de3299129b66e293dc49c9ce298f76/src/renderer/composition/authoringToolActions.ts)：validateDestination / runAuthoringTool；对当前作者会话和焦点的依赖。
- [R44 · src/renderer/store/editorStoreKernel.ts](https://github.com/ghostairship-debug/ittoedu/blob/0de8801bb7de3299129b66e293dc49c9ce298f76/src/renderer/store/editorStoreKernel.ts)：EditorStoreKernel / persistTransaction / readResources。
- [R45 · src/renderer/composition/courseToolTransaction.ts](https://github.com/ghostairship-debug/ittoedu/blob/0de8801bb7de3299129b66e293dc49c9ce298f76/src/renderer/composition/courseToolTransaction.ts)：跨表面事务、资源历史与浏览状态投影。
- [R46 · src/renderer/authoring/generation/prepareGenerationCandidate.ts](https://github.com/ghostairship-debug/ittoedu/blob/0de8801bb7de3299129b66e293dc49c9ce298f76/src/renderer/authoring/generation/prepareGenerationCandidate.ts)：候选私有执行、步骤依赖、资源折叠和正式应用。
- [R47 · src/renderer/authoring/editorTransaction.ts](https://github.com/ghostairship-debug/ittoedu/blob/0de8801bb7de3299129b66e293dc49c9ce298f76/src/renderer/authoring/editorTransaction.ts)：EditorTransactionStep；完整文档与资源变更。
- [R48 · src/renderer/authoring/resourceAwareAuthoringHistory.ts](https://github.com/ghostairship-debug/ittoedu/blob/0de8801bb7de3299129b66e293dc49c9ce298f76/src/renderer/authoring/resourceAwareAuthoringHistory.ts)：资源感知的内容撤销历史。
- [R50 · src/main/localAgent/profile.ts](https://github.com/ghostairship-debug/ittoedu/blob/0de8801bb7de3299129b66e293dc49c9ce298f76/src/main/localAgent/profile.ts)：prompt 组装、能力发现、目的地别名与候选交付。
- [R52 · src/renderer/course/coursewareBuilderV2.ts](https://github.com/ghostairship-debug/ittoedu/blob/0de8801bb7de3299129b66e293dc49c9ce298f76/src/renderer/course/coursewareBuilderV2.ts)：Builder 工具调用与作者会话关系。
