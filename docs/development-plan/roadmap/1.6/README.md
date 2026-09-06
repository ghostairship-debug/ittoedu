# 1.6：本地 CLI 会话内核（默认隐藏）

## 结果与边界

应用能探测并安全启动用户已安装、已自行登录的 Codex、Claude、OpenCode CLI，统一消费会话事件、恢复和取消，但不读取或保存 API Key。CLI 保留自己的模型规划、工具循环、Skills 和子任务能力；应用只提供进程 / 会话 harness，不实现第二套 Agent Runner。

1.6–1.9 的 AI 入口在普通内部生产构建中默认隐藏；受控 dogfood channel 在对应纵切通过后可以显式启用，不必等到 2.0 才首次使用。三种 CLI 全部缺失、未登录、版本不支持或运行崩溃时，现有人工创建、编辑、保存、重开、Player 和导出仍全部可用。

本版只形成 `v1.6.0-rc.N` engineering candidate 源码标签，不发布 HTML 或安装器；Owner accepted 在 S3（1.8）统一签署。实现节点可从 1.1 基线并行开始，发布节点为保持版本顺序等待 1.5。

PPTX 人工导入增强是本版并列交付线，始终可见，不受 AI 开关或 CLI 是否可用影响。版本节点、详细边界和实施顺序见 [PPTX 能力增强计划](../../PPTX_IMPORT_ENHANCEMENT_PLAN.md)。

## 任务 DAG

