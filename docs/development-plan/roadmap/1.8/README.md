# 1.8：CLI 直连、Skills 与基础聊天（默认隐藏）

## 结果与边界

2026-09-06 Owner 决定：取消产品 MCP 路线。当前软件把任务、所选上下文快照和 Skills 直接发给 Codex、Claude、OpenCode，CLI 自己完成规划与工具循环并返回候选；宿主复用 1.7 的校验、动态准入与 1.4 canonical commands 应用结果。原 MCP server 和 MCP 工具映射节点删除，不另换名称建设 RPC 或 Agent 中间层。

基础聊天框从 1.9 前移到本版，直接接 1.6 会话与 1.7 生成机制，包含引用、流式结果、真实事件时间线、安全消息渲染、预览、Stop、Undo 和多轮修改。CLI 原生工具事件不等于编辑器已经改动工程，只有宿主提交回执代表成功写入。1.9 继续完成聊天记录的恢复、迁移、删除和真实课例打磨。

每轮由宿主组装不可变最小快照；继续对话复用 CLI 会话但提供新的请求身份、目标与 revision，并带入必要的上轮候选检查/提交结果。CLI 不取得 live Store 或工程读写接口。教师并发编辑、Save As、关闭工程或 Stop 后，旧结果不得写入，也不得自动换 revision 重试。

AI 入口默认隐藏。S3 Owner 验收 1.6–1.8 的 CLI 生成与基础聊天后发布 `v1.8.0` accepted 源码标签，不发布 HTML 或安装器；2.0 才在普通内部生产构建正式开放。

PPTX 人工导入增强仍为本版必选：简单 SmartArt/流程层级图和受支持旧 OLE 公式的可编辑导入，不受 AI 开关影响。

## 任务 DAG

