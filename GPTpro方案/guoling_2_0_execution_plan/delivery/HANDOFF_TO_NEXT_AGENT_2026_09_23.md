# 给下一位 Agent 的接续提示词（2026-09-23 收尾快照）

请接手 `D:\果铃工作台` 的果铃 2.0 **现有工程**继续开发，不从头重做、不清理整个脏工作树、不把旧 1.x 路线当当前门槛，也不要先提交、推送、打包发布。Owner 已授权持续实现、已授权的 DeepSeek 文本模型与 GPT OAuth 图像验证；凭据已在 Windows User 环境，运行时读取，不要在聊天、日志、工程或发布包中写出值。当前没有活跃子智能体占写锁，Electron GUI 已释放。

## 先读并按事实接续

1. `D:\果铃工作台\AGENTS.md`、`果铃2.0收敛方案.md`、`GPTpro方案\guoling_2_0_execution_plan\03_TASK_INDEX.md`、`docs\development-plan\TASK_BOARD.md`、`docs\development-plan\WORKING_PROTOCOL.md`，涉及 Schema/Surface/保存/导出/网络时读对应架构合同。
2. `GPTpro方案\guoling_2_0_execution_plan\delivery\AGENT_HANDOFF.md` 及 `mid_term\WORKBENCH_EDITOR_LAYOUT.md`；正式依赖/验收只看 `task_registry.json`、`acceptance_cases.json` 和真实证据，不把方案或截图当产品通过。
3. 最新集成证据在 `GPTpro方案\guoling_2_0_execution_plan\evidence\B07_2026_09_23_INTEGRATION.md`；当前验收 164 项：**109 passed / 54 not_run / 1 failed**。任务 28 项：4 verified / 22 in_progress / 2 planned。`python tools/refresh_plan.py` 与 `python tools/validate_plan.py` 已通过；它们只验证方案一致性，不是产品测试。

## Owner 已定的体验与架构边界

- 工作台左中右三栏：左上资源管理器、左下会话，中央文档，右侧类似 Codex 的持续对话，模型选择常驻聊天框位置。不要恢复多余的当前位置/试运行/三层顶部栏。底部紧凑场景卡片与所属状态按钮；资源/会话与文件正交。
- 专业编辑器独占主体窗口，顶部不显示工作台三栏，编辑器内嵌“返回工作台”；仍是同一 DocumentSession/资源/History。原位元素 AI 必须在右助手收起时可完成。
- Gateway 是统一能力入口，DocumentSession 只管文档内容与事务；成果按真实状态分别提交/保存/验证。受控构建/图片/外部 MCP、可信扩展准入继续沿用现有架构；未来 runner/独立 HTML 等不凭方案补充启动核心重构。
- 按已明确选派原则用尽可能多的**真正可并行**子智能体：Sol XHigh 做开发，Astra XHigh 做独立反例/架构复核，Luna Max 做机械检查；最多 7 槽含主代理。先定精确互斥写域，Electron GUI 一次仅一组；保持滚动交付，不只做计划。

## 本轮已完成并登记

- M07-T06 会话左栏管理、S09-T01 资源树重命名后继续 AI/保存、M10-T06 资源管理器右键/键盘/拖拽与既有三表面媒体拖入，实际 Electron 通过。
- M03-T07 工作台四类插入、编辑/资源保存与画布内就地 AI 浮层；M06-T02～T05 Flow/Markdown 原位生成、停止迟到零写入、一次 History 与人工改动、仅最终输出能力提示；M08-T05 正文/聊天/HTML 图文/文件/真实 Windows IME 粘贴，实窗通过。具体测试名、截图、回执和边界均在 B07。
- S11-T01 已补图片预处理/fetch/响应头/终止、逐请求终止和 save.started 的同钟计时；独立 Astra 三个停止与归因反例修后重演通过，聚焦 8/8、图片 7/7。**正式仍 not_run**，旧真实运行缺失的计时不能反补，需新真实任务验证。
- 统一桌面构建 `output\g20\b07\build-closeout-20260923.log` exit 0；刷新和校验计划通过。S14 人工修复副本 `output\g20\s14\salvage\run-jBhDpt\截图生成原生课件-排版修复.h5lesson` 已正式 Gateway 提交/保存重开并经实窗看无图文遮挡，截图在同目录 `visual-T4vPSN\salvage-desktop.png`。这是人工工程候选，**原 S14-T03 真实模型首轮仍 failed**，Owner/教师视觉教学接受未完成。

## 应先处理的真实缺口

1. **S14-T03 producer：** 独立审查发现 `ToolTargets.childTargets` 不从 document/surface/location/owner 暴露 course-background，首轮模型无法发现背景句柄；图像工具 schema 公布了冻结 OAuth provider 会拒的 moderation/JPEG/WebP/xhigh/max，首轮 moderation:auto 在发送前失败。Native 标签 height 62 + padding 24 + shrink 实际约 11px，背景只设颜色未设 opacity；改同源 schema/反馈与能力投影，不另建 writer、不要改 renderer 默认值掩盖原因。图片成果卡已允许明确 frame，但默认建议不自动避让。原真实模型 run 在 `output\g20\s14\real-combo\run-jBhDpt`，修复副本不能冒充首轮成功；原图中的静态三标签是该次测试提示要求的 Native 文字，不要误报缺少已要求互动。先用零网络定向测试修 producer，再判断是否需要有新假设的付费复测。
2. **S13-T01 受控构建真实 API：** `ControlledBuildService` 已补组件 digest 诊断，本地 1/1。唯一 TeamoRouter、请求型号 `deepseek-flash` 的实窗尝试在组合初始化 1.4s 收通用 `EXECUTION_FAILED`，无 runId/usage；旧临时 profile 已清理，不能证明是否发出网络请求或零费用。`output\g20\s13\real-api\last-failure.json`；新 `tests\e2e\g20ControlledBuildRealApi.spec.ts` 已拆 connection/open/workspace/conversation/draft/send 阶段、保留脱敏诊断。先用本地 fixture 定位工作空间注册/IPC，再有可证伪新假设才跑**一次**付费测试，不要同因盲重试。正式仍 not_run。
3. **M06-T01 与 S11-T01：** 新真实支持流式模型的原位首片到可见目标 ≤200ms、完整图片/保存时间线仍需真实运行。现有本地 SSE/服务夹具只证明机制；记录真实路由、模型、请求/工具/提交/保存与冷/热、人工介入和成本，不把不同模型的速度差归因于 harness。
4. 其余 54 个 not_run 按 `acceptance_cases.json` 和真实依赖选独立叶子；S14-T03 唯一 failed。既有 passed 证据未受相关变更影响则复用，不重跑全套。Owner 产品视觉接受仍单列。

运行新模型测试时遵守 `AGENTS.md`：开发主路由 TeamoRouter DeepSeek，第二路由官方 DeepSeek，按供应商实际目录固定型号、实际计费和能力；外部 CLI 若确需使用只走已授权模型。长期凭据不进入工程或发布包，产品连接用独立安全存储。前次工程包的两条具体密钥精确扫描均为 0，未来新发布包仍须重新检查。当前没有 PR、commit、push 或发布动作；请延续现有写域和证据，不把当前工作树重置。