| Task ID | 结果 | Dependencies | Optional | Write locks | Acceptance |
| --- | --- | --- | --- | --- | --- |
| `r16-000-cli-adapter-contract` | 定义 `LocalAgentCliAdapterV1`、标准事件和错误分类 | — | 否 | `contracts-schema`, `cli-adapters` | 三个 adapter fixture 都通过同一 contract suite；`probe` / `start` / `resume` / `cancel` 输入输出严格解析；八类标准事件保持顺序和 session identity；未知事件、坏 JSON 和进程异常转为明确 failed 分类而不抛进 Renderer；本节点在现有 `tests/unit/electronLaunchEnvironment.test.ts` 增加并通过 adapter contract fixture 用例 |
| `r16-010-secure-process-launcher` | Windows 使用解析后的明确 executable + args 启动和停止 CLI | `r16-000-cli-adapter-contract` | 否 | `cli-adapters` | 路径含空格和非 ASCII 时仍启动精确 executable；参数逐项传入而非 shell 字符串；恶意 shell 元字符不产生第二进程 / 重定向；cancel 终止子进程树并只影响目标 session；Renderer 不能调用任意 executable |
| `r16-011-codex-adapter` | Codex CLI 探测、版本、启动、流式、恢复、取消与错误归一化 | `r16-000-cli-adapter-contract`, `r16-010-secure-process-launcher` | 否 | `cli-adapters` | 已安装 / 未安装 / 未登录 / 不支持版本 fixture 分别返回确定 probe 结果；start 输出标准 session / text / tool / usage / completed；resume 延续同一外部会话；cancel 后不再转发迟到事件；不读取 Codex 凭据 |
| `r16-012-claude-adapter` | Claude CLI 探测、版本、启动、流式、恢复、取消与错误归一化 | `r16-000-cli-adapter-contract`, `r16-010-secure-process-launcher` | 否 | `cli-adapters` | 已安装 / 未安装 / 未登录 / 不支持版本 fixture 分别返回确定 probe 结果；start 输出标准 session / text / tool / usage / completed；resume 延续同一外部会话；cancel 后不再转发迟到事件；不读取 Claude 凭据 |
| `r16-013-opencode-adapter` | OpenCode CLI 探测、版本、启动、流式、恢复、取消与错误归一化 | `r16-000-cli-adapter-contract`, `r16-010-secure-process-launcher` | 否 | `cli-adapters` | 已安装 / 未安装 / 未登录 / 不支持版本 fixture 分别返回确定 probe 结果；start 输出标准 session / text / tool / usage / completed；resume 延续同一外部会话；cancel 后不再转发迟到事件；不读取 OpenCode 凭据 |
| `r16-020-local-session-store` | 在应用 userData 的版本化目录保存配置、会话映射和事件记录 | `r15-005-workspace-identity`, `r16-000-cli-adapter-contract` | 否 | `ai-session` | 复用 `r15-005-workspace-identity`，记录按该身份隔离；关闭重开可恢复，同 ID 不同路径互不可见，Save As 得到新 identity 且会话为空；每个本地 schema 版本有显式 migration，单个损坏记录被隔离并报告而不使其他 workspace 不可用；`.h5lesson`、Published 和导出均无 session/trace |
| `r16-030-cli-lifecycle` | 三种 adapter 共用单一会话状态机与 backpressure / crash / cancel 处理 | `r16-011-codex-adapter`, `r16-012-claude-adapter`, `r16-013-opencode-adapter`, `r16-020-local-session-store` | 否 | `cli-adapters`, `ai-session` | running → completed / failed / cancelled 转移不可逆；重复 completed、乱序 tool result、超大输出和进程崩溃均被归一化且 UI 线程不阻塞；重启只恢复可恢复会话；不存在跨 adapter 串流或跨工程记录 |
| `r16-031-hidden-manual-isolation` | 普通构建隐藏 AI 入口，并证明 CLI 故障不影响人工工作流 | `r16-030-cli-lifecycle` | 否 | `workspace-shell`, `cli-adapters` | 默认设置、工具栏和菜单没有 AI / chat / provider 入口；模拟三 CLI 缺失、未登录、启动失败和运行崩溃后，人工创建对象、保存、关闭重开、Undo / Redo、Player 与 HTML 导出逐项成功；工程无 session 字段 |
| `r16-032-table-merge-contract` | 定义跨 Surface 表格合并的兼容合同 | `r15-036-pptx-closure` | 否 | `contracts-schema` | 独立合同明确 Native Table 与 FlowTableBlock 的矩形合并区域、锚点/覆盖格、稳定行列身份、内容保留、行列结构变化与复制语义；V9 与 Published V2 additive strict 分支同步，旧文件默认无合并、旧 reader 遇到新增字段明确失败；越界、重叠和悬空区域拒绝，不创建 V10 |
| `r16-033-table-merge-authoring` | 交付表格合并拆分与结构编辑事务 | `r16-032-table-merge-contract` | 否 | `store-slide`, `store-flow`, `store-spatial`, `props-shared` | Slide/Spatial Native 与 Flow 正文表格可选矩形单元格合并、拆分并继续编辑；合并已有内容不静默丢失，拆分后的内容落点按合同确定；插入/删除/移动行列、复制粘贴不产生重叠或悬空区域，无法保持合法区域的动作明确拒绝且零写入；每次操作一条历史，保存重开和 Undo/Redo 保留区域与内容 |
| `r16-034-table-merge-consumers` | 闭合合并表格的播放导出与工具能力 | `r16-033-table-merge-authoring` | 否 | `published-slide`, `export-pptx`, `generated-index` | 作者画布、Preview/Player/HTML 的文字、边框、命中和可访问单元格一致；Slide PPTX 保留可编辑合并单元格，Flow DOCX 保留 Word 合并结构，Spatial 静态相机结果正确；覆盖格不得重复绘制或重复朗读；Authoring Tools/Builder、诊断与能力索引同步正式合同 |
| `r16-035-pptx-tables-styles` | 接入 PPTX 合并表格并增强主题与文字样式映射 | `r16-034-table-merge-consumers` | 否 | `app-save-recovery`, `store-slide`, `export-pptx`, `generated-index` | 在 1.5 普通表格映射上补主题和文字样式；在前三个合并节点通过后将 PPTX gridSpan/rowSpan/hMerge/vMerge 映射到正式模型；跨行跨列合并、混合普通格、损坏区域各有反例，不能静默拆分或丢失文字；超出当前合同的整表明确报告并提示；补齐常见项目符号、图片翻转和可表达的填充样式；编辑单元格后保存重开与 PPTX 导出保持正确，不因 CLI 缺失隐藏这些人工能力 |
| `r16-036-ppt-resave-import` | 通过本机兼容软件另存为PPTX并复用导入器 | `r15-038-pptx-common-mapping-repair` | 否 | `main-preload`, `app-save-recovery`, `workspace-shell` | 文件入口识别真实.ppt格式；首个支持后端为已安装Microsoft PowerPoint的另存为自动化，读原件并将pptx副本写入应用临时目录，禁用宏执行、不保存原件；转换结果重走同一PPTX预览/确认/原子事务；未安装时明确另存为指引且不启动下载，取消/超时/密码保护/损坏/转换失败零工程写入并清理临时文件，不终止用户已有Office会话；普通.pptx导入无需Office，WPS等后端须独立验证后再声明支持 |
| `r16-037-pptx-text-image-effects` | 补齐下标文字、透明图片与翻转文字映射 | `r15-038-pptx-common-mapping-repair` | 否 | `contracts-schema`, `app-save-recovery`, `published-slide`, `export-pptx` | 覆盖真实样本14个文字效果、9个图片颜色替换透明、6个翻转文本框；先决定下标映射既有Formula或新增strict可选文字字段，涉及字段则独立合同先于writer并同步V9/Published与旧reader边界；不得丢失女1/男2等下标语义；clrChange局部图像转换保留原素材闭包与透明边缘，flip分清文字方向/框体/组变换；作者显示、编辑、保存重开、Undo/Redo、Player/HTML及PPTX一致 |
| `r16-040-release` | 形成 1.6 engineering candidate 并发布 v1.6.0-rc.N 源码标签 | `r16-031-hidden-manual-isolation`, `r15-060-release`, `r16-035-pptx-tables-styles`, `r16-036-ppt-resave-import`, `r16-037-pptx-text-image-effects` | 否 | `none` | 自动化与 1.6 全部目标测试通过，三种真实 CLI 分别完成 probe、start、stream、resume、cancel，并在不可用状态下证明人工闭环不退化；普通构建无入口、dogfood 可显式启用，且无第二 session writer 或跨 workspace 泄漏后创建 `v1.6.0-rc.N` 源码标签；本节点不签署 accepted，保全矩阵晋升留到 S3；本版新增 PPTX 增强节点也必须达到其验收边界，不能只完成 AI 主线即发布 |