| Task ID | 结果 | Dependencies | Optional | Write locks | Acceptance |
| --- | --- | --- | --- | --- | --- |
| `r18-010-context-snapshot` | 组装当前选择、当前页、整课、材料和能力 / 诊断的请求快照 | `r17-000-generation-contract`, `r15-020-material-tools-citations` | 否 | `ai-session` | 复用 1.7 请求合同和现有只读能力；每轮发送前由宿主取得 project identity、document revision、canonical target 与已选择的最小内容；跨工程引用拒绝，材料原文只随明确选择发送；组装不改变工程、选择、历史或材料索引；继续会话须更新本轮快照，不能以 CLI 旧记忆代替当前事实 |
| `r18-020-neutral-agent-profile` | 用中立请求配置组装三种 CLI 的任务、Skills 和结果通道 | `r17-060-release`, `r18-010-context-snapshot` | 否 | `generated-index`, `cli-adapters` | profile 只声明任务指令、skill roots、上下文预算、候选合同版本、结果通道和 adapter capability；会话恢复复用 1.6，候选应用复用 1.7；不得新增 MCP server、工具 RPC、模型规划循环或第二 tool catalog；不含 Provider key；在 tests/unit/coursewareSkillsContract.test.ts 验证三 CLI 配置及不支持的结果通道明确失败 |
| `r18-021-codex-profile` | Codex 直接接收任务与 Skills 并返回候选 | `r18-020-neutral-agent-profile`, `r16-011-codex-adapter` | 否 | `generated-index`, `cli-adapters` | fixture 与真实 Codex 会话均接收同一请求语义、加载 Skills、输出可解析候选并由宿主返回提交结果；继续会话可根据新指令、新快照与上轮结果完成第二次修改；CLI 自己规划和使用其原生工具；不要求它发现或调用编辑器 MCP，不把原生 tool result 当成工程提交凭证 |
| `r18-022-claude-profile` | Claude 直接接收任务与 Skills 并返回候选 | `r18-020-neutral-agent-profile`, `r16-012-claude-adapter` | 否 | `generated-index`, `cli-adapters` | fixture 与真实 Claude 会话均接收同一请求语义、加载 Skills、输出可解析候选并由宿主返回提交结果；继续会话可根据新指令、新快照与上轮结果完成第二次修改；CLI 自己规划和使用其原生工具；不要求它发现或调用编辑器 MCP，不把原生 tool result 当成工程提交凭证 |
| `r18-023-opencode-profile` | OpenCode 直接接收任务与 Skills 并返回候选 | `r18-020-neutral-agent-profile`, `r16-013-opencode-adapter` | 否 | `generated-index`, `cli-adapters` | fixture 与真实 OpenCode 会话均接收同一请求语义、加载 Skills、输出可解析候选并由宿主返回提交结果；继续会话可根据新指令、新快照与上轮结果完成第二次修改；CLI 自己规划和使用其原生工具；不要求它发现或调用编辑器 MCP，不把原生 tool result 当成工程提交凭证 |
| `r18-030-course-skills` | 提供 `course-design`、`course-build`、`qa-repair`、`style-remix` 产品 Skills | `r18-020-neutral-agent-profile` | 否 | `generated-index` | 每个 Skill 明确输入、停点、允许的候选意图和交付物；`course-design` 不越过教师确认写工程，`course-build` 只消费已确认两份 Markdown 并输出 1.7 候选，`qa-repair` 最多一次局部修复，`style-remix` 输出正式槽位修改意图，由宿主执行；三种 profile 均能加载；Skills 不指示 CLI 调用 live 工程接口 |
| `r18-031-editing-craft-skills` | 提供 `pro-editing`、`visual-craft`、`interaction-craft` 产品 Skills | `r18-020-neutral-agent-profile` | 否 | `generated-index` | 三个 Skill 分别限定编辑范围、视觉检查和互动宿主选择；都遵循 Native → Recipe → Existing Component → Generated Component → Runtime 阶梯；不会建议直接改 `.h5lesson` / Store / 源码；三种 profile 均能加载；只指导生成候选及候选自身的检查，不要求 live 工程工具 |
| `r18-040-staging-file-boundary` | 启用文件工具的 CLI profile 通过当前 session staging 摄取约束 | `r18-020-neutral-agent-profile`, `r17-010-staging-workspace` | 否 | `ai-session` | 对三种 profile 逐项判定：stdout-only 明确 N/A；启用文件工具时工作目录/允许路径指向当前 staging，宿主只摄取 realpath 闭合文件并拒绝绝对外部引用、`..`、外链 symlink、其他 session 和 `.h5lesson`；不宣称 OS sandbox；宿主复用 r17-013/r17-023 校验、准入和原子提交，CLI 无工程文件写入口；在现有 `tests/unit/scopedValidationWorkflow.test.ts` 增加配置/摄取失败用例 |
| `r18-041-human-concurrency` | 多轮 CLI 请求与人工编辑保持身份、版本和提交一致 | `r17-013-host-candidate-commit`, `r18-010-context-snapshot` | 否 | `store-kernel`, `ai-session` | 在 tests/unit/courseAuthoringSession.test.ts 和 tests/unit/editorTransaction.test.ts 覆盖快照后教师修改同/其他 target、Save As、关闭工程、Stop 和继续会话；按既有 revision/session generation 合同拒绝迟到或过期候选且零写入；不自动把旧候选换成新 revision 重放；无冲突候选仍由唯一提交器形成一个历史事务；receipt 进入下一轮显式上下文，不触发软件自建模型循环 |
| `r18-042-chat-shell` | 内置聊天框直接接入 CLI 会话、输入与运行状态 | `r17-020-single-page`, `r16-030-cli-lifecycle`, `r18-020-neutral-agent-profile` | 否 | `chat-ui`, `ai-session` | 受控开关下可新建/切换会话、选择三 CLI、发送并继续对话；经现有 Main/preload localAgent 路径发送任务与快照，流式状态对应同一会话；无需 MCP 或自建 Agent；未通过其余聊天验收前只供开发接线，不能宣称完整工作流；普通构建无入口，聊天失败不影响画布、保存和 Player |
| `r18-043-context-references` | 聊天消息显式引用当前选择、当前页、整课和材料 | `r18-042-chat-shell`, `r18-010-context-snapshot` | 否 | `chat-ui`, `ai-session` | 发送前显示引用名称、范围与 revision，只发送明确选择的内容；会话继续时重新组装当前快照，旧消息引用保持原样；跨工程/已删除引用拒绝；不按材料类别阻止发送，不全量灌入工程；UI 直接调用宿主快照组装器 |
| `r18-044-tool-timeline` | 时间线显示 CLI 原生事件、候选检查和宿主提交结果 | `r18-042-chat-shell`, `r17-013-host-candidate-commit` | 否 | `chat-ui`, `ai-session` | 复用 1.6 sequence/session 事件和 1.7 candidate/commit receipt；原生 tool-call/result 与真正的工程提交分别显示；仅对宿主结果展示 canonical target、revision、finding 和可撤销事务；CLI 未提供的 tool/usage 字段明确不可用，不从终端文字伪造；当前会话重放去重在 tests/unit/serializedSessionMount.test.ts 验证，不建立第二事件 writer；重启与迁移验收由 1.9 承担 |
| `r18-045-safe-markdown-formula` | Chat 消息和公式安全、可复制、可访问地渲染 | `r18-042-chat-shell` | 否 | `chat-ui` | Markdown 标题 / 列表 / 代码和受支持公式正确显示；`script`、事件属性、危险 URL、原始 iframe / HTML 不执行；恶意 fixture 不产生网络或 DOM 事件；键盘可遍历消息与复制原文，渲染失败显示安全文本 fallback；本节点在现有 `tests/unit/formulaNodeUi.test.tsx` 增加并通过 Chat 恶意 Markdown / 公式 fallback 用例 |
| `r18-046-stop-undo-stale` | 变更预览、Stop、迟到结果防护、stale 提示与 AI 写入 Undo 闭环 | `r18-044-tool-timeline`, `r18-041-human-concurrency` | 否 | `chat-ui`, `store-kernel`, `ai-session` | 提交前预览列出 canonical target、old / new 摘要和预期 revision；Stop 调用 adapter cancel 并递增 session generation；Stop 后到达的 text 可标迟到但 候选与原生 tool result 均不得触发工程写入；教师并发修改显示 stale target；一次成功 AI 提交只有一个历史事务，若后续没有教师事务，Undo 精确恢复；若已有后续教师事务，按现有历史语义提示或禁用该快捷撤销，不能越过后续历史选择性回滚 |
| `r18-050-three-cli-benchmark` | 三种 CLI 经聊天完成同一课例生成与多轮局部修改 | `r18-021-codex-profile`, `r18-022-claude-profile`, `r18-023-opencode-profile`, `r18-030-course-skills`, `r18-031-editing-craft-skills`, `r18-040-staging-file-boundary`, `r18-043-context-references`, `r18-045-safe-markdown-formula`, `r18-046-stop-undo-stale` | 否 | `cli-adapters`, `chat-ui` | 三种真实 CLI 分别从聊天引用材料生成同一页，再继续会话完成同一局部修改；记录实际 CLI 事件、候选、宿主 receipt、载体选择与耗时；覆盖 Stop、教师并发 stale、失败零写入和 Undo；产物可人工编辑、保存重开、Player/HTML 运行；缺失任何 CLI 明确失败，不用其他 CLI 代替；在 tests/e2e/stabilizationCoreUsability.spec.ts 补真实聊天闭环 |
| `r18-051-pptx-editable-diagrams` | 增强简单 SmartArt 与流程层级图的可编辑导入 | `r17-041-pptx-editable-charts` | 否 | `app-save-recovery`, `store-slide`, `export-pptx`, `generated-index` | 首批仅覆盖线性流程、层级组织和循环三类能确定读取的图示，转为现有 Native 文字/形状/连接线并保留阅读顺序；复杂布局与未知语义继续用可靠明确的未支持项报告；修改图示文字、位置后保存重开和导出正确，不新增独立 SmartArt 引擎或第二工程模型 |
| `r18-052-pptx-legacy-equations` | 将受支持旧OLE公式转换为可编辑Native公式 | `r17-042-pptx-shape-geometry` | 否 | `app-save-recovery`, `store-slide`, `published-slide`, `export-pptx` | 按真实27个Equation OLE放置对象建立公式集，识别容器与Equation/MathType结构，首批数字符号/分数/上下标映射既有Formula AST，按当前能力保留行内位置和阅读顺序；源WMF仅作核对显示依据，不以图片冒充可编辑公式；无法表达的对象明确类型/页码/原因，禁止执行OLE；公式可修改并保存重开、Undo/Redo、Player/HTML与适用导出，源包显示图自动导入另行决定，不恢复整页渲染后备 |
| `r18-060-release` | Owner 验收 S3 CLI 生成与基础聊天并发布 v1.8.0 accepted 源码标签 | `r18-050-three-cli-benchmark`, `r18-051-pptx-editable-diagrams`, `r18-052-pptx-legacy-equations` | 否 | `none` | Owner 在同一固定课例完成 S3 CLI 生成与基础聊天验收：覆盖 1.6 的三 CLI 会话和人工隔离、1.7 的生成/局部编辑/动态载体准入、1.8 的 直接 CLI 请求/Skills/聊天引用与安全渲染/Stop/Undo/人工并发 stale 与 staging 边界；检查保存重开、Undo、Player、HTML、诊断和失败零写入，晋升 1.6–1.8 已验收行为到保全矩阵，签署 accepted 后创建 `v1.8.0` 源码标签；普通构建仍隐藏；本版新增 PPTX 增强节点也必须达到其验收边界，不能只完成 AI 主线即发布 |

