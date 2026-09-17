# 1.9 常规任务改进：并发执行任务包

> 2026-09-16 Owner 要求：不由用户逐项操作或派发；任务可并发、高效率、最小检验、次旗舰可执行。本文件细化[主方案第 7 节](R19_PRODUCT_USABILITY_IMPROVEMENT_PLAN.md#7-常规任务完整链路与效率收敛)。2026-09-17 U01–U10 已按本任务包实施并接通，工程证据及未覆盖范围见[执行记录](reviews/2026-09-17-r19-usability-execution.md)；编号是本次实施分包，不是新增路线节点或协调状态。

## 1. 执行方式与共同边界

**当前用途（2026-09-17）：已实施任务的设计参考。** U01–U10 不再整体派发；最新开发只按[前端专项 F00–F08](R19_FRONTEND_SPECIAL_IMPLEMENTATION_PLAN.md)。以下执行指令保留用于理解当时分工，不能因换执行者重新跑一轮。

当时的执行分工为：一个 ROOT 连续完成基线准备、派发、集成、补验和结果记录，用户无需逐项派发。本文不授权重做已完成批次；当前执行方式见前端专项。开发连续推进不替代产品内手动创作流程的四次当前稿确认。

- **执行模型：** U01–U10 都按次旗舰 / high 编写。ROOT 承担跨域合同、共享接线和疑难裁决；叶子不自行设计第二套协议或扩大任务。这里的开发模型分工不改变真实产品测试的模型约束：Codex / OpenCode 只用已确认 Luna，支持则 Fast；Claude 用已确认 DeepSeek。
- **必读上限：** 开工共同读取总纲当前路线、任务板、工作协议，按任务补读架构合同相关条目；随后只读本包指定符号、直接调用者及目标测试。既有调查见主方案 7.2–7.6，不从全仓重新盘点。新证据改变边界时才扩读。
- **基线：** ROOT 检查当前未提交集成树和活动写锁，保存可恢复的当前集成基线，独立工作区必须从它建立，不能从旧 HEAD 或历史工作区启动，也不要求先提交用户工作。派发时给出实际工作区、基线标识、接口版本、精确写域和命名检验。实际并行才按工作协议记录协调卡；本次规划不改任务板或正式 DAG。
- **写入：** 下表未列文件默认只读。新增文件也须落在指定路径；需要新增直接 consumer 时，叶子提交路径、原因和接口给 ROOT，ROOT 检查锁后自主分配。共享文件的两个函数也不分给不同 writer。一个叶子的实现、直接 consumer 和删除旧实现一起集成，不能先合一个不可运行的半接口。
- **交接：** 只交付结果、实际修改文件、1–3 项证据、尚未接线/未测范围及需要 ROOT 的具体接线；不让下一个执行者重新推导方案。回退只撤本包变更，保留当前基线和用户改动；不得 reset/clean 整个共享工作区。ROOT 处理交叉冲突后只重验受影响证据。

## 2. 共享接口与唯一 writer

这些是本次实现决定，不是已存在的运行 API。ROOT 在相关叶子启动前把类型/输入输出和一个可用样例固定到所属源码边界；可先交窄接口与测试夹具，最终生产 consumer 同批切换。某个接口就绪即可放行对应叶子，不等所有接口和所有批次一起就绪。

| 边界 | 已决定的输入、结果与归属 |
|---|---|
| Native 文本 | U01 在 `textRuns.ts` 内统一编辑映射。坐标保持 code point；先识别 grapheme 边界再换算，不能直接把源文 UTF-16 offset 当 Native offset。精确编辑含同一基线、原文、替换文和不重叠范围；已有选区由程序换算，原文匹配必须唯一。整段输入推导多个编辑区；若不同合法匹配会改变保留样式，返回可定位的歧义结果并保留原稿/草稿，等待精确范围，不任意认领重复片段。插入沿现有无歧义两侧继承，显式样式仅覆盖指定字段。已有源文 diff 可作算法参考，不把 Flow/Markdown 改回 runs。 |
| 冻结任务事实 | ROOT 在既有 request / observation 合同内承载，U04 在 renderer 生成。每条绑定当前工程版本、location/state、精确 authoring target 和来源；字段描述/有效值复用 shared componentProps，另附正式执行 Owner 给出的可写范围与原因。关系只来自同一冻结工程、同一 Owner/平面，包含有效 frame/rotation/order 与所需短内容。索引必须声明其 scope 及 complete/partial；main 只裁剪、映射别名和运输，不重新解析 manifest、状态或几何。 |
| compose 静态解析 | U05 从 `slideInteractionTool.ts` 提炼纯 resolver 到 shared，正式工具和预检共同调用。输入是当前位置实际适用项、ID/label 引用和完整性信息；结果分 resolved、正式 issue、deferred。完整索引下先 ID 后唯一 label；前序创建/改名/删除或不完整索引使相关判断 deferred。前移错误复用正式 code/path，不增加第二规则表，不以 deferred 计作通过。 |
| 成组布局 | U06 在现有 Slide 多选 Owner 中分离纯规划；输入为冻结 document、同一有效上下文的精确 targets 和既有 align/distribute intent，输出复用正式 patch/事务计划及失败原因。UI 提交和 AI 私有候选共用它。`layer.edit` 沿既有 Schema 增加对应分支，目标使用正式 target 类型；显式主目标须在 targets 内，不猜选区或跨 Owner 补对象。保持当前旋转、锁定、具名状态及最少对象数语义。 |
| Player 完成结果 | U03 在现有 Controller / session 内提供一次触发可关联的运行结果，至少能区分 run、rule、surface、触发来源及所属触发/导航链。结果明确 completed、正常 navigation-terminal、cancelled、failed；disabled/条件不符/未触发单列 skipped。session 持有跨卸载的结果；正常导航必须匹配本次 transition 和实际目的地，destroy/retrigger/Stop 不能冒充成功。状态切换入场运行必须有因果归属；未纳入观察的入场终态仍标 skipped。只增加临时内部观察端口，不改 V9/Published 持久化协议，不建通用事件平台。 |
| 阶段校验 | U07 将 CLI 校验实现迁到 `src/main/lessonMarkdownValidation.ts`，保留正式正文/数学 codec 和本地附件解析。导出接收 `source/file/baseDir` 的只读入口，返回 valid/invalid/unreadable 与原 `DocumentDiagnostic[]`；CLI 负责读文件、调用和退出码。U08 校验与保存使用同一份已读取 source，并由既有文件 Owner 在写前复核附件、ticket、版本和恢复稿。诊断只应用于阶段 AI 候选门，不成为教师源文保存禁令。 |
| 实际变更与行为证据 | U09 从正式前后工程/资源状态产生身份差异，U10 让预览和宿主反馈消费同一结果。条目以 owner + 稳定对象 ID 关联，带位置/状态、名称、字段与前后值或详情引用、创建/删除/换序和实例/共享影响。结果另含比较范围、omitted、值截断及不可比较原因；仅完整比较的范围才能声明未改。执行证据独立列 checked/skipped/failed、起点/目的地和来源，不生成教学目标已通过的结论。ROOT 负责正式预览/回执类型及直接 consumer，不能让 main import renderer 实现。 |

**ROOT 独占共享写域：** `src/shared/generationContract.ts`、`src/shared/generationResult.ts`、`src/shared/authoringObservation.ts`、`src/shared/localAgentTaskContract.ts`、`src/shared/lessonAuthoringDesktop.ts`、`src/shared/courseAgentCapabilities.ts`、`src/renderer/authoring/generation/generationCapabilities.ts`、`generationTaskController.ts`、`prepareGenerationCandidate.ts`、正式工具注册/Facade 接线、App/IPC 组合入口、能力/合同生成器和全部生成制品、锁文件及计划/协调记录。这里是可用的集成边界，不要求每个文件都改。

`profile.ts` 和 `courseAgentSkills.ts` 在 U02 期间只给 U02；U02 集成释放后由 ROOT 接入后续投影。`componentProps.ts` 作为唯一解析器原则上只读；发现正式解析缺陷由 ROOT 单写，不让字段、列表和反馈叶子各自修一版。各包表中旧测试文件也属于该包独占写域；其他包只能引用已有证据或新增自己的窄测试。

## 3. 自动滚动派发

| 任务 | 可开始条件 | 完成前须接通 | 执行线 |
|---|---|---|---|
| U01 Native 文本保真 | 文本语义及写域固定 | 正式改文工具、受影响 Native consumer、保存/历史 | 优先开始，独立交付 |
| U02 默认候选路径与提示退役 | 当前基线可调用 helper | 当前 prompt/skills 与替代能力说明 | 首轮并行 |
| U03 Player 运行结果与等待 | 完成结果语义固定 | Controller → session → 真实检查器 | 首轮并行，独立生命周期包 |
| U04 冻结字段与关系输入 | 冻结事实类型固定 | 首次请求、续轮观察和 main 投影；profile 等 U02 释放 | 可与 U01/U03/U05/U06 并行 |
| U05 同源静态诊断 | resolver 类型及冻结索引形状固定 | U04 实际索引 → helper 预检 → 正式工具 | resolver 可提前准备，完整纵切等 U04 |
| U06 成组布局正式入口 | 布局输入/规划出口固定 | U04 关系事实、能力卡与候选私有事务 | 规划和工具可提前准备，完整纵切等 U04 |
| U07 阶段校验复用 | 当前 CLI 校验入口已确认 | CLI 原行为与新同源只读入口 | 首轮并行，无第一批依赖 |
| U08 阶段输入与同会话修复 | U07 接口已交付 | 正式文件 Owner、原生续接和自动/手动门 | U07 后立即接续，无整批屏障 |
| U09 稳定身份实际差异 | 摘要形状与比较范围固定 | ROOT 预览准备接线，U10 双端消费 | 首轮并行准备；用户链结论在 U10 |
| U10 行为/变更反馈消费 | U09 结果及 U03 运行结果可用 | UI、正式回执、原生反馈和必要继续/结束 | 所需接口就绪即接续 |

ROOT 先启动 U01/U02/U03/U07/U09 中已具备前置的独立叶子，随接口冻结补入 U04/U05/U06。每完成一包就集成、释放写锁、派发下一可运行包；独立模块已完成但生产接线未完成时标“模块证据已交，纵切未完成”，不能宣称产品能力完成。第二/三批允许提前做独立实现，主方案的一、二、三批仍分别承担完整退出标准。

050 只按[主方案 7.7](R19_PRODUCT_USABILITY_IMPROVEMENT_PLAN.md#77-与现有版本工作的关系)穿插既定缺口；不抢活动文件写锁，不并行争用同一课例/native session，不重跑已通过电路目标。Runtime 工作副本、组件列表结构和动态采样优化只在主方案已写明的触发条件成立后由 ROOT 细化分包，未触发不占本轮人力或成为阻断门。

## 4. 次旗舰任务规格

以下每包的“检验”给出最多 3 项有实际断言的行为范围，组合场景只按其真实覆盖报告。执行前先匹配现有命名用例与有效证据：覆盖未失效就直接引用，已有用例可扩展就扩展，只为真实新增失败模式补测试，不为填满三项或统一命名另写同义测试。`Uxx-*` 是**新增/扩展检查的计划名称**，不是已经存在或通过的测试；直接复用旧名时记录真实命令。ROOT 接线检验可以作为该包的一项证据，不要求叶子与 ROOT 重跑两份。

### U01：多处改字保留 Native 格式

- **结果/先读：** 主方案 7.2 第 7 项；`textRuns.ts::remapTextRuns`、`nativeAuthoringTool.ts` 文字分支及 `rg remapTextRuns src` 的直接 consumer。首尾同时改写时未改中段样式保留，错误范围不得部分应用。
- **独占写域：** `src/shared/textRuns.ts`；`src/renderer/authoring/tools/nativeAuthoringTool.ts`；`src/renderer/authoring/v9SlideContentEdit.ts`、`spatialWorldAuthoring.ts`、`flowTextEdit.ts` 的 Native 图层文字分支；`src/renderer/authoring/productivity/styleRemix.ts`、`index.ts`；`src/renderer/composition/properties/usePropertiesAuthoringBinding.tsx` 的文字映射调用；`tests/unit/textRuns.test.ts`；新增 `tests/unit/nativeTextEditPreservation.test.ts`。同签名下无需改动的 consumer 保持原调用，以行为证明使用共享规则。
- **固定做法：** 先在共享 Owner 形成多区间映射与歧义结果，覆盖基线、重叠、边界及插入继承；再接正式工具与直接编辑入口。模型传唯一原文/上下文或使用已捕获选区，程序定位，拒绝手算 offset 成为正常路径。现有 `document/sourceMerge.ts` 超过差异距离上限会退为单个中间区，不能把该回退直接当 Native 保真映射；无法可靠映射时返回明确诊断并保留稿件。保留显式 false/null 样式及未指定字段；不引入编辑器依赖或第二历史。
- **检验：** `U01-separated-edits` 在旧实现在首尾改写/中段强调反例失败，新实现保留 runs；`U01-ambiguity-unicode` 覆盖重复定位、过期/重叠、emoji/组合字符和插入继承；`U01-native-roundtrip` 经真实工具修改具名状态并保存重开、Undo/Redo，校验中段样式、其他对象和工程身份。
- **退出/交接：** 所有实际使用该映射的 Native 路径接通，旧单中间区算法退出。若某 UI 输入缺少精确范围，交出该 consumer 的具体缺口由 ROOT 接线，不以 AI 单工具通过算整体完成；Flow 统一正文保持现有合同。

### U02：一次正常交付与定向说明

- **结果/先读：** `scripts/candidate-helper.ts`、`scripts/candidate-component-patch.ts`、`src/main/localAgent/profile.ts`、`src/shared/courseAgentSkills.ts` 及主方案旧要求退出表。默认 helper 已检查再生成；本包收敛用法，不重做已有实现。
- **独占写域：** 上述四文件，新增 `src/shared/courseAgentTaskGuidance.ts`（仅确需复用相关说明时），`tests/unit/generationCapabilityWorkspace.test.ts`，新增 `tests/unit/courseAgentTaskGuidance.test.ts`。如替代知识需修改工具 description，由 ROOT 写入该正式能力源；本包不抢 U01/U06 工具文件。
- **固定做法：** 正常示例只做一次生成，产出本通道可直接使用的声明；check-only 和直接小候选继续有效。标题/控制台知识先在相关能力可达，再撤无关常驻注入；`qa-repair` 每次候选等宿主反馈后按具体差距继续，Stop/期限/无进展语义不变。已有成功续轮不再次交付相对修改。
- **检验：** `U02-default-delivery` 运行 bundled helper，合法 draft 一次生成正式可解析候选/声明，非法 draft 不产可交付结果，check-only 不交付；`U02-targeted-guidance` 检查相关说明可用于原居中/控制台场景而无关任务不加载，并保留小候选短路；`U02-repair-feedback` 用现有控制器/adapter 协议夹具验证收到失败可继续、已提交可结束、Stop/过期不可继续，无模型调用。
- **退出/交接：** 说明与实际 consumer 同步。某条替代尚依赖 U04/U06 时只退役已接通部分，剩余归 ROOT 对应接线；不能先删除再交给下个包猜。释放 profile/skills 写权后 ROOT 接后续投影，不再并行回写。

### U03：真实运行结束驱动 Native 检查

- **结果/先读：** `PublishedInteractionController.ts::#startRule/#executeRule`、`PublishedInteractionSurfacePort.ts`、`publishedDynamicHosts.ts` 的局部/全局 Controller 与 session 销毁/导航，`nativeInteractionVerification.ts::verifyNativeInteractions`。
- **独占写域：** `src/player/interactions/PublishedInteractionController.ts`、`PublishedInteractionSurfacePort.ts`；`src/player/surfaces/publishedDynamicHosts.ts`；`src/renderer/authoring/generation/nativeInteractionVerification.ts`；`tests/unit/publishedInteractionController.test.ts`，新增 `tests/unit/nativeInteractionCompletion.test.ts`。如现有 Surface port 的直接实现必须改签名，ROOT 在本包启动前逐个列入本包写域，不能另派并行 writer。
- **固定做法：** session 接收本次触发所属运行结果，检查器在点击前建立关联，在完成后检查实际状态/目的地和诊断。按第 2 节区分导航、取消、失败及入场归属；不以 activeRuns 为空或 Promise resolve 判通过。删除累计 delay/duration 与 earliestResultAt 推算；沿原 deadline 和真实宿主异常上限有界结束，不能另复制调度器。
- **检验：** `U03-parallel-terminal` 用真实调度证明并行动作加后续串行动作都结束后才给结果，结束时间不再强制等时长之和；`U03-run-identity` 覆盖同规则重触发、Stop/destroy、动作失败和状态入场归属；`U03-real-player-navigation` 在隔离真实 Player 核对正常导航卸载、错误目的地及旧正确/错误候选，确保不死等、不误报、teacher live 零修改。
- **退出/交接：** Controller→session→检查器闭环才算 1a 本项完成。交给 U10 实际 report，不扩大为“教师目标通过”，原本未覆盖的条件/入场观察仍明确 skipped。真实 Player 制品由 ROOT 按变更准备一次。

### U04：同源字段、当前值与布局关系

- **结果/先读：** shared `componentProps.ts`、UI `ComponentPropertiesEditor.tsx`、Builder `coursewareBuilderV2.ts` 的 publicProperties、`componentConfigureTool.ts`、`generationSnapshot.ts`、renderer `authoringObservation.ts`。
- **独占写域：** `src/renderer/authoring/generation/generationSnapshot.ts`、`authoringObservation.ts`，新增同目录 `generationTaskFacts.ts`；新增 `tests/unit/generationTaskFacts.test.ts`，`tests/unit/generationSnapshotFocus.test.ts`。ROOT 持正式传输类型与 main 投影，不改 shared 解析规则。
- **固定做法：** 在同一冻结工程/资源/状态上调用既有解析及执行 Owner；首次请求和续轮共用一份事实投影。组件输出字段键、有效值、约束、用途、实例/共享范围及可写原因；可见文字只沿已有注册映射。布局请求提供必要同平面几何/邻近对象，普通改字不带整页；完整索引供程序按需使用，默认输入保持紧凑且不重复推荐。
- **检验：** `U04-component-parity` 比较同一冻结实例/具名状态下 UI/Builder/聊天的值、约束及可写范围，准确表达 content 数组合并；`U04-frozen-scope` 覆盖锁定、部分索引及 live 后续变化，不混入新事实；`U04-public-input` 经真实 request→main 投影，普通改字无无关整页说明且符合现有 12 KiB 技术输入预算，布局/组件可取得完整必要信息。
- **退出/交接：** 给 U05 完整性明确的索引，给 U06 同源关系；ROOT 接 main 后才算完整交付。组件公开参数的实际工具修改及其他实例保全由集成纵切证明，单纯字段 JSON 存在不算完成。

### U05：可确定错误的同源静态诊断

- **结果/先读：** `slideInteractionTool.ts::locationItems/resolveNode`、`generationStaticPrecheck.ts`、helper 默认路径，主方案 7.2 三类历史反例与边界。
- **独占写域：** `src/renderer/authoring/tools/slideInteractionTool.ts`、`src/shared/generationStaticPrecheck.ts`，新增 `src/shared/slideInteractionTargetResolver.ts` 与 `tests/unit/generationStaticTargetResolution.test.ts`，`tests/unit/slideInteractionCompose.test.ts`。helper 与投影接线归 ROOT，不修改 U02 的测试文件。
- **固定做法：** 提炼当前位置适用项的 ID/唯一 label 解析，正式工具与冻结预检消费同一实现。完整且不受前序影响才早拒绝；partial、创建/改名/删除相关依赖返回 deferred。manifest 正式 Schema 分支已实现，复用其证据；不静态扫描任意 JS 判断 goToScene 成败。
- **检验：** `U05-complete-resolution` 坏名称在生成前给同源 code/path，合法 ID/唯一 label、适用重名与他页专属 global 行为正确；`U05-deferred` 部分索引及前序增删改名不误拒绝/不虚报通过；`U05-corrected-commit` 修正后经正式 compose 事务提交，未指定内容保全，失败零写入。
- **退出/交接：** U04 索引及 ROOT helper 接线完成后验证提前诊断确实被调用；只有纯 resolver 通过时不得写“预检已前移”。旧 resolver 删除，不保留两套 label 规则。

### U06：正式多对象对齐与分布

- **结果/先读：** `v9SlideContentCommands.ts::exactSlideMultiLayers/commitSlideMultiLayerIntentAtTargets` 及其规划、`layerEditTool.ts`、有效图层投影与现有多选行为测试。
- **独占写域：** `src/renderer/course/v9SlideContentCommands.ts`、`src/renderer/authoring/tools/layerEditTool.ts`；需要抽文件时仅新增同 course 目录 `slideMultiLayerLayout.ts`；新增 `tests/unit/layerEditLayout.test.ts`。现有工具注册和生成索引由 ROOT 单写。
- **固定做法：** 移出并复用当前多选规划，手动入口和候选准备共享它；AI 只改私有候选，正式提交一次 History。仅暴露现有支持的 align/distribute 与准确参数/例子，Flow 正文不接绝对布局；不补通用布局求解器。主方案“三图及说明三列”用这些真实能力组合，超出现有语义的部分准确报告。
- **检验：** `U06-layout-parity` 相同精确目标的手动/AI 结果一致，覆盖 Native/Component 混排、旋转、锁定、具名状态和同 Owner/plane 限制；`U06-atomic-roundtrip` 失败零部分提交，成功单事务、保存重开/撤销及未指定对象保全；`U06-real-layout` 真实画面检查图文三列关系、比例与溢出，不以坐标相等代替可读性。
- **退出/交接：** ROOT 接能力描述，U04 关系实际进入请求，公开输入足够调用后才算用户纵切完成；UI/AI 重复算法同时退出。U06-real-layout 属该包第三项，由 ROOT 共用构建后完成。

### U07：阶段正文/附件校验的唯一实现

- **结果/先读：** `scripts/validate-lesson-markdown.ts`、`shared/document/markdown.ts` 及资源解析，`tests/unit/validateLessonMarkdown.test.ts`，只读文件 Owner 的写前条件。
- **独占写域：** 新增 `src/main/lessonMarkdownValidation.ts`；`scripts/validate-lesson-markdown.ts`；`tests/unit/validateLessonMarkdown.test.ts`。不改正文 codec、文件持久化或阶段状态机；有真实 codec 缺陷交 ROOT 定界。
- **固定做法：** 迁移现有校验而非重写；新入口消费 source，保留诊断位置和附件真实目录闭包。CLI 保留只读包装和原退出码，格式片段供 U08 同源引用；不强制普通教师保存先通过。
- **检验：** `U07-validator-parity` CLI/宿主入口对合法正文、数学及非法格式给一致诊断；`U07-resource-boundary` 缺失附件、本地链接、越界与真实可读附件判定正确；`U07-no-write` 校验不写正式稿或恢复状态，现有教师非法源文保存反例仍由其原证据覆盖。
- **退出/交接：** CLI 不再持第二实现，给 U08 一个真实 source 调用示例及诊断；此包只证明校验复用，不宣称宿主写入门或自动修复已经完成。

### U08：阶段输入、写前校验与同会话修正

- **结果/先读：** `lessonAuthoringDesktopService.ts::prompt/operate`、`lessonAuthoring.ts::validateTask`、文件 Owner CAS/恢复稿规则；主方案 7.3 与当前四阶段文件合同。
- **独占写域：** `src/main/lessonAuthoringDesktopService.ts`、`lessonAuthoring.ts`，新增同目录 `lessonAuthoringPrompt.ts`；`.agents/skills/orchestrate-courseware/references/main-progression.md`、`teaching-design-quality.md`、`interaction-design.md` 和 `.agents/skills/build-courseware-project/references/build-method.md` 的同源内容分段；`tests/unit/lessonAuthoringDesktop.test.ts`、`lessonAuthoring.test.ts`，新增 `tests/unit/lessonStageInput.test.ts`。外部 Skill 停点不变，shared 传输类型由 ROOT 接线。
- **固定做法：** 按当前阶段/运行环境选取正式方法与格式片段；软件内 Builder 用法和外部启动说明在消费前分开，教学要求同源保留。暂存 source 经 U07 合法后，才由原文件 Owner 写入；可修复格式/附件诊断回同一 native 会话及原预算，Stop、真实前置稿变化、CAS/恢复冲突和材料失效不作为格式循环。当前源码/资源可复用，不重生成前阶段。
- **检验：** `U08-stage-input` 四阶段/软件内构建/外部参考各取适用说明，不注入校验文档标题和反向禁令；`U08-repair-before-write` 非法候选不覆盖正式稿，同会话修好才保存，保留前阶段文件及材料出处；`U08-current-file-guards` 自动实际材料读取、手动逐稿当前确认、教师并发改稿/附件变化/Stop 与普通非法源文保存不被误伤。
- **退出/交接：** 原生协议夹具证明控制流程，实际材料与四阶段完整自然链仍归 050。宿主门/反馈接通前保留必要 CLI 校验提示，接通后才撤固定执行命令和过时混合说明。保存冲突如需文件 Owner 改动由 ROOT 接线，不能私自清恢复稿。

### U09：按稳定身份计算实际变化

- **结果/先读：** `generationPreview.ts::describeGenerationChanges`、`prepareGenerationCandidate.ts` 的正式 before/after 和资源结果、receipt affected IDs。当前数组下标比较会把换序误报成改文/移位。
- **独占写域：** `src/renderer/authoring/generation/generationPreview.ts`；新增 `tests/unit/generationSemanticChanges.test.ts`。ROOT 写正式类型、候选准备与资源传入；纯计算不得依赖 UI、live Store 或模型 summary。
- **固定做法：** 对正式实体集合按 owner/稳定 ID 对齐，再比较字段；无实体 ID 的普通内容数组保持其正式顺序语义，不能一律忽略换序。资源变化明确实例/共享影响；摘要与按需详情来自同一次差异结果。保留比较范围和截断状态，不把 affected IDs 当完整保全证明。
- **检验：** `U09-identity-diff` 纯换序不生成伪文字/坐标变化，真实字段变化、创建和删除分别准确；`U09-scope-resource` 跨页/具名状态/共享资源影响可追溯，未比较范围不声明未改；`U09-truncation` 超过摘要数量或值长度时保留遗漏/详情与未知标记。
- **退出/交接：** ROOT 接入真实 candidate preparation，U10 双端消费后退出旧下标摘要。纯函数通过只记计算模块完成，不冒充回执已经改变。

### U10：检查语义与实际结果进入双端反馈

- **结果/先读：** `generationHostFeedback.ts`、正式任务回执/原生续接、`GenerationCandidatePreview.tsx` 及 U03/U09 结果。变化事实、执行证据和教师目标核对分别表达。
- **独占写域：** `src/main/localAgent/generationHostFeedback.ts`；`src/renderer/ui/chat/GenerationCandidatePreview.tsx`、`generation-candidate-preview.css`；`tests/unit/generationFailureFeedback.test.ts`、`generationCandidatePreview.test.tsx`，新增 `tests/unit/generationResultFeedback.test.ts`。controller、prepare、正式回执字段及观察接线由 ROOT 持有；U04/U03 文件释放前不回写它们。
- **固定做法：** 人类审阅与模型反馈读取同一份 U09 实际差异；行为证据保留 checked/skipped/failed、起点/目的地/状态和来源，不能把 completed 或 committed 写成教师目标成功。未变证据按真实依赖复用，提交前身份/Stop 仍实时检查。已足够判断则正常结束，有具体缺口则沿现有原生会话观察/修复；不新增总结回合或观察次数禁令。
- **检验：** `U10-feedback-parity` 同一次候选的 UI 和 native feedback 变化/截断范围一致；`U10-execution-not-goal` 动作执行但目的地/显隐目标不符不会被显示为目标通过，skipped/未知不伪装 checked；`U10-continuation` 失败反馈可用、已提交回执补记不重做相对修改、Stop/过期不可复活，并复用 U03 的真实 Player 结果。
- **退出/交接：** 完整候选→正式事务→回执/反馈与审阅接通。ROOT 只在证据因相关变更失效时重验；动态采样优化未满足主方案触发条件时保持现状，不借本包扩大到 2.0 教学 QA。

## 5. 最小检验命令与集成收口

叶子直接运行 Vitest 的指定文件和 `-t` 名称，避免 `npm test` 的 pretest 自动构建；下表一行不是“一个检查”的统计捷径，只执行第 4 节中证据尚缺或已失效的 1–3 项行为用例。已被原命名用例充分覆盖的行为直接复用原命令/证据，下面的计划前缀仅定位实际新增或扩展用例。新增名称须确实匹配，零匹配、skip 或测试名不存在都不是通过。不得选择含真实 CLI 的综合文件整体运行。

| 包 | 免费定向入口（相应新用例写入后执行） |
|---|---|
| U01 | `npx --no-install vitest run tests/unit/textRuns.test.ts tests/unit/nativeTextEditPreservation.test.ts -t "U01-"` |
| U02 | `npx --no-install vitest run tests/unit/generationCapabilityWorkspace.test.ts tests/unit/courseAgentTaskGuidance.test.ts -t "U02-"` |
| U03 | `npx --no-install vitest run tests/unit/publishedInteractionController.test.ts tests/unit/nativeInteractionCompletion.test.ts -t "U03-"` |
| U04 | `npx --no-install vitest run tests/unit/generationTaskFacts.test.ts tests/unit/generationSnapshotFocus.test.ts -t "U04-"` |
| U05 | `npx --no-install vitest run tests/unit/generationStaticTargetResolution.test.ts tests/unit/slideInteractionCompose.test.ts -t "U05-"` |
| U06 | `npx --no-install vitest run tests/unit/layerEditLayout.test.ts -t "U06-"`；其中真实画面检查按下一段由 ROOT 运行并留截图/操作结果 |
| U07 | `npx --no-install vitest run tests/unit/validateLessonMarkdown.test.ts -t "U07-"` |
| U08 | `npx --no-install vitest run tests/unit/lessonStageInput.test.ts tests/unit/lessonAuthoringDesktop.test.ts tests/unit/lessonAuthoring.test.ts -t "U08-"` |
| U09 | `npx --no-install vitest run tests/unit/generationSemanticChanges.test.ts -t "U09-"` |
| U10 | `npx --no-install vitest run tests/unit/generationResultFeedback.test.ts tests/unit/generationFailureFeedback.test.ts tests/unit/generationCandidatePreview.test.tsx -t "U10-"` |

**准备归 ROOT，一组相关变更只准备一次。** 需要真实 Player 的包先完成相关 `npm run build:player`；需要 Electron/可视工作台的合流再按变化准备 renderer/electron。叶子复用同一基线产物；Player 依赖变化才重建 Player，不为纯提示修改重新准备所有 fixture。U06 的画面检查在新增 `tests/e2e/r19CommonEditingLayout.spec.ts` 中命名 `U06-real-layout`，由 ROOT 持该文件，使用 `npx --no-install playwright test tests/e2e/r19CommonEditingLayout.spec.ts --grep "U06-real-layout"`，不调用会隐式准备全套 fixture 的 `npm run test:e2e`。该用例走正式产品入口/候选，不调用模型。

**生成与类型集中完成。** 正式工具/合同源与直接 consumer 集成后，由 ROOT 执行对应生成命令一次及相关 TypeScript 检查；生成已自验时不紧接同义 check。未改合同不跑合同生成，未改正式 DAG/任务板不因文案更新跑其全套检查。最终工程候选/发布节点仍保留既定总验收，不让十个叶子各跑一次 `verify` 或 CLI 矩阵。

**三个编辑纵切只补消费缺口。** 简单属性修改验证短输入/直接候选未增加必经 I/O；多步跨页编辑连接 U01/U05/U06 的正式事务及保全；已有组件编辑连接 U04 的公开字段和必要源码路径、真实行为及实例/共享影响。复用包内保存/Player/视觉证据；只有公开入口是否足够让模型发现并调用仍未知时，ROOT 才按已授权模型补对应自然任务。1a 零新增模型调用，日志分桶和性能下降不是继续实施前置。

**完成口径：** 每包先报告命名行为及未覆盖范围；ROOT 以主方案 7.2/7.3/7.4 的退出标准分别收口三批，不能以十包都交代码替代完整链路。首轮表现、原任务修复、人工介入、实际结果和用时分别报告；历史证据继续有效，050/060/Owner accepted 独立。通过后自动接续下一包，所有获授权且可运行的包完成后统一交付，不把剩余执行步骤交给用户。
