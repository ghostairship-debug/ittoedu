# r19-041-session-navigation：交付聊天首页、项目会话导航与极简/专业共用AI工作台

- Release: 1.9
- Dependencies: `r19-040-session-persistence-deletion`
- Optional: 否
- Write locks: `chat-ui`, `ai-session`, `workspace-shell`, `props-shared`
- Gaps: G05, G09

## 结果与现状

软件先进入聊天首页，左侧为项目与会话；选择已有项目即打开真实画布，新项目在第一个完整画布成果正式形成后显示画布。默认极简模式提供直接操作和对象局部AI，专业编辑模式保留全部手动与AI能力。

本节点消费040的会话生命周期、042的未命名身份及044的自动/手动流程，整理工作台和导航，不重新实现生成调度、阶段规则或工程写入。画布位置可由后续布局设置确定，不在本规格固定右栏像素布局。

上述Dependencies是开发前置：040的稳定列表/恢复端口到位后，首页、已有工程导航、极简/专业呈现与局部AI入口可先开发，不等待044整项完成。042的真实身份与044的真实阶段/首成果是本节点集成完成门；阶段卡和首成果展开接线仍由041持有，未完成这些接线不得宣称041完成，050最终汇合040–045全部门。

## 开始前与阅读入口

先核对[产品方案第2节](../../AGENT_AUTHORING_LONG_TERM_PLAN.md)、[开发计划](../../AI_ASSISTANT_DELIVERY_PLAN.md)、[架构合同](../../ARCHITECTURE_CONTRACT.md)、[工作协议](../../WORKING_PROTOCOL.md)和[共同实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)，依赖完成事实与写锁以当时源码/证据和[任务板](../../TASK_BOARD.md)为准。

- [App.tsx](../../../../src/renderer/App.tsx)：当前应用接线、editorMode和Chat入口。
- [Workspace.tsx](../../../../src/renderer/ui/Workspace.tsx)、[PropertiesPanelRouter.tsx](../../../../src/renderer/ui/properties/PropertiesPanelRouter.tsx)：三表面画布与对象属性Owner。
- [CourseChatPanel.tsx](../../../../src/renderer/ui/chat/CourseChatPanel.tsx)、[course-chat.css](../../../../src/renderer/ui/chat/course-chat.css)：聊天状态、输入、任务和布局。
- [useCourseProjectLifecycle.ts](../../../../src/renderer/app/useCourseProjectLifecycle.ts)：打开已有工程、当前文件和保存恢复接线。
- [repository.ts](../../../../src/main/localAgent/repository.ts)、[harness.ts](../../../../src/main/localAgent/harness.ts)、[localAgentTaskContract.ts](../../../../src/shared/localAgentTaskContract.ts)：搜索/分支来源、任务身份与提交序列。

## 允许写域与旧路径退出

Workspace布局、Chat与属性区入口、本地会话可重建索引和导航；App只接线，状态/命令留在各正式Owner。沿用simple/professional改变工具呈现，不新增第三个持久模式、另一个编辑器或局部AI私有Store/History。

写锁元数据列出本节点可能触及的域；实际批次只申请当批文件所需锁。同一粗锁覆盖不同叶子时，由唯一协调Owner在同一协调任务内持锁，委派精确非重叠的工作台/属性区组件到隔离工作区，不创建两个争用active卡。App、CourseChatPanel及其共享样式由唯一UI集成人顺序接线。044提供唯一阶段/首成果事实，043提供上下文诊断，041只消费并呈现；接口未就绪时只做不依赖它的独立叶子，不造占位协议或复制状态，同一文件不得并写，局部开发完成不等于整节点完成。

## 执行步骤

1. 建立聊天首页与左侧项目/会话列表，区分当前绑定、同名项目、未命名项目与后台任务。未绑定讨论按042合同保存；选择已有工程经真实打开路径并获取当前内存状态，不能直接把上个项目的CLI句柄/候选带入。
2. 新项目讨论期间不强制露出空白画布；044提交第一个完整页面或自洽互动单元并经对应必要检查后展开实际画布。占位图、加载状态、日志和半截JSON不能触发“成果已形成”；首成果出现时间可记录但不冒充整课完成。
3. 默认极简模式比现有simple进一步收敛，保留拖拽、改字、换图和常用参数。对象属性/局部编辑区提供AI输入及应用入口；“paragraphs”是该区域工作称呼，不将其限定到Flow段落。局部入口绑定稳定authoringAddress、owner、revision，主聊天默认页/整课范围，两者共用同一CLI连接、任务与提交能力。
4. 专业模式保留原有全部手动能力和全部AI能力。切模式/布局只改变呈现，不清空工程、选区、会话、历史和运行状态，不因为隐藏控件而缩减原生CLI工具或模型能力。
5. 呈现044的材料读取、模板选择、自动进度和手动阶段正文/确认；教师可查看、改稿、停止并继续，UI不私自推进未确认阶段。
6. 搜索以现有记录生成可重建索引，命中真实消息/任务/引用；讨论分支明确来源且不复制工程或旧可应用候选。多任务显示等待/运行/需回答/已提交/失败，切换后输入和问题回答仍到正确任务；工程写入串行并重新校验。
7. 变更入口链接原receipt与正式历史。有后续人工事务时遵守原Undo顺序，不实现任意历史点回滚；删源会话后分支保留范围沿040规则。

## 验收与可信反例

- 从首页开始自动和手动流程，已有工程立即呈现真实画布，新项目只在完整首成果后出现；无需教师识别内部协议或切终端。
- 在两种窗口宽度与simple/professional切换中，主聊天和局部AI都能完成同一受支持修改，保留人工内容；搜索、分支、问题回答、排队提交和重启来源准确。
- 选中对象在回答前被删除、切到另一个工程、同名项目、分支源删除、排队中人工修改、索引损坏，均不得误投候选、复制工程或假称成功。

## 停止条件

真实需要工程分叉时先明确产品需求，不用讨论分支暗中复制Project或引入Git/worktree。若极简化会删除教师能力，保留已有入口并修正布局，不接受能力退化作为视觉完成。

## 聚焦验证

在现有测试补首页/绑定/首成果/模式切换与局部AI目标失效行为；新的UI测试文件先随实现创建，再列入命令。

按[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)完成一次适用准备后直接运行命名文件；现有E2E仅覆盖原入口回归。首页/首成果/局部AI新行为须在实现时先加入命名用例，再用精确grep选中；零匹配不算通过，不执行整个stabilizationCoreUsability文件的真实付费矩阵。

```text
npx --no-install vitest run tests/unit/localAgentTaskContract.test.ts tests/unit/useCourseProjectLifecycle.test.tsx tests/unit/editorTransaction.test.ts
npx --no-install playwright test tests/e2e/stabilizationCoreUsability.spec.ts --grep 'S3 默认可见与普通讨论：安全消息、分页事件重放及零工程写入$'
```

真实窗口完成一个新项目和一个含人工修改的已有工程，在至少三会话间搜索、分支、切换、回答与排队编辑；窄/宽窗口均查看实际画面。复用044生成和040恢复的未变证据，只补本节点新UI/路由路径。

## 回退与交接

交付首页、画布出现条件、局部/主聊天路由及模式保全证据，供043/050继续。工作台回退不得回退已提交课程内容或改变040/042/044的唯一状态。