并行 frontier：安全 launcher、session store 可在合同落定后并行；三个 adapter 在 launcher 完成后可由不同写锁顺序并行开发，但共享状态机的整合只在 `r16-030-cli-lifecycle` 完成。

## 接口与数据合同

`LocalAgentCliAdapterV1` 至少提供：

```text
probe
start
resume
cancel
```

标准事件至少包含：

```text
session
text
tool-call
tool-result
usage
completed
failed
```

另有应用归一化的 `cancelled` 终态；它不能伪装为 CLI 原生事件。每个事件携带 adapter ID、内部 session ID、可选外部 session ID、单调 sequence 和时间；工具参数 / 结果按可序列化 payload 保存，不能混入进程对象或秘密环境变量。

- executable 来自已批准 adapter 的自动探测结果或用户明确选择的文件路径；Renderer 只传 adapter / operation / session，不传任意命令。
- Windows 启动直接传 executable 与参数数组，禁用 shell 拼接。应用只传 adapter 明确需要且允许的环境，不读取 CLI 的凭据文件或长期 token。
- 本地 session owner 使用共享版本化 `WorkspaceIdentityV1`（工程稳定 ID + 规范化文件位置）；Save As 产生新 owner且不复制记录。store schema 必须可迁移，损坏记录按 workspace 隔离并可重建/删除；记录不进入 CourseProject、Published、Component、Runtime 或导出。
- 适配器负责 CLI 协议差异；上层只消费统一事件，不基于终端文案猜测工具调用。

## 精确验证入口

核心实现只使用以下当前已存在的精确测试入口；对应节点在表格 Acceptance 指定的现有文件中增加命名用例：

```text
npm run test:product -- tests/unit/electronLaunchEnvironment.test.ts tests/unit/windowsSourceLaunchContract.test.ts tests/unit/serializedSessionMount.test.ts
npm run test:product -- tests/unit/diagnosticLog.test.ts tests/unit/courseProjectRoundTrip.test.ts
npm run test:e2e -- tests/e2e/stabilizationCoreUsability.spec.ts
```

adapter 测试使用可控 fixture executable 覆盖失败注入；本版真实 CLI 检查形成候选证据，S3 再由 Owner 统一签署，不把外部登录或网络状态变成自动化必需条件。

## 1.6 表格合并交付边界

Owner 已明确要求安排合并表格能力，以上四个节点全部为本版必选并进入 `r16-040-release` 依赖闭包。它们是人工能力，不依赖 CLI 或 AI 隐藏入口；1.5 仍只交付普通未合并表格导入，不提前声称合并可用。

顺序为独立兼容合同 → 三 Surface 作者事务 → Published/适用导出与工具 → PPTX 合并映射。合同节点须明确单格默认值、锚点与覆盖格的唯一编辑责任、已有正文如何保留及拆分后的落点、跨区域行列移动拒绝边界，再允许 writer 改动；不以仅增加 rowSpan/colSpan 字段代替完整能力。

验证在现有入口增加横向/纵向/二维合并、内容非空、锚点删除、插入行列、区域重叠拒绝、复制身份及撤销重开反例：

```text
npm run test:product -- tests/unit/v9TableCommands.test.ts tests/unit/nativeTableLayout.test.ts tests/unit/crossSurfaceTableDelivery.test.ts
npm run test:product -- tests/unit/courseProjectArchive.test.ts tests/unit/coursePptxExport.test.ts tests/unit/flowDocxProjection.test.ts
npm run test:e2e -- tests/e2e/stabilizationCoreUsability.spec.ts
```

S3 统一教师复核须包含合并表格的实际编辑、播放和导出，不另设重复签署门。
