# 聊天与 Flow 可用性修复（2026-09-07）

本次依据用户报告修复实时回复、已选对象引用及 Flow 编辑/运行不一致。改动留在当前工作区，未提交或发布，不代表 S3 accepted。

后续路线已进入[三表面架构整合方案](../THREE_SURFACE_ARCHITECTURE_INTEGRATION_PLAN.md)：本记录是局部已通过证据，整合保留这些成果，但不将其推广成全部窗口、组件源码或当前三CLI均通过。U01–U11/R01–R09映射及新增源码边界以整合方案和原整改记录共同追溯；本轮只改开发文档。

后续反馈补充了 Flow 顶部浮层裁剪、不同窗口下正文/浮层缩放不一致、Spatial 编辑共享绘制，以及试运行/整课预览缺少 Slide/Flow 主动缩放。当前已定位并纳入[分批整改方案](../roadmap/1.8/USABILITY_REPAIR_PLAN.md)，同时包含组件源码修改链路、OpenCode 候选修复和历史全局控制器删除失败。下面的通过记录仍仅覆盖当时验证样例，不表示这些新反馈已修复。

## 行为与根因

- Codex `exec --json`、OpenCode `run --format json` 的正文事件不能提供所需的逐段更新。改用各自原生 stdio 会话协议（Codex app-server、OpenCode ACP）；Claude 开启 partial messages。仍由本地 CLI 自己规划，未增加模型循环或 live project API。
- 聊天直接展示自然语言。增量文字与最终快照按原生消息身份合并；Claude 带思考时，完成数组省略思考块，不能将完成数组下标当成流式块下标。修正这个重复拼接原因。普通讨论不需要候选；课件修改仍只接受指定通道内的严格候选。
- 活跃会话读取实时事件；最终状态在清理和持久化完成后才可见，避免提前读取未就绪候选。聊天跟随新回复滚动，保留用户主动向上阅读的位置。候选格式错误明确提示候选失败，不误报安装或认证失败。
- Slide 普通选择同步到 canonical authoring session；页面快照明确标出 selected 对象。聊天面板保留 Flow 文本选择，引用摘要显示已选对象。
- 编辑和 Published 共用正文排版与富文本 HTML 实现，包括空段、连续换行、字号、强调、引用、列表。删除选中块时额外撑高正文的空间。Flow 正文随真实视口排版，仅原生浮层按创作画布缩放；目录定位在 Flow 视口内。图表块间距、小节标题与默认折叠状态同步到运行侧，目录导航展开隐藏目标的父小节。

## 当前证据

- `typecheck`、Player/Electron 构建通过。
- 协议/会话目标测试通过；覆盖真实 fixture 进程启动、失败、取消、持久化及 Claude 思考块后的正文合并。FlowWorkspace、FlowSurfaceHost、富文本编辑、产品集成、视口适配和 Runtime Flow 集成目标检查通过。JSDOM media/canvas 提示不作为真实媒体播放证据。
- 真实 Electron 普通讨论检查通过：回复文字在 CLI 结束前已出现，完整事件分页/重放为 215 条，聊天不写工程。
- 真实 Electron Flow 检查通过：空段、连续换行、字号/强调、引用、列表、小节和图表在编辑、试运行、保存重开、离线 HTML 的正文位置与尺寸匹配；列表编号和目录位置已作实际截图检查。证据：`output/playwright/r18-flow-spacing/{geometry.json,edit.png,run.png,offline.png,flow.html}`。
- 真实 Claude 的生成、继续改名、一次撤销、人工编辑、保存重开与离线 HTML 完整通过。原生 OpenCode 普通文字流实测首段约 14.3 秒，完成约 18.3 秒，共 54 段；Claude 原生文字流首段约 6.4 秒，完成约 13.5 秒。

## 未通过项与验证边界

- OpenCode/BigPickle 新传输的首轮生成和应用成功；第二轮返回包含未转义双引号的非法 JSON，严格拒绝并保留聊天，未写入第二次修改。更早一次还遗漏候选标记。已加强发送提示并明确无候选/候选错误状态，但不把模型输出稳定性写成通过。失败记录在 `output/playwright/r18-cli-opencode/failure-records.json`。旧 `run --format json` 的完整成功记录属于旧传输，不替代本次验证。
- Codex 新传输原生请求遇到服务连接超时；旧 `exec` 对照同样超时。未改用户的模型或全局认证设置，当前不宣称新的真实 Codex 生成已通过；界面可显示重连状态。fixture 仅证明传输接线和宿主行为。
- 未重跑全部格式导出、全部 E2E 或重新打包安装器。正文视觉对齐证据限于上述实际样本，不表示任意已有 Flow 工程已由教师逐一复核。
