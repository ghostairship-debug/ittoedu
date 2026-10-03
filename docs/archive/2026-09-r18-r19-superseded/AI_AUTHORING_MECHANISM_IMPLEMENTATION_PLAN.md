# AI 创作操作机制实施方案

2026-09-14，根据 OpenCode / Claude 日志复核、快捷路径隔离验证及 Owner 后续机制讨论细化。

**状态：2026-09-14 M0–M4/M6 当前纵切及 Codex 快速模式已实现，并取得聚焦工程检查、三家 CLI 自然图形任务、真实图片组合与新页背景证据。** M5/B2–B4 仍按 1.9 分期；实施范围及限制见第 9 节和实施记录，不把整个机制方案或后续任务族标为已完成。早期文件路径、失败续跑与本次自然快捷证据分开保留；自动化不替代 Owner 验收。

后续专题：[AI 修改流程简化与正确性修复方案](AI_EDITING_FLOW_SIMPLIFICATION_PLAN.md) 根据教师控制台真实返工与源码核查，规划取消理由硬门、简化候选准备、修复多页/资源准入及按需观察。本批已实施并完成聚焦验证，见 [实施记录](reviews/2026-09-14-ai-editing-flow-implementation.md)；理由字段已从正式协议删除。

本文是[常规任务三层方案](AI_COMMON_TASK_EXECUTION_PLAN.md)的机制实施细则，承接[1.8 修复方案](R18_USER_EXPERIENCE_REPAIR_PLAN.md)。三层分工、60 项代表集和 B0–B4 版本归属仍由原方案维护；这里的 M0–M6 只是依赖包，不是新路线节点、任务卡或协调状态。当前协调仍看[任务板](TASK_BOARD.md)，实施遵循[工作协议](WORKING_PROTOCOL.md)和[架构合同第 7 节](ARCHITECTURE_CONTRACT.md#7-原生cli编辑器连接暂存与会话边界)。

2026-09-16 最新方向：既有发现、适用性、预检、续接和真实检查是复用基础，已实施与实测范围见[产品可用性方案第 5 节](R19_PRODUCT_USABILITY_IMPROVEMENT_PLAN.md#5-执行状态)。后续完整三批统一按[第 7 节](R19_PRODUCT_USABILITY_IMPROVEMENT_PLAN.md#7-常规任务完整链路与效率收敛)实施输入/调用/交付、阶段文稿校验修正、检查反馈与等待，不能只追加提示或继续重做分类。本文机制包和历史 AG/QP 证据保留；本轮只完成计划整合，三批未实施。当前自主覆盖、首轮表现与完整耗时按[常规任务方案第 7.1 节](AI_COMMON_TASK_EXECUTION_PLAN.md#71-80以上的定义)分别记录。

## 1. 用户结果与证据边界

### 1.1 要达到的结果

教师用普通自然语言提出修改、插入、替换、布局或组合任务，Agent 能取得完整可用的宿主操作并交付正确、可继续编辑的结果。模型决定内容、目标和设计意图；软件承担默认值、对象身份、工程引用、资源依赖、坐标计算、检查和一次事务。复杂或未覆盖需求继续使用完整原生 CLI 和文件结果入口，不以快捷覆盖率限制模型能力。

必须分别证明：操作可执行、Agent 自主选择并正确使用、结果满足要求、保存重开与适用运行/导出正确。创建原生图形的数据由模型编写，不等于使用了宿主创建快捷命令；文件路径也可以产出完全原生的可编辑对象。

### 1.2 已有实测不得改写

| 证据 | 实际路径与结果 | 不证明的属性 |
| --- | --- | --- |
| 原用户 OpenCode `998207a4` | 无候选/无提交；选区限制误导和无候选早停共同阻断 | 不是用户没授权或单凭未开 TUN 就可解释 |
| 原用户 Claude `8e9f891f` | 首次被旧 selection 规则拒绝，随后提交蓝底黄圆合并 PNG | 不满足后来明确的两个对象独立编辑要求 |
| 修复后 OpenCode `93584181`，414.9 秒 | 首份快捷候选 s1 改色预演通过；s2 用 content/update 操作创建圆形，被拒且零 live 写入；同一原生会话改走 project.document 后提交 | 文件续跑成功不是首次快捷成功，不说明宿主无法组合修改和新增 |
| 修复后 Claude `b1f83785` / `4d6aa103`，208.0 / 167.0 秒 | 两次提示均明确指定 CLI 文件兜底；最终为独立原生方形与圆形，最后一轮保存重开并分别选中 | 未测试自然选择快捷路线；通道报告模型为 deepseek-flash[1M]，不能据此比较 Claude 原厂模型能力 |
| 同一初始工程的快捷隔离验证 | content 修改方形 → insert 圆形 → content 设置黄色；一次事务、两个原生对象、保存重开、Undo/Redo 通过 | 没有调用模型，不计 Agent 首次正确率或真实任务耗时 |

证据入口：[原生修复记录](reviews/2026-09-14-native-editing-repair.md)、`../../output/native-editing-repair-20260914/verification-audit.json`（历史链接目标未保留）、`../../output/native-editing-repair-20260914/claude-1789321890006/result.input.json`（历史链接目标未保留）、`../../output/native-editing-repair-20260914/quick-path-verification.json`（历史链接目标未保留）。原用户任务修改的是图片，新复验夹具修改的是原生形状；两者分别验证，不互相替代。

### 1.3 同源缺口与验证状态

| 编号 | 当前事实与源码 | 影响 / 待验证场景 |
| --- | --- | --- |
| F1 | [nativeAuthoringTool](../../src/renderer/authoring/tools/nativeAuthoringTool.ts) 的 insert 只接收有限模板参数，shape 无初始样式，formula/table/chart 无完整初始内容；窄编辑仅覆盖 text/image/formula | 图形已有真实失败；新增带样式文字、公式、表格/图表会需要额外步骤。表格/图表底层 [Table](../../src/renderer/course/v9TableCommands.ts) / [Chart](../../src/renderer/course/v9ChartCommands.ts) 命令已有更多创建参数，不能以模板字段少判断宿主无能力 |
| F2 | [media 展开](../../src/renderer/authoring/generation/expandGenerationSemanticCandidate.ts) 基于初始文档/资源先整体展开，只接受冻结 create/update；[候选合同](../../src/shared/generationContract.ts) 的媒体输入也没有贯通全部前序结果引用 | 新建页面后设背景、导入素材后复用、修改几何后按新尺寸应用图片。接口限制已确认，新增用户场景需命名用例验证 |
| F3 | [generationCapabilities](../../src/renderer/authoring/generation/generationCapabilities.ts) 以当前对象和少量关键词选择初始分支；[layer.edit](../../src/renderer/authoring/tools/layerEditTool.ts) 等旧说明仍有 selection 授权措辞 | 修改加新增、跨页任务可能只得到部分操作；旧文字可能继续造成能力误判。不能把这一嫌疑量化为模型失败的唯一原因 |
| F4 | [component.insert](../../src/renderer/authoring/tools/componentInsertTool.ts) 的 existing/catalog 后备图字段在通用 Schema 可选，但 Flow 正文必须提供；Surface/parent 等条件还在执行 plan 内 | 查询到的输入形状合法，实际目标却不可执行。需验证 Flow 正文/浮层及组件资源条件，不能让模型从 optional 猜实际条件 |
| F5 | [工具执行](../../src/renderer/authoring/tools/executeAuthoringTool.ts) 已有输入解析和事务准备，但操作与目标的部分组合条件到 plan 才检查；[profile](../../src/main/localAgent/profile.ts) 仍要求原生脚本写候选 | 模型自写 JSON/路径/验证器，语法与 envelope 错误增加工具往返；目前无统一随包候选预检入口 |
| F6 | [任务控制器](../../src/renderer/authoring/generation/generationTaskController.ts) 已保存拒绝并续跑；[失败合同](../../src/shared/generationContract.ts) 有 stage/step/path，尚缺覆盖上述组合错误的准确原因和处置映射 | 不重建恢复循环；补齐参数、资源、能力、版本、权限等原因，避免轻微参数错误默认转完整文件或重复整项任务 |
| F7 | [project.document](../../src/renderer/authoring/tools/projectDocumentTool.ts) 严格接收完整文档并检查当前准备版本；不能假设它能与任意先前快捷写步骤混排 | 完整快照若来自初始版本，放在已推进私有版本的步骤后会冲突。不得隐式改 revision/rebase 或覆盖前序成果 |
| F8 | 现有结构/资源/动态准入能证明合法性，Native 的用户语义完成仍较依赖模型 summary 与 finish | 独立对象被合图、改错对象、漏改内容、实例与共享范围错误，需要确定性结果检查及真实视觉/互动证据；不是所有自然语言目标都能自动判定 |

## 2. 实现边界与兼容

1. 继续使用 V9、Published V2、各 Surface 正式 Owner、现有 Facade、EditorTransaction 和唯一资源/History。候选协议的类型化扩展不创建 V10，不开放 raw Store/live project 写口。
2. 继续保留原生 Codex/Claude/OpenCode 的模型循环、工具、网络、连接、Skills、子任务及有效授权。无应用选模型平台、额外规划模型或新的通用 MCP/RPC。
3. 选择和页面只是输入焦点。精确目标、版本、资源有效性与依赖验证保留；不能把这些检查改成只允许编辑选中对象。明确跨页或跨对象指令正常执行。
4. 快捷路径为完整、低成本入口，文件路径始终可选，不要求先失败。新增窄入口不删除已有合法底层组合或文件能力；不以惩罚兜底的指标逼迫模型输出错误原生结果。
5. 同类型更新保留身份和未指定字段。跨类型替换复用 [semanticReplacementTool](../../src/renderer/authoring/tools/semanticReplacementTool.ts) 的状态/引用迁移；不可映射项明确反馈，不靠删除重建掩盖。
6. Flow 正文/浮层、paper/viewport、Slide 命名状态、Spatial 世界坐标、global/surface/scene/world 继续由各自 Owner 解释，不能统一成绝对画布坐标或对所有 Surface 宣称等价支持。
7. 旧 candidate v1/v2、旧 insert/content、media.apply 和 project.document 输入在原合法范围内继续有效。新增字段/分支保持 strict；先同步候选解析、载体判定、类型化引用、发现生成和测试，再让新 consumer 使用。旧 reader 不认识新分支时明确报告版本不匹配，不静默剥离。
8. 失败、取消、过期与未提交候选零 live 写入；已提交阶段不重复执行；已有 applyPolicy 不变。本文不会把普通操作改成逐次人工确认。

## 3. 依赖包、源码写域与退出条件

下表均为**待开发**。1.8 承担已暴露阻断所必需的共用机制和当前受支持操作纵切；B2–B4 的完整布局、数据、互动与批量能力仍归 1.9，不借本文件提前宣称完成或整体迁入 1.8。

| 包 | 范围与直接源码落点 | 依赖 | 退出条件 / 版本 |
| --- | --- | --- | --- |
| M0 正式操作条件与引用合同 | authoringToolContract、generationContract、authoringToolCarrier、executeAuthoringTool、authoringToolFacade；更新共同实施合同中的实际新增窄输入 | 无；先冻结首个纵切所需字段和错误码 | 原输入兼容；新操作输入与目标适用条件同源；引用类别可验证。1.8 必要基础 |
| M1 完整创建和窄修改 | nativeAuthoringTool、layerItemPropertiesInput、对应 v9SlideContentCommands/Flow/Spatial Owner；保留 semanticReplacementTool | M0 | 独立图形创建一次输入含样式；只改样式不重写整份内容；现有组合与原生呈现保持。1.8 首个纵切；其他完整族按 B2–B4 |
| M2 按依赖准备组合 | generationResult、prepareGenerationCandidate、expandGenerationSemanticCandidate、candidateStaging；正式背景/资源目标解析 | M0；以 M1 和现有媒体命令为 consumer | 前序对象/位置/资源可引用；语义操作基于当前私有结果；一次提交、失败回滚、结果映射稳定。1.8 已有组合缺口 |
| M3 发现和候选帮助程序 | generationCapabilities、courseAgentCapabilities、generate-ai-capabilities、capabilityWorkspace、profile、courseAgentSkills、candidateStaging | M0；随 M1/M2 的已实现入口增量接线 | 一次查询返回当前目标可调用分支；随包预检/写入不依赖仓库/其他项目；旧选区文字清理。1.8 相关入口 |
| M4 准确恢复与完成检查 | generationHostFeedback、generationTaskController、generationRepair、generationPreview、projectDocumentTool、localAgentTaskContract/localAgentTiming 及实际持久化/投影 consumer | M0/M2；M3 给出同源诊断 | 可纠正错误回到同一会话；已有成果复用；确定性结果检查阻止假完成；路径/时钟可核对。1.8 已证实失误所需部分 |
| M5 其他常规操作族 | Table/Chart、Flow、布局、Interaction、Component、导航、媒体、导出各 Owner；复用 M0–M4 | 共用接口稳定后按独立叶子实施 | L/S → B2；A/C → B3；B/N/M/Q → B4；每族真实结果及保持条件通过。1.9 |
| M6 真实 Agent 集成与证据 | 原生 UI 发起用例、现有代表集和阶段记录 | 对应 M1–M4 或 M5 已接线；不等待无关全族 | 不指定路线的真实用例通过；路线、首次正确、修复及最终结果分开；Owner S3/S4 独立 |

顺序：M0 → M1/M2；M3、M4 在窄合同稳定后并行消费；首个 M6 随 M1–M4 完成即执行。M5 的独立叶子可以在此之后按原 B2–B4 依赖推进。generationContract、prepareGenerationCandidate、能力生成及公共文档由单一 Owner 合并，不能双 writer；开工再按工作协议领取实际写域，不预建 active 卡。

## 4. 接口与准备流程设计

### 4.1 完整创建、变化字段与布局

以下是拟实施设计，不是当前已经可调用的 Schema。正式字段在 M0 与首个真实 consumer 同步落地并保持 strict；不得只发布空接口或把通用文档 Schema 全量塞给模型。

| 操作 | 模型提供 | 宿主完成 |
| --- | --- | --- |
| native insert / shape | 现有 template 的 shapeType、尺寸/位置/label，加可选类型化 style | 原生工厂生成身份和完整默认值，应用初始样式，返回一个可引用创建结果 |
| native edit-shape（拟新增窄分支） | shape 的变化字段和可选 wrapper properties；至少提供一个修改字段 | 按有效状态修改指定字段；不要求复制完整 native content/style |
| native insert / text、formula | 实际文字/公式内容、可选窄样式与布局；旧默认插入保持兼容 | 文本/公式身份、默认样式及现有尺寸规则；依各 Surface 的真实支持接线 |
| table/chart 创建与更新（B2） | 行列/分类/系列等实际内容及必要显示意图 | 复用既有数据操作与工厂生成身份；保留合并、样式和未改数据。公共输入必须与首个 B2 consumer 同批定义，不预建万能数据协议 |
| 相对布局 | 确切锚点引用、关系（居中/对齐/相邻/间距）及必要数值 | 从当前私有有效 frame 计算；复用已有 layer.edit 相邻复制；正文布局使用 Flow 语义，不伪装绝对坐标 |
| 替换 | 明确原对象与完整新内容/资源 | 更新或正式替换分支、身份/引用迁移和一次提交；不增加“方形换图片”等任务专用工具 |

首个验收用例使用“改已有对象＋插入带样式对象”；新增圆形不再要求模型“插入默认圆→引用新圆→再设置黄色”。不得只对黄色或圆形做字符串特判。相对布局先交付此纵切需要的明确居中及已有相邻关系，完整对齐/分布仍按 B2 展开。

省略字段保留既有值，null 清除仅在原合同支持时有效；新增窄入口至少提供一个修改字段，不用空步骤索取诊断。字段值与当前值相同时允许正式 unchanged，不要求必须产生变化；既有合法 no-op/空输入继续保持原合同，不追溯拒绝。共享实例与呈现状态的更新范围必须由精确目标和正式 Owner 决定。

### 4.2 统一前序结果引用与逐步语义展开

现有“全部 media.apply 先针对初始快照展开”的顺序改为现有 coordinator 内的依赖准备：

```text
解析候选结构、原始目标与前序引用类别
→ 建立请求初始私有文档/资源
→ 按声明顺序：解析目标/输入引用 → 检查操作条件
              → 基于当前私有文档/资源展开该语义步骤
              → 原 Facade 准备内部命令 → 保存对外结果映射
→ 检查整体结果与资源闭包
→ 原 EditorTransaction 一次提交
```

- 先补齐传输端：media source 的 asset-id 前序引用须能通过 v1/v2 解析、别名展开、carrier 判定和 staging，不能到 renderer 前已经被字符串字段拒绝。
- 引用只能指向此前有效结果，按 item-id / asset-id / package-id / location-id 验证类别、索引与真实资源；拒绝前向引用、循环、错类型和不存在结果。内部展开步骤 ID 不暴露成模型必须记忆的协议。
- 一个语义步骤可展开多个内部命令，但其原始 step ID 必须映射到稳定、明确的输出。不能因插入内部导入步骤而改变后续引用含义；replacementDependencies 与结果映射一起迁移。
- 新建对象/位置不在初始 request.destinations 中，必须从本次已验证的创建回执和当前私有文档经正式 Owner 派生目标。保留同一工程、task、session 和可核对的版本来源；Surface/location/owner 来自该创建回执和当前私有文档，允许合法新建 Surface，不固定原焦点。不能借任意字符串绕过目标解析。
- 新页面背景需要明确的窄结果目标表达，经背景 Owner 得到真正的背景 update target；现有 created-scope 是 create 目标，不能直接冒充背景。M0 定义此投影的 strict 分支及新旧兼容，禁止让模型拼 authoringAddress。
- 同时补齐新位置上的资源导入 scope：从已验证创建链及正式资源 Owner 派生，不能仍然只在冻结 destinations 中查找，否则新页＋背景仍会失败。
- 后续媒体操作读取前序已更新的几何、内容与资源，避免按旧尺寸处理图片或忽略刚导入的素材。每个异步准备前后仍检查取消与任务版本。
- 保留原逻辑批次的一次 Undo；不为了让新目标出现而先向 live 工程提交。确实需要运行后观察的任务才分阶段，以正式回执继续。

### 4.3 project.document 的独立完整结果语义

project.document 继续接受模型通过原生 CLI 编辑的完整 V9 副本；输出可以是原生对象、已有组件或按合同准入的动态内容，不等于栅格化。

完整文件制品必须说明其实际基线，并遵守当前工程身份/版本检查。**本轮不承诺它与任意快捷步骤混排，也不做隐式 rebase。** 默认帮助程序把完整文件结果作为包含本阶段全部变化的候选交付；不能先准备快捷修改，再把基于旧快照的整份文件强行覆盖上去。已有合法组合保持原合同；不兼容组合给出“完整制品基线冲突”的准确诊断、零写入，并让同一会话重建完整结果或改用快捷组合。

不限制文件路径表达的课件内容；这里约束的是基线一致性和事务结果，不能转化成禁止修改未选对象。

## 5. 能力发现、条件与本地帮助程序

### 5.1 同源条件

在现有正式工具定义/Facade 上补充可复用的操作条件检查，供候选准备、能力投影和本地预检消费。条件覆盖 operation、destination kind、Surface、owner、parent、内容类型及必需资源。具体例子：content 对应 update；insert 对应正式 create；Flow 正文组件需要真实后备图片。

复杂的真实宿主条件仍由执行阶段判断；不得在文档里复制一份永远漂移的支持表。能力查询返回三类信息：当前可执行、补齐列明条件后可执行、当前快捷入口不覆盖。最后一类仍附开放文件/基础能力入口，不能宣布模型整体不具备能力。

### 5.2 完整入口与输入成本

- 使用现有能力索引和 query，按任务/目标组织小而完整的入口，涵盖修改与新增等必要组合。关键词仅辅助排序；不作为自然语言权限判断器，也不另加分类模型。
- 已知 UI 动作直接提供准确分支；自由输入保留少量通用操作入口及按需查询。被裁剪的卡须明确可查询，不能让“没放进首屏”被理解为“不支持”。
- 查询一次提供该分支完整 Schema 引用、当前目标条件和可执行示例；默认值/依赖迁移放在宿主实现，不把完整 V9 数据结构复制给每次简单编辑。
- 清理 native/layer/background/Flow/媒体卡、profile、内置 Skills 和相关开发说明中旧 selection 禁令。正向检查“选 A 改 B＋新增 C”；不能只搜索到“选择不是权限”一句话就判通过。
- 保留原初始 prompt 预算，另记按需读取、outputSchema、模型上下文和必要多对象增量；不得通过藏到 Schema 或裁掉必要条件凑字节上限。

### 5.3 随应用交付的候选帮助程序

沿 capabilityWorkspace/profile/candidateStaging 提供本地、一次调用即可完成的读输入、写候选与预检帮助程序；路径由 request 的 fileAccess 提供，模型不定位安装目录或手抄 UUID。命令名和文件名在 M3 接线时冻结，现阶段不在实际能力卡宣称存在。

它只读当前冻结输入和能力版本，按正式解析器写当前 staging 文件；使用参数数组/文件参数，避免让模型构造长 node -e、PowerShell 转义和 base64 文本。不启动服务、不连 live Store、不实现通用工具 RPC，也不替代 CLI 的既有原生工具。

预检区分“结构/引用类别/静态条件通过”和“宿主已提交”。复用同源代码或生成物，拒绝手写第二套近似验证器。真实资源解码、当前版本重检、动态宿主与正式提交仍走原通道；不能把预检通过写成任务完成。返回非零错误码及机器可读的 step/path/原因，并附简短可执行修正信息。

## 6. 失败恢复与结果检查

### 6.1 原因驱动恢复

保留已有 generationTaskController、原生会话、期限和实质进展判断。在正式错误 producer 生成准确 code/path/上下文，经 generationHostFeedback 送回；不靠对自然语言报错的正则猜测原因。必要的新增 strict 字段由 M0 同步合同和旧记录兼容。

| 原因 | 处置 | 必须保留的约束 |
| --- | --- | --- |
| 参数/目标类型不匹配 | 指出具体 step、字段、接受分支和已确认目标，优先修正候选 | 不自动把有歧义的更新改成新增；无需默认重写完整工程 |
| 资源未交付/引用类别错误 | 提供当前可复用文件和正确引用形式，补交或纠正 | 不重复生成已有有效素材；不能猜资源 ID |
| 当前快捷操作不覆盖 | 同一会话可组合基础命令或直接提交完整文件结果 | 无强制“先失败”、无强制路线；保留最终可编辑性要求 |
| 工程/草稿/基线改变 | 按原生命周期刷新或拒绝旧候选，保留用户变化 | 不改 revision 蒙混通过、不覆盖未提交草稿 |
| 原生权限拒绝/Stop/期限 | 保留用户决定及既有停止行为，说明已完成部分 | 不换工具绕过同一被拒授权，不静默提权或无限续跑 |
| 检查/提交后回执传递失败 | 依据真实提交状态恢复记录/送达 | 已提交阶段不再次执行 |
| 结果缺项 | 返回缺项及已完成内容，在正确阶段继续 | 不把“语法合法/已提交”当作用户目标全部满足 |

这里只为已证实错误增加处置，不新建执行循环或无限自动重试。参数、资源和结果无实质进展时继续使用原停止规则。

### 6.2 有限、确定的结果检查

从正式操作本身生成内部检查：创建类型/数量/独立身份、指定属性、相对几何、保留实例/引用、预期资源变化；检查实际准备结果，不能只相信 candidate.summary。

对用户明确提出的“独立对象、只改单个实例、保持尺寸、指定页面”等条件，只有得到确切目标和类型化含义后才建立任务检查。检查与 UI 焦点无关，也不能给任意扩写的“保持其他内容”推导出新的权限范围。模型自己提交一组断言不能成为唯一验收依据。

不建设通用断言 DSL、任意 JSONPath 写入或第二语义判断模型。不承诺仅靠程序理解所有自然语言、教学质量和视觉意图。无法确定的条件保留实际观察/教师检查状态；动态动作依原宿主真实运行证据，不以静态 smoke 冒充互动成功。

快捷和文件路径共用适用结果检查；文件若把明确要求的两个独立对象合成一张图，不能以视觉相似通过该结构要求。完整文件中的未知长尾修改仍按 V9、资源闭包及正式动态准入处理，不能因为检查器尚未理解该意图就封死开放创作。

## 7. 命名验收用例与执行方式

### 7.1 确定性机制用例

以下名称是待落地用例，不是已经通过的测试。各包优先扩展现有命名测试；只有测试职责确需独立时新增文件，禁止复制一整套执行器作为 mock。先选择本包用例，不能隐式启动真实 CLI 矩阵。

| 用例 | 必须证明 | 测试落点 / 包 |
| --- | --- | --- |
| QP01 完整创建＋窄修改 | 改 A 样式并插入完整样式 B；省略字段保留；两个原生对象；一次事务；Slide 命名态及支持的 Flow/Spatial 变体 | [authoringSurfaceTools](../../tests/unit/authoringSurfaceTools.test.ts)、[semanticAuthoringTools](../../tests/unit/semanticAuthoringTools.test.ts)；M1 |
| QP02 前序结果类型 | item/asset/location 引用可用；前向、循环、错类、错索引在确定位置失败；内部展开不改变外部 step 输出 | [generationShortCandidate](../../tests/unit/generationShortCandidate.test.ts)、semanticAuthoringTools；M0/M2 |
| QP03 新位置＋媒体依赖 | 新建页后设真实背景、同批导入后复用、修改 frame 后按新几何应用媒体；派生 scope 有真实创建链 | [generationBackgroundEntry](../../tests/unit/generationBackgroundEntry.test.ts)、semanticAuthoringTools；M2 |
| QP04 组合回滚与阶段 | 前一步准备成功后后一步失败，文档/资源零 live 写入；成功一次 Undo/Redo；Stop/版本/草稿变化拒绝；已提交阶段不重放 | [generationPreparationFailure](../../tests/unit/generationPreparationFailure.test.ts)、[generationTaskController](../../tests/unit/generationTaskController.test.ts)；M2/M4 |
| QP05 发现即能按条件调用 | 选 A 改 B＋新增 C；查当前 Flow 组件得到必需后备图条件；正文/浮层、状态与 owner 条件来自同源实现 | [generationSnapshotFocus](../../tests/unit/generationSnapshotFocus.test.ts)、[generationCapabilityWorkspace](../../tests/unit/generationCapabilityWorkspace.test.ts)、authoringSurfaceTools；M0/M3 |
| QP06 帮助程序可移植与兼容 | 旧 v1/v2 与新窄输入；文件/envelope 区分；空格/中文/长目录；新 userData 无仓库或其他工程仍可预检/交付；原授权保持 | generationCapabilityWorkspace、[candidateMediaStaging](../../tests/unit/candidateMediaStaging.test.ts) 及 M3 新增的精确进程用例 |
| QP07 失败正确续跑 | 参数错误保留准确分支；已有资源复用；无进展停止；真实拒绝/Stop 不复活；结果失败及回执送达可区分 | [generationFailureFeedback](../../tests/unit/generationFailureFeedback.test.ts)、generationTaskController、[localAgentHarnessV2](../../tests/unit/localAgentHarnessV2.test.ts)；M4 |
| QP08 结果结构与文件基线 | 独立对象合图不通过明确结构要求；单实例/共享、未改属性符合预期；旧基线文件不得覆盖前序准备；正式保存重开/适用 Published 不丢结果 | [projectDocumentFallback](../../tests/unit/projectDocumentFallback.test.ts)、semanticAuthoringTools；M4 |
| QP09 任务族扩展 | 表格带真实数据、图表局部数据更新、Flow 图文、相对布局、声明式动作、组件单实例配置及跨页批量 | B2–B4 对应 Owner 命名测试；M5，不计作本轮全部已覆盖 |

源码路径变化时跟随实际 Owner 更新，不能因改名重跑无关证据。布局看实际呈现，互动看实际动作，文件/引用看正式解析与保存恢复；hash 不能代替这些属性。

### 7.2 不指定路径的真实 Agent 用例

从现有 [r18OpenEditingRepair](../../tests/e2e/r18OpenEditingRepair.spec.ts) 和已冻结代表任务入口接续，保留原先“指定文件兜底”用例作为文件路径回归，另建明确命名的自然路径用例。不得修改旧 prompt 后覆盖旧统计。

| 用例 | 普通用户指令与 fixture 要点 | 正确结果与路径记录 |
| --- | --- | --- |
| AG01 图形修改＋创建 | 选中参照 A，要求另一页 B 改色并在中心新增独立圆形；fixture 带未指定属性/命名状态 | 首次候选完整正确；原生对象、保持条件、保存重开；不提示操作名或快捷/文件路线 |
| AG02 原图片修改＋创建 | 使用真实可解码图片，要求底色变化并新增独立图形 | 图片与图形分别可编辑，原图片之外的共享实例不变；不得用 shape fixture 代替 |
| AG03 新页面＋已有媒体 | 要求新增一页并应用指定已有图片背景/内容 | 页面、媒体、资源引用正确；观察是否因新位置引用被迫额外续轮 |
| AG04 混合内容与关系 | 在受支持表面修改文字并增加图文、按明确关系排版 | 关系正确、无漏项，未指定对象不变；按批次选择已实现能力 |
| AG05 合理开放路径 | 选择已确认快捷入口不覆盖但 V9/正式动态载体能够表达的需求 | 无需先失败；文件/源码结果真实提交并经必要准入；不因路线指标阻止完成 |

首批自然路径用例覆盖用户实际 OpenCode、Claude Code 配置；同源变化按现有 103/版本门补受影响 Codex 入口，不把双 CLI 成绩宣称完整三家。每条至少记录原始指令、fixture、应用/CLI 版本、选定/发送/原生确认模型与强度、会话条件、权限等待、人工介入、首次候选和最终结果。

模型、服务端、强度、输入、会话和路线指令任一不同就分组记录，不从 Claude Code 通道名推断模型身份，不把 OpenCode pending 到 completed 与 Claude tool_use 到 result 当作天然同口径的纯工具耗时。没有足够重复样本不宣称 P95 或稳定加速比例。

### 7.3 度量与完成门

- 分开记录：用户目标最终正确率、首次候选正确率、首次快捷完成率、文件路径使用及原因、修复次数、原生轮次/工具往返、请求至首次正确可用结果时间、保存/运行/导出状态。
- 首次候选正确：无补提示、换模型、人工修参数或宿主拒绝后修正；候选前原生工具内部纠错单列，不能隐藏。AG 表中的首次要求保留为原批次历史验证口径，不作为后续所有纵切的功能阻断。当前允许原任务内自行修正，最终结果、修复成本与首次表现分别记录；一次文件路径成功仍只证明该路径，不能替代未完成的正式操作覆盖。
- 文件路径原因至少分为：用户明确指定、快捷不覆盖、快捷失败后恢复、模型在已覆盖任务中自主选择。无法由日志确定的原因标未知，不能编造模型动机。原生对象/图片/组件/Runtime 是结果载体，与以上路径另列。
- 应用本地版本化日志记录路径与关键时钟，不写入 h5lesson/Published/导出。缺少原生推理/网络/排队数据就保留未知，不能用总等待倒推出纯推理时间。
- 60 项、49/60 前两层能力覆盖目标和必过核心由常规任务方案维护，当前自主完成与历史首次口径按其第 7.1 节分开。QP/AG 是机制验证及受影响补充，不另作分母稀释失败，不以首轮失误驱动无限追绿。合理开放创作另报，不能补入前两层覆盖；完整 B2–B4 仍待相应版本交付。
- 受影响工程检查通过、自然路径代表用例通过且失败原因已准确记录后，才可称该批 engineering candidate。视觉/互动和教师接受度、Owner S3/S4 保持独立；本次文档完成不改变其状态。

## 8. 文档同步与验证停止条件

1. 本文维护 M 包接口/依赖/源码与验收细节；三层方案维护任务族、B 批次及覆盖率；R18 修复方案维护当前真实阻断与已完成批次；review 只记录实际实施和证据。总纲、交付计划和旧专题报告只链接接续入口，不复制整套执行清单。
2. 实施 M0 时才在共同实施合同落地正式输入及错误字段；架构合同保留唯一事务、原生能力和焦点边界，不把本文拟定字段伪装成当前 Schema。
3. 每包先运行所改属性对应的命名检查；只有实际构建/真实原生集成或版本门需要时运行相应构建与原生用例。文档更新只检查引用、状态和内容一致性，不运行付费 CLI、产品测试矩阵或修改当前用户工程。
4. 已有证据在相关实现/输入/检查定义未变时继续有效。发现同源新失败时扩展对应包，不自动重开全部路线；无实际 consumer 的未来接口不预建。
5. 当前纵切不得宣称整个 M0–M6 或完整后续任务族已实施、全模型提速、第二台机器验证或 Owner 验收完成。

## 9. 2026-09-14 开发批次与新增快速模式

本轮实施当前 1.8 的 M0–M4/M6 纵切，并增加 F0；M5 的完整 B2–B4 任务族保留 1.9 归属。旧表格中的“拟实施”描述是设计基线，以下记录实际落地范围。

### F0 Codex 原生快速模式

- 速度与模型、思考强度独立；使用本机 `model/list.serviceTiers` 的 ID/name/description，不维护硬编码模型名单。0.154.0 实测 Fast ID 为 `priority`，标准为 `default`；不能将配置文件 `service_tier="fast"` 原样当作原生 RPC ID。
- `LocalAgentConfiguration`、能力 current/selected/requested 及 task configurationRuns 增加可选 serviceTier，保持旧记录兼容。首次未选择沿用原生设置，不自动开启；UI 在选择前显示“快速模式会增加用量消耗，具体费用取决于模型和登录方式”。不承诺统一倍数或加速比例。
- 速度选择经过目录校验与偏好持久化，在 thread/start、thread/resume、turn/start 传入；只有原生返回配置或已有明确确认与本次请求一致时确认生效。拒绝/未知/不匹配不能假称成功。保存下一轮选项不修改正在进行的任务。
- 切换模型保留其支持的速度；不支持时显式标准速度。其他 CLI 不静默吞掉 serviceTier。整个过程不改原生授权、不写全局 Codex 配置。
- 官方依据：[Speed](https://learn.chatgpt.com/docs/agent-configuration/speed)。ChatGPT credits 与 API key 计费不同，因此 UI 使用通用消耗提醒。

### 已接线的当前机制

- 同源 `AuthoringOperationCondition` 由工具声明，执行器和候选帮助程序共用检查；生成卡保留匹配分支的条件。已接 native.content operation/target/parent/支持类型，以及 Flow 组件后备资源要求。
- insert 的 shape/text/formula 初始内容和样式、edit-shape、`template.placement={kind:"center",anchorItemId}` 已落地。Table/Chart 接收已有底层创建参数；完整行列/数据更新操作族仍属 B2。
- coordinator 改为逐步解析目标和前序输入、基于当前私有文档/素材展开 media.apply。新增 strict `created-background` 目标，从前序创建页回执经背景 Owner 派生。内部导入的 asset-id 对外汇总到原语义 step；仍是一份最终工程/资源/History 事务。
- `candidate-helper.mjs` 随能力版本打包，使用正式 v1/v2 parser 和同源静态条件，不依赖仓库/node_modules。调用 `node <request.fileAccess.candidateHelper> --request <request.json> --input <draft.json> [--check]`；无 version 的 draft 只需 summary/steps/可选 afterCommit。输出 `prechecked` 只代表静态预检，完整工具输入、资源解码、当前版本、动态行为及提交仍归宿主。
- Native 创建后检查真实有效对象类型与明确内容/样式/尺寸；完整文件基线冲突返回 `artifact-baseline-conflict` 和准确路径。未知自然语言语义仍需实际观察，未建立通用断言 DSL。

### 当前证据与新发现

- 新用例 QP01（三 Surface 样式与居中）、QP03（新页背景/语义素材结果复用/一次 Undo/保存重开）、QP05（更新/创建不匹配零写入）、QP06（无仓库中文目录 helper）及 Codex 速度传递/关闭已加入现有目标测试。
- 2026-09-14 首次 AG01 OpenCode 自然路径样本在准备阶段遇到 `output-limit`，尚无宿主提交。应用原限额将原生工具流量与模型正文混合计算；已调整为 32 MiB 单条消息、8 MiB 正文、128 MiB 回合协议流量，回放仍按原规则处理；诊断输出实际字节与限额。Claude 同源单消息边界对齐 32 MiB。该失败保留，不能从首次指标删除。
- 当前自然路径实测及最终验证结果继续补录到 [实施记录](reviews/2026-09-14-authoring-mechanism-implementation.md)。第二台物理机器、完整 B2–B4、Owner S3/S4 不在当前自动化证据中。
- 最新自然实测：AG01 三家均首次原生操作组合、无宿主拒绝并保存重开；Codex 实际确认 Astra / medium / priority。AG02 图片像素修改＋独立原生圆形，AG03 新页＋既有图片背景，均一次提交、保存重开正确。AG03 期间原生工具搜索与纠错明显，不能据成功结果宣称所有准备延迟已经消除。M6 当前执行 AG01–AG03；AG04/AG05 完整扩展按后续对应能力批次补充。