执行顺序：快照与 profile 复用现有合同，三 CLI 配置和 Skills 汇入基础聊天；引用、时间线与消息渲染共享 chat-ui，须按写锁串行或明确拆分 Owner 后执行。Stop/Undo 汇合并发语义，三 CLI 的真实聊天闭环与 PPTX 两条增强线全部通过后进入 S3。聊天接线不等待任何 MCP 节点。

## 接口与数据合同

- 纯问答或教学策划允许只返回文字/Markdown，不强求工程候选；只有明确的工程修改候选才进入校验与提交，不能把普通回答或原生工具日志解析成工程写入。
- 请求、candidate、admission 和 commit receipt 的唯一合同与提交器来自 1.7；本版只补必要的会话接线和 UI，不再定义一份 intent schema、工具注册表或写入器。
- profile 是任务配置：版本、adapter capability、Skills、上下文预算和候选结果通道；不包含 server launch、模型推理步骤或 Provider key。三 CLI 参数可以不同，候选与工程语义必须相同。
- Skills 指导 CLI 基于快照、正式能力索引和已确认 Markdown 生成候选。未提供的工程信息在下轮请求补充，不指示 CLI 直接读取 Store、修改 .h5lesson 或调用 live 产品工具。
- 有文件工具的 adapter 使用当前 session staging，宿主只摄取当前 candidate root 内 realpath 闭合的内容；stdout-only 不承担文件工具 conformance。复用 1.7 的摄取与清理检查，不宣称通用 OS sandbox。
- 基础聊天消息保留纯文本源、role、引用快照、adapter/session、sequence 与 render version；复用 WorkspaceIdentity 和 1.6 store owner，必要的本地 schema 扩展严格解析。消息不进工程与导出；1.9 任务负责重启、迁移和删除的完整 UI 验收。
- 当前支持矩阵仍为三 CLI。未来脱离 CLI 时采用模型 API + 自有工具 + 自建 harness，直接调用同一产品命令与准入/事务边界；届时单独规划模型循环、凭据和恢复，不在本路线提前实现，也不通过 MCP 过渡。

## 精确验证入口

在现有文件增加对应行为用例，不以三 CLI 配置字符串存在替代真实发送、返回和工程结果：

```text
npm run test:product -- tests/unit/courseAuthoringSession.test.ts tests/unit/coursewareSkillsContract.test.ts tests/unit/coursewareAuthoringRunner.test.ts tests/unit/editorTransaction.test.ts tests/unit/scopedValidationWorkflow.test.ts
npm run test:product -- tests/unit/serializedSessionMount.test.ts tests/unit/formulaNodeUi.test.tsx tests/integration/mixedCrossSurfaceHistory.test.tsx
npm run test:e2e -- tests/e2e/stabilizationOwnershipController.spec.ts tests/e2e/stabilizationCoreUsability.spec.ts
```

版本候选再执行总路线统一验证与 S3 Owner 发布门；真实 CLI benchmark 不以 fixture 替代，fixture 用于确定性故障注入。未来自建 harness 不作为本版依赖。
