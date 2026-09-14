# 2026-09-14 创作机制与 Codex 快速模式实施记录

本次实现 [机制方案](../AI_AUTHORING_MECHANISM_IMPLEMENTATION_PLAN.md) 的 M0–M4/M6 当前纵切及新增 F0。M5/B2–B4 完整任务族继续归 1.9。本记录只证明列出的工程行为与真实样本，不代表 Owner S3/S4 或第二台机器验收。

## 实现与效果

1. **原生操作可组合。** `native.content` 创建时可直接提供图形、文字、公式、表格、图表已有 Schema 的内容与样式；新增 `edit-shape` 局部修改和 `placement:center` 相对布局。真实工厂、属性命令与当前有效状态负责默认值、身份和坐标，不要求模型手写完整原生对象。命名状态的居中使用有效尺寸。
2. **前序结果按真实依赖执行。** coordinator 在当前私有文档/资源上逐步解析并展开语义操作；公开 step 可引用前序创建对象、页面背景和素材。导入资源通过原语义 step 对外提供。新页目标不再由“当前选中对象”限制。所有步骤准备成功后只提交一次工程/资源/History；任一步失败零 live 写入。
3. **能力与执行条件同源。** 工具声明的 operation/target/parent/必要资源条件同时用于真实执行、发现卡和离线候选帮助程序。生成卡按实际任务组合创建与修改入口、去除重复 Schema 描述。`candidate-helper.mjs` 随能力包提供，使用正式 parser，可在没有仓库和 node_modules 的中文目录运行；静态预检不冒充宿主准入。
4. **恢复保留准确原因。** 错误包含 step/path 与代码驱动的恢复建议；不再把操作组合不支持解释成选择授权范围。文件结果必须匹配当前私有基线，禁止旧整份文件覆盖前序准备。原生 CLI 与 `project.document` 继续开放，不要求先让快捷入口失败，也不绕过真实授权、Stop 或动态宿主准入。
5. **结果检查。** 明确提供的原生类型、内容、样式和几何检查实际有效结果；独立对象要求由自然任务的工程结构、选择和保存重开检查验证。未知自然语言意图没有被假装成通用自动语义判定。
6. **传输与续跑效率。** OpenCode 旧限额混算正文和工具协议，真实样本遭 `output-limit`。现在单消息 32 MiB、正文 8 MiB、回合协议 128 MiB，日志报告实际字节与限额，回放仍排除于正文计数；Claude 单消息同为 32 MiB。失败回执摘要不再重复内嵌截图 base64，本地原始证据和续跑经校验的图片资源保留。

## F0：Codex 快速模式

入口为创作助手 → Codex → 配置 → 速度。提供“沿用原生设置”“标准速度”和当前模型原生目录实际支持的速度档。选择前显示增加用量消耗提醒，不承诺统一费用倍数；默认不自动开启。

本机 codex-cli 0.154.0 `model/list` 实际返回 Fast 的 RPC ID `priority`，标准 ID `default`。目录、设置、偏好、thread/start、thread/resume、turn/start 和任务 requested/sent/confirmed 使用同一可选 `serviceTier`。没有修改用户全局配置或原生权限；速度独立于模型/思考强度，模型切换后不支持原速度时显式回到标准。

