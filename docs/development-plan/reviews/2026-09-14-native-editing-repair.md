# 2026-09-14 原生编辑与文件兜底修复记录

本轮完成开放修改、文件候选与续跑的实现和聚焦工程验证。OpenCode 首份快捷候选参数错误后自主转文件路径成功；两次 Claude 在明确指定文件路径的试验中成功。证据证明文件路径与结果可编辑性，不证明 Agent 自然选择快捷通道并首次完成。速度仍有明显原生执行耗时，不能宣称全面解决或 Owner S3 通过。原执行依据为[修复方案](../R18_USER_EXPERIENCE_REPAIR_PLAN.md)；后续[机制实施细则](../AI_AUTHORING_MECHANISM_IMPLEMENTATION_PLAN.md)已形成文档，尚未实施，不计入本记录的完成范围。

## 原事故归因

| 原记录 | 事实 | 结论 |
|---|---|---|
| OpenCode `998207a4-3d5a-420b-bc9b-739d1552c06b` | 约 503.8 秒，55 次工具结束、2 次工具失败，5 次 external_directory 授权全部允许，界面等待约 135.6 秒；没有候选和提交 | 不是用户没授权。模型把选区当成新增限制；软件既提供了这个错误限制，又把无候选文字结尾直接终止，未提供实际文件兜底 |
| Claude 通道 `8e9f891f-94a2-45e5-8bda-49e3f351d3ef` | 约 488 秒，78 次工具结束、1 次失败、两轮；第一次组合候选被 selection 规则拒绝，后续蓝底黄圆合并为一张 PNG 后提交 | 已有一条兜底路径，但丢失独立可编辑性。简单几何图形还借用另一 Maker 工程生图，存在多余往返与机器依赖 |

两轮已经联网并实际使用工具，不能把本次失败归为未开 TUN。网络直连复位与系统代理继承是此前另一个真实问题，本次在原生进程启动接线中处理。Claude 通道实际确认的模型为 `deepseek-flash[1M]`，不是 Claude 原厂模型的性能基准。旧日志中拆分的 text 事件不能直接当作聊天重复显示次数。

原始任务摘要和阶段时钟见[原日志审计](../../../output/native-editing-repair-20260914/source-audit.json)，没有用新结果覆盖原样本。

## 实现结果

- **焦点与能力分开。** 首轮仍只发送焦点所需内容，完整 V9 文档和全工程目标留在本轮暂存文件。选 A 改 B、跨页、替换与新增均可执行；删除 selection 的附带创建/未消费对象禁令，保留真实版本和依赖引用验证。选区提示可以辅助定位，不再开关权限。
- **正式文件兜底。** `project.document` 接受当前冻结文档的实际修改结果，包含新增/替换资源时同时回收真实文件数据；现有资源复用。保持工程 ID 与基线 revision，经严格 V9、资源/导出闭包、动态内容真实准入后进入原有 EditorTransaction，一次文档/资源/History 提交。没有第二 Store、模型循环或 live project 写口。
- **终态可恢复。** 编辑任务只有答复却没有任何修改回执时，回到同一原生会话给出文件兜底指引。沿用任务期限、无进展和格式修复上限；两次持续无候选回复会有界停止。已提交成果、真实 Stop、只读意图、版本变化和用户原生拒绝均按原 Owner 处理。
- **保留成果。** 已读入的实际 JSON 结果与媒体一样归当前逻辑任务管理，后续观察通过 `reusableArtifacts` 提供文件副本；过期/外部路径不能进入宿主事务。
- **原生权限与网络。** 当前任务和版本化能力文件的实际只读访问由应用给予一次读取许可，外部文件、命令、写入及其他原生请求仍走原生授权界面。没有永久 Always allow。显式 CLI 代理优先；未配置时读取当前系统 HTTP/HTTPS 代理并保留 loopback 直连，不写固定端口、不改全局环境。代理查询期间 Stop 不再导致 Claude 迟到启动。
- **等待可读。** 原生读、搜索、运行工具和准备文件映射为短活动描述；原始协议保留日志。任务结束后移除现在进行时的活动。授权界面保留做决定所需的文件/命令和原生选项含义。
- **减少额外探查。** 文件入口卡从 103,781 字节变为约 2.9 KB，完整文件制品 Schema 按需读取。文件 Schema 顶层是 `document`，候选顶层 `input.artifact` 只传文件引用。提示保留工程 cwd、使用绝对路径，避免进入过长 staging 目录；不禁用 CLI 工具或 Skills。变化的动态实例及相关布局/资源继续准入，普通原生编辑不重复运行无关动态宿主。

