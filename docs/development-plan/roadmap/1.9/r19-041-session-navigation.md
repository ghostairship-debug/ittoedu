# r19-041-session-navigation：交付真实工作空间入口、课例导航与整合标签工作台

- Release: 1.9
- Dependencies: `r19-040-session-persistence-deletion`, `r19-042-draft-workspace-continuity`
- Optional: 否
- Write locks: `chat-ui`, `ai-session`, `workspace-shell`, `props-shared`
- Gaps: G05, G09

## 结果与边界

依据 [课例与文件合同](../../R19_LESSON_DOCUMENT_WORKSPACE_CONTRACT.md)，首次选择/新建真实工作空间，再命名创建或打开课例。左上资源管理器、左下课例和对话、中间对话、右侧材料/教学文档/课件标签。默认一条对话贯穿，可另开；保留simple/professional的完整手动及相同AI能力。

本节点只负责真实导航与标签容器，不重新实现阶段状态、文件writer或生成调度。049接文档编辑，044接阶段内容/首成果；041自身无需等待044整项，050验证组合，删除原041/044相互作为完成条件的安排。

## 直接入口与写域

- [App.tsx](../../../../src/renderer/App.tsx)、[Workspace.tsx](../../../../src/renderer/ui/Workspace.tsx)：应用接线、三表面和右侧标签容器。
- [CourseChatPanel.tsx](../../../../src/renderer/ui/chat/CourseChatPanel.tsx)、[course-chat.css](../../../../src/renderer/ui/chat/course-chat.css)：对话与布局。
- [useCourseProjectLifecycle.ts](../../../../src/renderer/app/useCourseProjectLifecycle.ts)、[PropertiesPanelRouter.tsx](../../../../src/renderer/ui/properties/PropertiesPanelRouter.tsx)：真实工程打开与属性/局部AI。

App/Chat/共享样式由唯一UI集成人顺序接线；Feature只消费窄端口，不导出完整Store。simple/professional只改变工具披露，不产生第二编辑器、工程或权限配置。

## 执行与验收

1. 工作空间选择成功后列真实文件，按需展开；新建课例展示名称/位置/最终路径，同名建议不覆盖；目录创建成功才进入课例。
2. 材料和教学文档在课件出现前即可右侧打开。第一份实际可展示课件提交后打开其标签；已有工程直接经正式打开入口显示，日志/占位不算首成果。
3. 单击文件预览、明确打开固定标签；草稿不被覆盖。浏览文件不自动授权AI修改，发送区明确显示引用和选区。
4. 切换课例/对话/标签后问题答案、输入、草稿与候选指向原目标；删除目标/切工程/后台结果迟到均不误投。搜索用可重建索引，讨论分支不复制工程或旧候选。
5. 窄/宽窗口均有可达的三栏入口；专业/极简、局部/主聊天保留相同AI能力。局部AI绑定真实authoringAddress及revision。
6. 文档AI改动标记与选择性撤回由049提供；Flow普通撤销沿工程历史，本节点不实现任意历史点回滚。

## 聚焦验证与交接

新UI测试证明工作空间→课例→打开/切换标签、同名路径和目标失效。真实窗口操作两个课例与至少三条对话，并在窄/宽窗口、simple/professional间切换。041完成意味着容器及真实导航可用；044/049的集成和首成果由其节点及050承担。

开始前读取当前总纲、任务板、工作协议及上述合同，未创建协调任务。