真实 AG01 Codex 记录确认：`gpt-6-astra / medium / priority` 从请求、发送到原生确认一致。关闭快速模式由原生协议进程测试验证发送 `default`，不是省略字段继承 Fast。旧 CLI 没有速度目录时不假造 Fast。费用说明依据 [OpenAI Speed 文档](https://learn.chatgpt.com/docs/agent-configuration/speed)，ChatGPT credits 与 API key 的计费方式不能混称。

## 自然指令实测

样本位于 `output/native-editing-mechanism-20260914/`。所有自然用例只给用户目标，不指示工具名、快捷/文件路线或操作顺序。配置不同，下面时长为单次 Playwright 用例墙钟（含启动、任务、校验和保存重开），不是纯模型时间，也不是对照性能结论。

| 样本目录 | 结果 / 路线 | 时长与限制 |
| --- | --- | --- |
| `opencode-1789359333460` | 首次样本准备中 output-limit，未提交 | 约 2.7 分钟；保留失败，旧日志不能区分单帧或累计阈值 |
| `claude-1789359495265` | 自然指令成功，`project.document` 生成两个原生对象 | 约 2.8 分钟；不是快捷首轮证据，候选前有原生工具内部纠错 |
| `opencode-1789360002895` | AG01 首份候选 `native.content` 修改＋创建；零宿主拒绝，保存重开并分别选择 | 约 2.9 分钟；Luna-fast / max，未确认底层 resolved model；候选前有一次原生工具失败 |
| `claude-1789360179525` | AG01 首份候选 `native.content` 修改＋创建；零宿主拒绝，保存重开并分别选择 | 约 3.2 分钟；通道 fable / max，原生确认 `deepseek-flash[1M]` |
| `codex-1789360372029` | AG01 首份候选 `native.content` 修改＋创建；零宿主拒绝，保存重开并分别选择 | 约 1.4 分钟；Astra / medium / priority 全链确认 |

三份 AG01 成功样本都保持当前选中的参照方形不变，修改另一页目标方形并新增独立原生黄圆，只有一次正式提交、没有权限问题弹窗。OpenCode 候选前内部纠错不计作宿主拒绝，也没有从记录隐藏。原始 `result.input.json`、`result.native.json`、`acceptance.json`、保存工程与重开截图为证据。

AG02 `AG02-opencode-1789360754725` 用时约 4.5 分钟，首份候选为 `asset.image.transform + native.content`，零宿主拒绝、一次提交。原图片红色区域变绿，9,445 个透明像素及 3,496 个白色像素全部保留；右下共享原素材实例、标题及其他图形不变。新增直径 120 的居中黄色原生圆形，保存重开后与图片分别选择；已经人工查看实际重开截图。

AG01 原始输入时间至首次正式提交：OpenCode **129.839 s**、Claude **152.690 s**、Codex Fast **41.275 s**；AG02 **213.464 s**。派发至候选分别为 112.551 / 142.858 / 32.407 / 196.072 s，包含原生推理、工具与网络，不等于纯模型推理；候选解析至提交分别为 86 / 1,025 / 62 / 113 ms。均为一轮原生 turn、零应用格式修复。提取结果保存在 `verified-timing.json`。模型/强度不同且每组仅一份，不能据此归因 Fast 或 harness 的加速比例。

AG03 `AG03-claude-1789361023705` 首份候选为 `slide.structure + media.apply`，通过 created-background 引用新页，复用既有图片素材；零宿主拒绝、一次提交，原页场景完全不变，新页保存重开与实际画面正确。输入到提交 **382.809 s**，解析候选至提交 **1.038 s**。原生工具出现 7 次失败事件及一次广域递归搜索；读了宿主源码来确认操作和显示语义，不能把此样本当作脱离源码的纯能力包可发现性证明，也不把原生纠错隐藏成“全程无错”。跨机器 helper 可运行由 QP06 单独证明，第二台机器自然模型首轮仍未实测。AG04/AG05 按后续能力批次补充。

AG03 的所有产品断言与 acceptance.json 写入后，隔离 Electron 进程已退出，但测试仍停留于关闭阶段；人工终止该测试 worker。因此 AG02/AG03 这条命令最终是 **1 passed / 1 failed（收尾异常）**，不能写作 2 passed。关闭帮助程序原来同时安排 app.quit 并调用 Playwright close，现只由 Playwright close 负责退出；不调用模型的 `native fixture closes an isolated editor without a competing quit call` smoke **1 passed（7.7 s）**，最后类型检查通过。此修复不追认原 AG03 命令通过，也不重复付费任务。

## 检查与证据范围

- 已通过三套 TypeScript 配置检查及桌面 Player/Renderer/Electron 构建。
- 12 个受影响测试文件的一次聚焦回归：370 passed、1 skipped、1 旧观察替身失配。补齐替身后暴露并修复了回执图片重复正文；`generationFailureFeedback + localAgentHarnessV2` 63 passed。跳过项不计为通过。
- 新增 QP08 混合原生准备后提交旧文件：准确 baseline 冲突与 refresh-baseline、工程和资源零写入，1 passed。QP01 多表面/命名状态、QP02 语义结果与错误引用、QP03 新页及资源依赖、QP05 输入/目标条件、QP06 可移植 helper 包含在上述聚焦回归。
- 以上有效证据合计覆盖 372 个通过的聚焦测试，1 个原有跳过项不算通过；后续修改只重跑受影响检查，没有因文档更新重跑付费矩阵。最后变更后的三套类型检查通过；桌面构建完成后，针对回执投影改动再次编译 Electron。新文档相对链接检查与按 CRLF 解释的相关 diff 空白检查通过。
- 原生 Fast/off 参数及配置 UI、OpenCode 大工具消息/正文上限/回放、Claude 传输、既有取消/拒绝/续跑生命周期均在受影响测试中。关闭 Fast 的真实模型付费任务没有重复执行，参数行为由原生协议进程检查覆盖。
- 不重新统计历史 49/60，不声明完整 B2–B4、全模型自然成功率、稳定加速比例、第二台物理机器或 Owner 接受。当前真实用例验证编辑与保存重开；完整 Player/导出版本门仍按原方案执行。

复现入口（真实 CLI 单独显式开启，不由单元回归隐式触发）：

```powershell
npm run generate:ai-capabilities
npm run typecheck
npm run build:desktop
npx vitest run tests/unit/semanticAuthoringTools.test.ts tests/unit/generationBackgroundEntry.test.ts tests/unit/generationCapabilityWorkspace.test.ts tests/unit/nativeAgentConfiguration.test.tsx tests/unit/codexAppServer.test.ts tests/unit/openCodeAcp.test.ts tests/unit/claudeProcessTransport.test.ts tests/unit/projectDocumentFallback.test.ts tests/unit/generationFailureFeedback.test.ts tests/unit/generationTaskController.test.ts tests/unit/localAgentHarnessV2.test.ts tests/unit/generationSnapshotFocus.test.ts
$env:COURSEWARE_OPEN_EDITING_REPAIR='1'
$env:COURSEWARE_E2E_BACKGROUND='1'
npx playwright test tests/e2e/r18OpenEditingRepair.spec.ts --grep 'AG01 natural mechanism' --workers=1
npx playwright test tests/e2e/r18OpenEditingRepair.spec.ts --grep 'AG02 image composition|AG03 new page media' --workers=1
```