此前 medium/xhigh 显式传参与原生确认、CommonJS 导入初始化顺序、教师控制器缩放按钮随整体收起的修复继续保留。对应历史实测见[延迟与配置修复](../../../output/latency-review-20260913/repair-result.md)。本轮重新构建桌面入口，并通过编译产物加载与三个真实 Electron 任务启动验证。

## 原生验证与时间

使用[明确命名的真实用例](../../../tests/e2e/r18OpenEditingRepair.spec.ts)，每轮新应用 userData、新工程目录。UI 发送自然语言并选择模型/强度，原生 CLI、认证、配置、网络、工具和宿主提交均真实；仅系统文件选择器固定为测试自己的工程。没有写用户正在使用的工程，也没有替用户当前编辑器重启。

各用例要求：选中的第一页参照方形不变；另一页方形改纯绿，在正中心新增直径 120 的纯黄圆；两个独立原生图形，方形位置尺寸不变，恰好一次正式提交。

| 样本 | 实际模型 / 强度 | 任务开始至结束 | 工具结束 / 失败 | 原生轮数 | 权限弹窗 | 结果 |
|---|---|---:|---:|---:|---:|---|
| OpenCode `93584181` | `openai/gpt-5.6-luna-fast` / max | 414.9 秒 | 25 / 2 | 2 | 0 | s1 改色预演通过；s2 对 create 目标误用 content/update，整份候选零提交；续轮自主选文件路径，独立图形、一次提交、保存通过 |
| Claude 指定文件入口初版 `b1f83785` | `fable` → `deepseek-flash[1M]` / max | 208.0 秒 | 66 / 2 | 1 | 0 | 独立图形、一次提交、保存通过；出现一次错误路径与一次 Windows 长 cwd 错误 |
| Claude 指定文件入口精简版 `4d6aa103` | 同上 | 167.0 秒 | 57 / 1 | 1 | 0 | 独立图形、一次提交、保存、实际重开、分别选择和视觉检查通过；无长 cwd 错误 |

完整测试运行分别约 7.5、3.9、3.5 分钟，包含窗口准备/配置/保存/重开/结束；表中任务计时来自应用 `execution.startedAt` 至 `taskEnded`，不能混用。Claude 两次有明确“走文件兜底”的任务指引，OpenCode 没有指定文件入口。原事故是修改图片，新 fixture 是编辑原生形状，不能将原事故与新用例的时差作为同任务加速率。

OpenCode 初版第一轮技术提示为 20,853 字节，续轮 25,603 字节；后续焦点裁剪与去重已通过完整首轮提示预算用例，未重跑最终提示的 OpenCode 性能样本。两个 Claude 样本输入分别 12,836 与 12,791 字节。最后 Claude 仍自行编写验证器，曾把文件内容当候选 envelope 验证；模型修正后已提交，随后发现资源已改为直接对应文件内容的 Schema。此最后 Schema 修正和完成活动清理通过针对性回归及构建，没有为这两处再重复计费跑完整原生任务。

最后 Claude 首个工具活动在任务开始后约 9.4 秒，原生接受到候选解析约 160.9 秒，候选到宿主结果约 0.1 秒。OpenCode 两阶段原生执行约 236.8/158.2 秒，候选到宿主结果约 0.06/0.08 秒。**剩余瓶颈在原生执行与多次工具往返；日志不足以把剩余时间全部命名为推理或网络。** 同通道单样本从 208 到 167 秒有改善，不能证明稳定百分比收益或其他模型相同表现。

证据：

- [各轮计时与配置汇总](../../../output/native-editing-repair-20260914/verification-audit.json)
- [OpenCode 正式结果](../../../output/native-editing-repair-20260914/opencode-1789320194083/acceptance.json)
- [Claude 初版结果](../../../output/native-editing-repair-20260914/claude-1789320829854/acceptance.json)
- [Claude 精简入口与重开结果](../../../output/native-editing-repair-20260914/claude-1789321890006/acceptance.json)
- [重开后独立选中圆形的实际画面](../../../output/native-editing-repair-20260914/claude-1789321890006/reopened-target.png)

## 工程检查

后续路径核查补充：[同一初始工程快捷隔离验证](../../../output/native-editing-repair-20260914/quick-path-verification.json)复现了 s2 错误与零 live 写入，再用 content 修改方形、insert 圆形、content 设置黄色一次提交；保存重开和 Undo/Redo 通过。此验证未调用模型，不计入上表原生轮次、速度或首次准确率。修复后文件结果中圆形为 `kind:native / nativeType:shape / shapeType:ellipse`，宿主负责渲染和编辑；它与最早合并 PNG 的结果不同，也与直接调用创建快捷命令的路径不同。

| 检查 | 有效结果 / 覆盖 |
|---|---|
| `combined-final.log` | 11 文件 245 通过：generationSnapshotFocus、generationSelectionActions、semanticAuthoringTools、projectDocumentFallback、generationTaskController、generationBackgroundEntry、courseChatObservation、courseChatPanel、generationCapabilityWorkspace、nativeTaskIntegration、candidateMediaStaging |
| `native-final.log` | 5 文件 213 通过、1 跳过：localAgentHarnessV2、Claude/OpenCode/Codex adapters、electronBuiltContract；跳过项为另行启用的 live Codex discovery，不计通过 |
| `final-delta.log` | 4 文件 137 通过，替代对应旧结果：generationCapabilityWorkspace、courseChatPanel、generationSelectionActions、semanticAuthoringTools；包含新加的完成后活动清理用例。以上不累计重复测试数 |
| 文件事务 | 跨页和独立对象提交、V9 保存重开、Published 生成、一次 Undo/Redo；坏资源、未知字段、错误工程/版本、动态准入拒绝、迟到应用零 live 写入 |
| 原生接线 | 任务只读一次许可、外部/执行/写入/链接逃逸不自动放行；不同动态代理地址与显式设置优先；代理查询期间 Stop；无候选有界续跑，同一原生会话 |
| 最终类型与构建 | `npm run typecheck`（renderer/main/e2e）和 `npm run build:desktop` 通过；构建仍有既存大 bundle 提示，不是本次原生任务等待的证据 |

日志保存在[本轮输出目录](../../../output/native-editing-repair-20260914/)。严格解析/回滚由针对性检查证明，实际动态效果准入沿用正式宿主；本轮真实生成用例只新增 Native 图形，不冒充新 Runtime/Component 的真实视觉验收。

## 迁移与交付边界

本机的新应用 profile 和不同暂存路径通过，代码没有绑定当前用户目录、固定代理端口或另一 Maker 工程。原生 CLI 的已安装登录和配置仍来自本机，这不是第二台物理机器的完整安装验收。迁移机器需要可用的 CLI、账号和网络；特殊 PAC/SOCKS 配置仍以原生支持为准，本次系统桥接处理 HTTP/HTTPS 代理。

未提交或推送代码，保留原有工作区改动；当前运行中的用户编辑器未被强制重启。保存用户当前工程并重新启动软件后加载新构建。Owner S3、完整三 Surface 原生矩阵、其他物理机器验收均未因此自动通过。
