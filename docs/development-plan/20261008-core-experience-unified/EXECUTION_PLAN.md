# 核心体验统一实施计划

## 0. 当前执行范围与授权

**Owner 2026-10-09 最新范围：原生 `.glx`、果铃工作台名称／图标、本地 Windows 打包，随后清理可再生文件并整合文档、退役过期 D 盘工作树。§9＋§10 原目标、有效成果和未通过证据保留，不据旧计划自动派发。实际状态只读当前状态，完成事实只记既有结果；不上传、推送或远端发布。** 组织与权限边界按[工作协议](../WORKING_PROTOCOL.md)，本轮仅沿已批准组件／格式／文件服务进行必要改动。

更新：2026-10-08。当前接手基线 `3095ea020a4eef9864e865e4560ffbc1987cc913`，产品源码 cut `95ce7eaf`；接手时保全所有后续有效改动，不回退到早期分析基线。

此前 Owner 启动 START_PROMPT 的产品授权与已批准目标继续保留，当前批次运行状态以顶部及当前状态为准。恢复时从实际 HEAD 与有效未提交成果接手，不重复审批已授权步骤；发行继续暂停。

本计划是唯一执行入口。§1–6 保留首轮范围、长期约束与验证方法；**后续差额按 §7 执行**，同一 [WORK_PACKAGES](WORK_PACKAGES.json) 的 `followup` 细化既有 U00/U03/U06/U18/U20/U22 等责任槽，不重开已有效闭合的子项。原 R/N/M/F 归属和证据保留，不能用首轮问题清单勾完推定共同业务全集已闭合。

首轮局部职责迁移、修复及三路续作的有效证据继续成立，但不证明全部共同能力已经统一，也不证明最终版本从空白完成了一次完整 MCP 或内置 AI 任务。最新证据边界见 [当前状态](../CURRENT_STATUS.md)。

## 1. 授权与完成标准

本包于2026-10-08依Owner要求生成，Owner 已以[启动指令](START_PROMPT.md)全文授权产品实施；旧“先讨论/暂不开发”由本次执行授权覆盖，不逐阶段询问是否继续。发行/部署仍暂停。

架构与产品决定以[统一方案](../20261007-content-revision/CORE_EXPERIENCE_UNIFIED_SOLUTION.md)为准；[原执行指令](../20261007-content-revision/CORE_EXPERIENCE_EXECUTION_PROMPT.md)的作者模型、费用、三路独立创作和真实生图要求保留，开发角色默认由工作协议替代。方案/计划通过不等于产品通过。

完成必须让用户得到可编辑、可撤销、可保存重开、可运行交付的正确结果。范围包含原九项及补充、React导入P0、R01–R48、N01–N04、M01–M03；外部审计的A/B/C/D和暂缓不是Owner排除决定。疑点先用能改变实现的最低成本定位；当前不存在/已修且有效证据覆盖的条目可据实处置，不强行制造回退。

不换V11，不建万能编辑协议、全局语义图谱、第二工程/store/writer/History。GrapesJS普通HTML投影路线显式保留；React深编辑不能由“已初始化库”代替。Moveable只是可选薄手势输入。真正改变已定能力、默认、路线或交付格式须披露并交Owner，只有受影响叶等待。

## 2. 接手与能力依赖（首轮映射，非固定派发）

1. Root 读取当前状态/任务板和相关卡，检查 `git status --short`、当前HEAD及已附工作树，保全用户修改。不得reset/stash/clean，不删除原课例、不杀共享宿主。任务来源按当前直接producer/consumer，不把旧PID、审计快照或历史根因当现状。
2. U00只确定正在需要的小合同：捕获对象/范围/版本与ACK、持久内部地址/运行绑定/修改owner、两个保存adapter、共享几何输入和React实际commit端口。沿现有API5/Session落点；不是先设计完总平台才放行。已有窄接口足够的叶可以立即开工。
3. U01当前ACK/关闭、U10几何/HUD、U11镜头、U12呈现、U13正文、U14放置、U15运行宿主、U16事件、U18资源/编译、U19格式资源及U21维护保留为非重叠能力映射，不要求同时派一组角色。主执行者按当前目标实施，确有收益时才并行；共享实体保持下节唯一writer。
4. U00必要接口稳定即可贯通U04/U05的React作者内容和原HTML保存；U10矩阵就绪后接U06手势/同目标AI。U07成熟输入、U08专业/非DOM、U09普通HTML投影不等React全包完成；最终接线仍须消费共同目标和正式应用器。
5. U22从第一轮就跟踪实际旅程/证据，先完成真实React纵向切片；相关核心路径无已知阻断后续原三路任务，不等维护项全部完成。末尾对所有包与完整质量/时间目标收口，不能用三路“运行过”替代结果。

`start_after`是该包核心实施所需接口，不是整批瀑布门；`complete_with`是最终真实消费者必须接通的包。无需等待前包无关子项/review；稳定的窄接口及适用独立评审可释放对应叶，任务交接注明实际ready部分。不以mock、静态占位或“开发已完”代替最终集成条件。

按实际能力小闭环集成：一个作者记录类型落地时，就接正式入口、常态消费者及该类型的复制/资源/正常保存出口，并退出对应重复职责；不用等U04、U02、U20整包都完才一次大合并。`complete_with`不要求并存双轨直到尾批。当前小切片缺必要consumer则不称已交付，其余已闭合叶继续合入。

作者记录的跨批交接沿现有owner：U04产生正式局部地址/记录及实际引用→U02在完整复制/复用planner处理局部命名空间、归属/引用与必要新身份→U05原HTML序列化/导入翻译→U18/U20现有资源收集、保存、转换/输出消费。authorKey不机械全局重建，也不原样带入错误原实例；覆盖引用的图片与普通作者资源同归既有资源owner，不另建writer。交接写当前字段/consumer与最低行为证据，不增永久登记表。

## 3. 单Writer与安全并行

[包表](WORK_PACKAGES.json)的 `writers` 保留领域职责与共享实体归属，**同文件只有一个 writer**；owner 是职责槽，不表示必须派一个智能体。默认主执行者直接实现、自检和交付，不设固定开发角色或普通叶独审；必要独审、并发、记录按工作协议 §1、§3.1、§4–5，不改全局模型配置。

- Root 在既有任务卡给实际本批锁，遵循协议§5固定标签，不把包表当永久粗锁。一个owner在同一协调任务持共享粗锁，委派精确非重叠叶；不能靠省略标签或不同worktree绕过同文件冲突。
- 需要并行写入的非重叠实施按协议使用隔离worktree/branch，先复用合适的已有checkout；没有明确隔离写域则只读。共享根/正式History不复制成多个writer。
- 计划文档尚未提交时，隔离worktree从主目录绝对路径读取本包，或由Root发送本包必要片段；不为得到文档增加提交/审批门，不把没复制文档误判为路线不存在。
- 实施者可读所有直接消费者，在已分配能力/目录范围内自主创建或修改文件；与活跃 writer、共享热点或新职责范围冲突时才协调归属。package/lockfile、生成索引/合同和验证配置保持一个实际 writer，不扩锁平台。
- 表中是直接接点，不授权遍历目录重构。测试/fixture同样单 writer，由实施者确定必要操作和反例，不固定 T 先审题。状态仅在实际运行后 active，候选/提交/集成/行为通过分别报告。

## 4. 四项职责迁移的退出条件

| 工作包 | 完成的职责变化 | 必须保留 |
|---|---|---|
| U01视图生命周期 | 文档输入owner prepare/drain，Main保存/关闭owner决策；App/工作台消费结果，重复按格式猜输入/关闭的业务退出 | deactivate、投影release、正式close不同；documentId/epoch未ACK输入保全，取消回到同输入owner，inactive portal/hit/handles关闭 |
| U15共同运行宿主 | 作者与Published消费现有ModelPlayer共同资源准备→实际投影commit→Runtime sync→端口绑定→ready/dispose；CourseV10RuntimeView重复create/sync/dispose编排退出 | React真实commit、StrictMode与ProjectionMutationBoundary/light/deep祖先变化保护、作者Bridge/IME、各合法窗口独立Runtime |
| U12外层呈现 | React InstanceView、PM NodeView、Player DOM消费共同frame/extent/children/media/section决定；原入口重复规则退出 | 各投影DOM/lifetime/bind，Flow阅读与专业尺寸语义，section作者展开/播放折叠的显式策略；HUD独立内容fit |
| U13共同正文用例 | 既有documentBlockCommands/menu和selection/draft用例供加号/斜杠/顶栏消费；重复创建/可用性/AI回显业务退出 | Flow paper/document和专业table adapter，MD源码/相对资源保存；不能降级为共同能力最低交集 |

只增加facade/re-export而旧规则仍自行执行不算完成。重要候选独立review须核对真实diff、原要求/样例、直接调用者和保留行为，不由作者自审；已明确的迁移不再逐文件审批，未变有效review不重复。

## 5. 纵向切片与验证

优先载体是已保全的 `Starter-Unit-1-Hello-standalone.html` 与隔离工程副本，不操作Owner原件/使用中窗口。已证“播放有图文但authorSpots=[]”是当前P0起点；V9实现只作恢复既有能力的参照，不要求恢复其错误点击穿透。

| 要证明的结果 | 最低充分证据/主包 |
|---|---|
| 内部身份/落点 | 同文/同图两个对象仅改选中者，必要state/data-item隔离；临时未挂载不误删、真正失联不报applied。U04/U05 |
| 默认自由编辑 | 文字内容盒改宽会换行，图像比例缩放正确，拖动不使邻项意外重排；缩放/clip/父矩阵只应用一次，一手势一History。U06/U10 |
| 人与AI连续修改 | 人工先保存文字/图片覆盖→AI读取最终值并局部续改，旧覆盖不遮AI新值、未改人工几何保留；源码/关联作者记录/资源同事务。U03/U04/U06 |
| 在途共编 | 受控延迟AI改A正文期间，人工移动A并改B，回包保A新位置/B新内容；同正文冲突明确保稿/诊断，不静默覆盖。U03/U04 |
| 完整内部副本 | 内部替图/移动→复制或复用→改副本→保存重开：归属/局部key/引用正确，副本不改原件，覆盖图片不遗漏。U02/U04/U20 |
| 真正持久消费 | React相关重绘/Conversation切回、undo/redo、显式保存冷重开；原HTML与H5正常入口、退出编辑、真实Player、普通HTML交付消费同修改且原互动仍可运行。U01/U04/U05/U20 |
| 作者记录往返 | 原HTML修改并保存→导入H5→导出普通HTML→重开：作者改动只应用一次，绑定/资源/几何无重复或丢失。U05/U18/U20 |
| 视口/HUD/初态 | 同作品工作台/完整编辑/试运行/整课预览同设计空间；三表面控制台可见、默认收起、快捷栏收展、Flow手柄回写；暂停继续保现场，返回初态只重置当前页。U10/U15/U17 |

其余包按 `minimum_evidence` 在最近owner层验证改变的属性。先审“普通用户做什么及哪里错”，默认1–3条成本最低且足够的检查；这不是最多只能覆盖三件不同已知错的限额。GUI/视觉看真实呈现，资源/导出看真实格式consumer，保存/History看对应往返，结构看旧职责退出和代表行为。

U09在**产品正式HTML入口**验证GJS实际内部结构移动及样式修改→共同事务→撤销→保存重开，不用隔离原型/初始化收口，React切片不替代它。其add/remove事件可能是一组移动：复用实际对象关系/手势边界识别语义，不逐事件提交新增/删除。用户命令、ACK/AI回显、undo/redo、运行重绑定明确来源；后三类只投影，不能再次提交作者修改。一次手势一次正式History，回显无循环，沿既有操作/版本机制，不造事件平台。

在途共编先用受控延迟回包验证软件行为，不付费造并发测试，也不冒充真实Luna创作。仍经既有捕获/准备/正式事务：重新读取当前目标，将未冲突的正文修改与人工几何/B字段合并，再做最终CAS；同正文有效基线冲突明确处置/保留输入。不得因无关revision全量拒绝，不能删最终CAS、静默覆盖或新增全局编辑锁/协作平台。内部局部编辑与AI源码改同样必须不吞人工几何。

现有GUI切片顺带观察改字/拖动/模式切换的可感卡顿、重复同步、无必要iframe/程序重挂载；有异常只定位其真实owner并修，不增性能时限、全产品benchmark或治理平台。记录实际观测，不以源码调用次数代替交互流畅。

执行者在开工时选当前V10相关目标测试，核对实际过滤/生命周期钩子；旧命名含V9的用例不能自动作当前能力证据。可用 `npm exec -- vitest run <真实目标文件> -t <真实用例>` 避开 `npm test` 的自动player构建；仍需检查该目标自身是否依赖未更新产物/真实付费或CLI调用，必要准备只做相关一次。零匹配、skip/exclude不算通过。不默认 `npm run verify`、全build/e2e/model/组件矩阵或发行检查。

已有原导入/播放、计算/生图、原section同rev15新Player `0→6→0→6`、有效聚焦候选证据复用。仅相关实现/依赖/验收定义/关键环境改变或新失败才补验证，不因新reviewer或上下文压缩重跑。内部schema测试不能替代两保存adapter与非编辑consumer；一个注册非DOM真实样例足够证明接口，不承诺自动反解任意Canvas/React。

## 6. 三路真实创作与剩余收口

U22按原执行指令续已有首次任务，三作者均 `gpt-6-luna/medium`，分别真实公开MCP、真实内置AI、独立裸HTML；同材料/规模/关键互动，Root不代写、不用回放/受控provider/DeepSeek冒充。每路本任务真实文生图与实际嵌入仍必需，成功作业复用，仅续失败嵌入。原首产出不可被救场改写：内置rev3 partial，MCP首rev7缺图/续rev12补图，裸HTML首次问题均保留。

记录实际模型/推理/服务差异、总分钟与生图耗时、人工干预、修补单列；质量不明显弱于裸HTML且时间无明显软件额外拖延。若未达，沿真实软件断点继续修；不造时间门，不靠换强模型、换未授权供应商、重复生成或抹首败收口。新凭据/收费路径/管理员安装/真实用户迁移仍交Owner。

每包交付：实际改动/候选或提交、1–3条所选检查及证明边界、适用独立review、直接consumer结果与剩余问题。一次检查可覆盖多条同根R，不为每条建独立全链；没有证据的条目不能直接勾完。所有包最终有修复或有依据的处置，原D/N/M无默认退出，已成立问题不能仅归为“不复现”而无限延后。

结果写既有[IMPLEMENTATION_RESULT](../20261007-content-revision/IMPLEMENTATION_RESULT.md)、问题/当前状态及任务卡，不建第二永久缺陷库。实际协调卡完成后按协议删除/重生任务板；包表为计划不持续承担运行状态。停止时区别partial、源提交、应用/待绑定、保存、真实窗口、Owner accepted；方案/自动化通过不冒充Owner接受。发行解除只能由Owner决定。

## 7. 共同业务实质统一与完整创作收口方案

### 7.1 目标与反复分叉的原因

目标：当前已支持的创作编辑操作，在相同权限、正式目标和修改意图下，人、MCP、内置 AI 能读取同一当前状态，执行同一语义用例，得到一致的应用、资源和交付事实。复杂内容继续经已有局部源码能力编辑；软件负责所有可确定的机械接力。

已定位的结构问题有三项：

1. 共同 Gateway、DocumentSession 和工具名字只统一了部分边界。当前稿选择、目标接续、资源解释和结果交付仍由入口补齐，单一 writer 没有保证业务决定唯一。
2. 前轮按已知问题和有限职责包收口，没有从当前支持用例反向证明消费者完整性。既有 U01/U12/U13/U15 的迁移有效，但其 PASS 不覆盖所有作者操作与三个入口。
3. 现有注册约束输入，跨入口业务结果仍可在 `ToolResult.read.data: unknown` 后被各端分别解释；人工命令也不全部由同一公共能力定义导出。新增能力因而仍依赖各端分别记得接线。

实例依据：生成图预览扩展 `6364fe86` 修改了共享图片服务和内置 Engine，MCP 消费分支仍只处理 `data.image`；`project.apply(from)` 的当前稿优先读取仅覆盖 HTML；人工页面尺寸/播放设置等已有正式命令，公开工具缺相应入口。它们是本次职责调整的现实依据，不以“以后更整洁”扩面。

### 7.2 当前事实与必须关闭的问题

| 事项 | 当前证据及边界 | 本次处置 |
|---|---|---|
| 完成判定 | 原内置首任务最后由模型调用 `task.finish({})`，软件以 partial 结束；部分已恢复调用仍列旧失败，缺页/未应用 Ready 图未列入该剩余清单。没有请求超时或 provider 失败证据；模型为何提前结束未唯一还原 | 根据当前目标结果和必要交付结算；历史错误保留诊断，不再依调用失败清单或参数完全相同判断目标是否达成 |
| MCP 图片预览 | 内置 Engine 消费 `previews[]` 并读取像素，MCP `reply` 只消费 `data.image`；当前源码确认传输缺口，尚未新调用验证 | 共同 owner 准备可消费图片结果，UI/模型/MCP 仅显示或编码；三端都获得真实图片，不以 prepared 元数据充当看见图片 |
| 首次 MCP 缺图 | 原图已 Ready，首次插入被拒绝授权，之后保存 rev7 缺图；原始参数/完整回执未留存，无法唯一还原当次授权原因。相符的授权续接、资源桥缺陷已修 | 保留首次失败与后续有效修复；不重新认定已修缺陷，也不以历史不完整记录阻断新链。接通当前同源资源与授权链后直接验证 |
| 当前稿及依赖 | 普通 `file.read` 读取已打开 Session；`project.apply(from)` 仅 HTML 优先当前稿，其余外部源和依赖仍可能读磁盘 | 入口与依赖统一经现有输入 settle、Main 当前源快照及资源摄取；未打开文件正常读盘，不要求先保存才可编辑 |
| 正式能力覆盖 | 已确认页面尺寸、项目背景/播放设置、部分保身份对象结构编辑、状态目标及部分放置/可见范围缺少完整公共读写入口 | 从当前支持用例建立完整有限覆盖，复用现有 planner 暴露同源能力；具体变体继续审查，不把内部全部 primitive 直接公开 |
| 机械接力 | 身份、空页 HTML 首次 content→insert、装配、资源准入、正式事务和保存已有实现；两 AI 端仍分别 attach/issue，模型仍搬运资源引用和安排底层接力 | 迁移工具间可确定的接力到现有用例；模型表达内容、对象/页面/图片选择及编辑意图，不维护 ID、版本、登记表、命名空间或内部调用顺序 |
| 源码/文件级编辑 | Runtime/组件源码、普通 UTF-8 文件编辑、工程局部 `content/from` 已存在 | 贯通当前状态的按需源码和正式应用，不再发明源码兜底，不直接覆盖整个 H5 归档或重生成整课替代局部编辑 |
| 首轮最终结果 | 原三路续作作品及相应互动、保存/冷开通过；MCP saved19、内置 saved10 来自多次续作 | 有效证据复用；新增独立编号的单请求完整 MCP/内置验证，不把窄修、只读 QA、Root 验证或续作完成计成从空白创作通过 |

直接证据入口：[结果结算](../../../src/main/workbench/execution/executionOutcome.ts)、[Engine](../../../src/main/workbench/execution/ExecutionEngine.ts)、[MCP](../../../src/main/workbench/external/ExternalMcpService.ts)、[当前源读取](../../../src/main/workbench/projectFiles/componentPlatformFileInput.ts)、[公共 schema](../../../src/core/tools/toolSchemas.ts)、[人工设置](../../../src/renderer/ui/properties/CourseGlobalPropertiesContextBuilder.ts)、[工程文件应用](../../../src/core/projectFiles/componentPlatform/coordinator.ts)。只读源码确证与真实执行证据分别报告。

### 7.3 完整覆盖边界与唯一业务 owner

S0 先建立**本次版本绑定的有限覆盖关系**，置于本节或同包字段中。来源是当前受支持的人端生产用例、正式作者操作/文件 binding、公开工具及输入/资源/执行/delivery 服务入口的并集。正式操作用于反查遗漏，不要求所有内部辅助操作公开；历史 V9/死代码不纳入当前支持承诺。

按用户语义归并，每项只记录：现有入口、领域 owner、当前值与目标读取、准备/应用、业务结果、全部必要直接消费者、合法适配差异、待退出旧决定、已有有效证据及剩余差额。**双向核对入口→owner 和 owner→消费者**；不能只从 ToolCatalog 或问题编号反推，也不能将已有能力临时降为不支持来洗绿。尚未逐项核对的专业内容、互动、全部项目配置及文件用例保持待核，不称全集完成。

范围覆盖当前 H5/普通 HTML/文本文档的共享创作编辑职责，及实际接入这些职责的专业/Office/资源用例；它们独有格式适配保留。运行、观察、保存和输出的真实消费者按受影响属性接入；播放器不取得编辑权限，不建设载体笛卡尔矩阵。原已统一运行、正文、几何、呈现和生命周期按有效证据映射后复用，只处理新差额。

| 共同职责 | 复用落点与主要直接消费者 | 必须退出 / 合法差异 |
|---|---|---|
| 当前状态与按需源码 | 输入 owner prepare/settle；DocumentHost/Session/FileService；`AgentFileText`、工程投影、源入口和依赖读取；人工源码视图、两 AI 上下文/显式读取、人工导入 | 退出按格式/入口另选磁盘旧稿和独立“最新上下文”；各编辑器 IME/手势及格式解析保留 |
| 语义编辑与能力定义 | 既有专业、布局/结构/状态、源码 planner；ContentApply、Gateway、ToolRegistration；实际人工命令和两 AI 注册 | 退出各端重写语义、裸字段代替联动操作；选区捕获、界面交互、协议输入与模型规划保留 |
| 成果、资源与载荷 | 既有 ImageGenerationService、ImageResultsDesktopService、HostCoordinator、资源准备与 Gateway；图片卡片、Engine、MCP reply、源码/资产应用 | 退出端内猜图片来源、命名空间、可用性及后续读取；授权证明来源和显示/编码保留 |
| 创建打开与目标接续 | AgentFileService、DocumentHost、Gateway；人工打开、Engine、ExternalMcpService、工程编辑入口 | 退出端内重复 attach/issue 和模型搬运内部身份；按真实权限派生目标，不扩大用户冻结范围 |
| 提交、保存、恢复与交付事实 | DocumentSession、既有 modelToolResult/资源与delivery owner；UI、Engine、MCP、结果卡片 | 退出调用受理=交付、旧失败=目标未达成等重复决定；各端循环/停止、模型内容判断及不同保存格式保留 |

同源用例要包含输入、适用条件、目标/状态/字段范围、准备和结果，不止共用最后一次 Session.execute。尺寸调整沿用 preserve/contain、关联 frame/状态及共享层语义；答案修改沿用专业判题 planner。禁止用通用裸 JSON/field.set 绕开这些已知关联决定。

#### 本轮有限覆盖核对（3095ea02＋有效未提交方案，2026-10-08实施接手）

S0 已从实际人工入口、正式操作/文件 binding、公开工具与服务入口反查下列集合；此表记录本轮共同创作编辑职责，不宣称全产品或载体笛卡尔矩阵。闭合状态随对应候选和消费者证据更新，尚未集成不得写 PASS。

| 受支持用例集合／实际入口 | 现有 owner 与全部必要消费者 | 差额及合法适配 |
|---|---|---|
| 当前源稿、文件读改、HTML/组件入口及依赖；LessonDocumentEditor、file.read/write/patch、人工HTML导入、project.apply(from)及工程范围read/list | 原输入 owner / SelectionContextController prepare → DocumentHost / Source Session → AgentFileText、componentPlatformFileInput、readHtmlClosure、componentSourceClosure、HtmlImportDesktopService；既有componentPlatform projection/coordinator → 源码视图、两AI显式读/上下文、正式应用 | U/C当前源与输入ACK、I范围路径/依赖/同捕获分页均限定PASS；同名改序邻居和named-state override因果题有效，scope-qualified alias不改未选对象/base，源码/theme基态明确。未开读盘、编码/二进制/realpath保留 |
| 文件创建打开、组织、当前稿复制、SaveAs；WorkspaceFilesTree/explorerCommands/TopToolbar与公开file工具 | WorkspaceFiles / DocumentFileCoordinator / DocumentHost → Registry、journal、DocumentFileSession、tabs.changed、Engine savedBindings、Gateway当前目标、正常保存冷开 | G/I退出两端attach/issue重复决定。媒体原owner重定位、pending preview current-copy、tab稳定身份/并发去重和Office精确binding授权七题及独立review限定PASS；原生文件对话框和外部系统编辑器差异保留 |
| 工程/页面设置；CourseGlobalPropertiesPanel/ContextBuilder、PresenterSettingsEditor、页面属性 | 现有尺寸/呈现planner → courseStructure/属性、公共注册/Gateway、project files/read、Player/导出 | I将title/theme/designTokens/background/完整playback、尺寸preserve/contain与状态frame联动归同源用例；不以部分controls替代完整播放设置 |
| 自由对象保身份结构、命名状态、放置/可见范围；NodesTab/selectionObjectCommands/crossSurfaceCommands、SceneStateStrip | 既有复制/重定父/状态/呈现planner → 人工动作/属性、object/presentation工具、History、运行/保存消费者 | I实接当前生产入口并退出重复状态/结构决定；多状态到无状态仍直接拒绝。无生产consumer的group/ungroup不据此新增能力；视图选态/IME保留 |
| Flow正文/浮层位置及阅读顺序；FlowPropertiesContextBuilder/FlowWorkspace/flowAuthoringSlice | 原Flow规则归现有core领域planner → 人工三入口、公共object.place/surface.configure、正文/浮层运行呈现及History | F迁出端内placement/settings/reading重复规则；DOM观测/anchor冻结保持适配，Flow正文不伪造自由图层 |
| 专业内容、互动、课程媒体/logic/network；专业属性、AutomationTab、DeveloperTab、MediaTab | 已有editTableData/changeChartType/input-rule/component-rule/course-logic/media planner → 属性/正式源码及data应用、公共读写、判题/Player/资源/保存 | I/A专业同源纯planner实际接属性、Developer JSON、公开工具和ContentApply(data)，专业判题联动、完整chart新series及global无页input差额均限定PASS；局部Runtime/组件源码已有通道复用，不重建 |
| 生成成果/预览/参考图/正式图片应用；图片卡、image工具、材料/MCP资源/view.observe、asset/from/application | ImageGenerationService durable job/blob、HostToolCoordinator授权解析、Gateway资源事务 → Desktop预览卡、Engine、MCP content、参考编辑、正式资产、artifact.save、恢复继续 | A/I/G统一typed图片载荷和generated ref；退出端内previews/data.image/resourceId猜测。人类续授权/可读unapplied与AI冻结grant/Ready要求保留，离线复用原Ready |
| 提交、恢复、明确保存/导出、task.finish；两AI循环、file.save/project.save/document.export、TopToolbar | DocumentSession / modelToolResult客观facts、Gateway当前snapshot投影、原DocumentDeliveryService → UI、Engine普通/压缩请求、MCP、task结果、真实文件/Player/导出 | I/G/X有限组合PASS；按当前canonical字段/真实提交恢复，empty patch不伪恢复，历史错误留诊断。finish明确交付由原owner机械执行；save→edit当前dirty与历史receipt并存，未增保存义务。无原话不猜保存，unknown查原操作、停止不重放、内容判断归模型 |
| Office原格式与图片/PDF原文件；office工具、Explorer系统打开/媒体标签 | OfficeFileService/OfficeContentService、MediaFilesService/FileArtifactService → 原格式回读/结果、文件树、媒体编辑器/保存、系统打开 | Office服务同源复用，不承诺系统Office未保存栈或H5 History；媒体本地手势表示合法，但上述重定位/current-copy消费者差额须修，不临时撤掉已支持入口 |

原运行/正文/几何/呈现/关闭、GJS与HTML往返等有效证据按其范围复用；独立T提出的三条代表验题落各领域候选。S0有限覆盖及S5旧职责退出须由未参与实现者结合实际diff独立核对，表格本身不是产品完成证据。

### 7.4 当前源码上下文与机械任务移交

1. **读取的是当前状态。** Renderer 输入先由原 owner settle/ACK，Main 再捕获正式 Session；Registry.drain 不等于已接收未 ACK 的输入。入口源文件和已打开依赖都通过同一读取职责取得当前稿，未打开内容才读盘。普通修改仍不自动保存磁盘。
2. **上下文按范围给。** 对象/组件提供其当前数据或实际源码及必要依赖；当前页提供当前页源码、布局/状态/互动及相关依赖；整作品提供完整可寻址作者内容，可按需分页，续页使用同一捕获基线。真实作者内容包含相应 HTML/CSS/JS、专业数据和正式结构，不用简化 HTML、截图或旧摘要代替。
3. **软件维护机械信息。** 内部身份、编号、捕获版本、资源映射、引用重签、空页准备、依赖闭包、事务/History 和保存版本均归软件。模型只选择用户语义目标、提供内容与修改意图；不要求固定模板、工程登记、ID 清单、错误关联码或完成 checklist。
4. **局部源码是已有正常编辑通道。** 实例覆盖、共享定义、状态局部修改各守原范围，源码应用保留人工布局、未选对象及资源关系；Canvas 等不能自动识别的内部内容可改该组件源码或用既有 authoring 注册，不承诺任意程序反解成原生对象。
5. **文件只是输入/编辑载体。** 普通 `file.write/patch` 和局部 `project.apply(content/from)` 沿现有正式事务；软件负责当前源与依赖摄取。H5 不按 UTF-8 归档覆写，不关闭文件绕过 writer；已有第三方 HTML 导入仍可用，但不成为已有工程局部修改的重导替代路线。
6. **机械接力由用例完成。** 创建/打开回执接续当前目标；内容提交由现有装配准备；所选原 Ready 结果由资源 owner 准备预览/应用/保存；用户已明确要求的保存由明确交付意图与原 delivery owner 执行。外部 MCP 未提供的用户原话不能凭空推断；各端把明确用户动作/交付意图交给共同用例，软件承担内部顺序，不要求模型补一串底层调用。

共同结果只对跨入口业务目标、资源载荷和应用/保存事实保留明确类型，不替任意用户 JSON/第三方材料另建 schema 平台。注册引用领域能力，人工入口实际调用同一命令；三端仅转换 UI、模型消息或 MCP content。同类新图片来源只改共同业务，新增媒体结果类型的漏处理由穷尽转换检查暴露。

### 7.5 结果判定与正常停止

- 最终必要目标和交付已达成时，可 completed，并保留中途诊断；已恢复调用不因参数、路径、表示或 intent 改变而永久拖成 partial。恢复依据当前 canonical 目标及实际结果，无关成功不能覆盖另一项真实缺口。
- 真正缺页、用户要求的图片未应用、必要保存/交付未完成等是当前缺口。Ready 只证明生成，是否必须嵌入/存盘按本任务明确目的解释；不强制所有 Ready 图片都必须应用。
- 已提交、可运行、保存及观察是不同事实。warning、可选诊断失败、观察环境暂不可用不推翻已提交结果，不自动增设结束门；必要验证缺失如实报告。
- 共同 owner 提供客观事实；内容是否满足用户意图由模型结合当前作品判断。结束声明不能仅靠自报成功，也不要求模型另填目标登记表。具体事实与未完内容一起用于决定继续或结束。
- 有明确可完成的剩余机械工作时继续原任务；确实无法完成可诚实 partial。pending 查询原作业，unknown 查原操作，禁止未知副作用重放。用户停止或不可恢复异常仍可结束并报告未知，不能扩成永不终止。
- 保留不同执行循环、授权来源及停止行为。人工明确重新授权不等于恢复已撤销 AI 写权限；不引入隐藏付费重试、固定轮数/时限或强制所有 partial 继续。

### 7.6 职责批次、共享写域与依赖

下表为同一执行包的后续差额，入口、领域 writer 和检查保留在 `WORK_PACKAGES.json.followup`。实施组织按工作协议，主执行者可写产品代码，真实创作验收不代写课件。历史 S0 调查/独立 T 不形成固定角色前置；仅实际并发、交接或阻断维护任务卡，公共实体单 writer 顺序集成。

| 批次 / 既有包 | 结果与旧职责退出 | 开工依赖 / 最低充分证据 |
|---|---|---|
| S0 / U00、U22 | 建立事实导出的覆盖关系、共同与差异边界、保留行为及必要小合同；明确每项 owner、全体消费者和差额 | 当前基线与生产入口。一次有限静态双向审查；没有完成全集盘点不能称整体统一，但已明确责任的叶可先开发 |
| S1 / U01、U03、U18 | 当前输入 settle→同源当前稿/依赖→范围源码；创建打开目标接续；退出格式特设版本选择和两端重复 attach/issue | S0 对应读取/目标合同。Session 新、磁盘旧样本含 HTML/JS/JSON 及一依赖，经真实消费口一致；未打开读盘和原输入 ACK 行为有效 |
| S2 / U00、U02、U06、U13 | 共享用户语义命令和配套读取，补设置/结构/状态/放置等实际能力缺口；退出入口裸写、源码模拟宿主字段、redo 替代保身份结构编辑 | S0 对应用例合同；涉及新当前目标时依 S1 对应叶。采用原 planner 的一组代表行为，保身份/范围/布局与一次历史；不用每个字段完整 GUI |
| S3 / U03、U18 | 统一成果/资源解析及类型化可消费载荷，接图片卡/Engine/MCP/正式应用；退出各端 `previews/data.image` 业务解读及引用路线猜测 | S0 资源/结果合同，复用原 Ready。三个薄消费者实际交付同一图片；一真实授权/停止反例及必要应用/保存往返，无新增生图 |
| S4 / U03、U20 | 统一提交/保存/恢复事实，按当前必要交付收尾；退出旧调用失败或同参数匹配决定目标状态 | 稳定的 S1–S3 相关事实合同，不等无关叶整包。恢复完成后 completed 且历史诊断可查；真实缺口仍 partial；未知结果/停止不重放；明确保存意图由原 delivery 处理 |
| S5 / U00、U22 | 在真实依赖方向、共同注册/结果类型和实际消费者中防再分叉；所有差额映射闭合，未闭合项准确列剩余 | 从 S0 开始，逐批同行；最终依 S1–S4。现有依赖检查的针对性扩展、类型检查与消费者静态核对；不建立新治理平台/全仓门 |
| S6 / U22 | 用真实单请求完整创作证明最终软件链可用，并保留首次/续作/新验证分别记录 | 覆盖与候选整体闭合、已知核心阻断关闭，相关构建只准备一次。正常公开 MCP 和真实内置 AI 各一次新完整任务及后续保存重开/运行/交付独立核对 |

S0 是确定覆盖边界，不是先造总平台；小合同稳定即释放非重叠叶。**每批同 owner 的全部实际消费者迁移、旧重复业务退出和对应已知症状一起关闭**，不先搭空统一层再另逐点修补。整体统一完成需全部覆盖项闭合；局部已完成不能升格为全集证明。

### 7.7 防回退与后续新增能力规则

本次现实回退风险：尺寸/结构/状态关联语义丢失，局部源码误改共享实例，当前输入/依赖被旧稿替代，重复提交/History，以及合法 UI/授权/运行差异被抹掉。

- 每批保留行为来自当前实现、真实作品、有效证据及最新 Owner 决定；复用专业算法/成熟 UI/原 planner，不以新实现反推验收、不降低支持范围。多状态 Slide 到无状态 Flow/Spatial 粘贴继续按 Owner 决定直接拒绝，不再设计转换或降级。
- 保留原 DocumentSession writer、History、最终字段 CAS、停止屏障、授权根和未知副作用查证；不另建作品副本、状态库、资源仓库、兼容层或协作平台。Provider Secret/原始 Main/任意 OS 命令/未开放宿主 API 不进入作品或组件。
- 在隔离候选按职责迁移并保持整体可审阅/可撤回；代码回退不回退用户工程、不清人工修改、不删除恢复稿。未提交 Owner 文档和既有作品保全，既定 V10/V3/API5 不变。
- 新增/修改共享能力必须在定义处同时落实：唯一 owner 命令、真实人工消费者、同源工具注册、目标/结果合同、必要观察/资源/保存消费者。特殊 UI 需要实际接线，`manual` 元数据/编译通过不能证明按钮可达。
- 入口不再持有被迁移的版本选择、资源解释或语义 planner。收窄其依赖端口，按实际被退役绕路扩展现有 import/boundary/type 检查；规则检查调用方向与职责，不按源码字串、Hash、行数或文件数量宣布统一。
- 独立 reviewer 审当前支持范围、替代选择、候选 diff、全部直接消费者、旧业务退出和保留行为，不只审作者列出的新测试。未变有效 review/检查复用；各入口的协议、手势、IME、视图生命周期和执行循环合法差异保留。
- 新能力漏接先由共同注册/类型和有限接线核对暴露；只有相关变化、失败或新假设才补对应行为检查。不新增常设审批、评分体系、平台或机械全矩阵。长期规则落在 [WORKING_PROTOCOL §1.3](../WORKING_PROTOCOL.md#shared-business-closure)，本节提供本批具体范围。

### 7.8 真实验证、费用与最终完成标准

“单请求”指一个用户初始请求，允许同一任务内多轮正常创作、工具反馈和局部修订；目标是无需用户/Root 救场而自动得到完整作品。不是一条模型响应、一次工具调用或零中间错误。策划/框架照常产出，已授权自动推进时不等待确认；教学方法留在内容 Skill，不写入通用执行器。

软件验收聚焦：必要内容进入正确目标、真实图片/资源实际应用、关键互动能运行、人工修改保留、可编辑/撤销、按请求保存、冷重开和正常交付。内容设计质量单独记录，不把模型设计偏弱自动归因软件，也不用内容优化阻断软件收口。三路作品与裸 HTML 对照仍保留，可靠软件耗时/等待和人工干预据实际记录，不编造排名或固定时限。

新完整验证至少覆盖公开 MCP 和真实内置 AI，各由原规定 `gpt-6-luna/medium` 作者沿正常入口从空白开始；同材料、规模、关键互动及图像规格。Root/T/reviewer 不代写或手动补图；内置必须实际选择对应 Luna 路由，不能用外部作者代写、受控 provider 或回放替代。

原三路首次记录与有效续作全部保留，裸 HTML 未变证据复用。此次新完整任务另编号，不重写原首次。每个新完整图像任务按同一既有 GPT OAuth 连接完成本任务真实生图与嵌入；工程修复/离线验证阶段先复用原 Ready，不用额外生图探路。记录真实请求/模型/执行者/推理和用量、图像作业及保存交付事实；费用未知就记未知。新供应商/账号/收费路径、升级模型、管理员安装、真实用户迁移或发行仍须 Owner 决定，不重复索已有授权。

新完整任务失败先保全原请求/回执和作品，沿同根软件 owner 定位；同因没有实现、环境或假设变化不重复付费。已成功作业查询/复用，不重生；续作完成单列，不能填回单请求成功。只读 QA、窄编辑 completed 或 Root 冷开/导出不能替代作者完整任务。

最终必须同时满足：

1. 当前支持范围的入口→owner→全体必要消费者覆盖闭合，已确认差额均有修复或有证据的合法差异；无临时降低能力。
2. 共同业务决定实际只归一个 owner，生产入口对应旧重复职责退出，注册/类型/依赖方向体现这一结构。
3. 受影响保留行为经最低成本充分证据和适用独立 review，通过；未变有效证据复用，未覆盖项如实列明。
4. 新 MCP、内置 AI 单请求完整创作实际通过，结果保存重开/运行交付成立，首次与续作分别记录；本计划完成不等于这些产品目标完成。

交付仍写既有当前状态、问题记录、实施结果和本包 review。不得以同一 Gateway、一个 writer、文件数量、局部 PASS 或三份补救作品代替上述目标；不发布、不部署、不记 Owner accepted。

## 8. 存量机械职责梳理与结构约束（Owner 2026-10-08 最新范围）

### 8.1 本轮授权、基线与判定

Owner 暂停继续逐错误修补和付费创作，当前授权：梳理全部现有能力的机械职责；与该迁移无依赖的过早 finish 可先修。接手 `3095ea02` 与主树全部有效未提交成果，原领域限定 PASS、原作品、Ready、首次/续作记录继续保全。本节是当前审计记录和后续迁移输入，**不表示机械迁移已经实施，也不恢复全部 S0–S6 运行。** 发行暂停。

机械职责的统一判定：依据已经表达的用户意图、当前授权状态和既定规则，软件能够确定或执行、无需新的内容或用户取舍的参数、前置步骤、装配、结果接续与交付动作，均由软件承担。模型保留内容创作、目标/来源选择、设计与互动逻辑；按需读取当前内容、选择候选、真实冲突判断不是因为有一次工具调用就变成机械错误。内部平台身份与作者程序变量、业务 key、第三方真实参数分开判断，不能按字段名批量剥除。

### 8.2 有限全集与双向覆盖来源

本轮由五个领域只读审查并由独立结构 reviewer 补核目录外入口。覆盖取以下并集，不用旧错误清单、生成索引或 ToolCatalog 单独冒充全产品：

- 当前 `ToolCatalog.toolRegistrations` 实际源码导出 **83 个无重名注册项**；union/nested schema 同样检查，不以顶层 shape 为空略过。它只证明工具集合的分母。
- `ExecutionEngine.runTools` 的六个追加定义：`course.createFromHtml`、`tools.load`、`context.read`、`task.note`、`task.finish`、`ask_user`。前两者也由 MCP 提供。
- `ExternalMcpService.serviceTools` 的四个专属定义：`workspace.list`、`workspace.switch`、`workbench.state`、`operation.recent`；切换空间是选择和绑定操作，不能因 read 标签误认为无状态读取。
- 当前普通生产入口：工作空间文件树/文件编辑器/GJS/媒体文件编辑器；页导航、Nodes/Elements/各表面与专业属性、Developer/源码/Automation/媒体库/组件库；结果卡；Spatial 镜头与关系/缩放；Recipe；Productivity（批量文字/颜色、参考复制、样板改写、向当前工程追加 PPTX）；导入/保存/预览/交付。入口与其实际 owner/消费者对应，不从 manual 元数据推定按钮存在。
- `courseAgentMethodSkills` 实际打包的六方法与其 references/scripts：orchestrate-courseware、build-courseware-project、edit-content、office-content、research-and-report、data-and-report；普通系统上下文、能力发现、回执与续作投影一并核对。

当前注入的受管浏览器还提供 navigate/snapshot/find/screenshot/wait/click/type/upload 八种操作，经 mcp.discover/invoke 的原 owner 追踪；第三方动态工具只核本软件的发现、授权、回执与资源接力，不承诺替任意第三方 arguments 定义内容语义。注册能力与当前配置可运行状态分列：delegate、web.search、media 生成当前 factory 有未配置/未放行条件，不能抹掉注册能力或声称已运行通过。旧 `html.import`、未注册的 `project.write/edit/move/delete` 不进入当前 V10 公开工具分母。

| 现有能力组及实际入口 | 对应公开工具/消费者 | 已由软件承担与保留的内容选择 | 本轮结论/差额 |
|---|---|---|---|
| 当前文档、对象/页面范围、专业字段与源文件 | read/inspect/listChildren/view.observe；project.list/read/apply/save；Developer/两种源码编辑器/Flow 正文 | 当前输入 ACK、Session 捕获、已开依赖当前稿、未开内容读盘、自然路径/分页基线、源码摄取/资源/事务；内容读取与 insert/redo 是语义 | 自写后引用刷新、低层 implementation 暴露仍有差额；分页传输接续应与必要分段阅读分开 |
| 15 个 canonical mutations 与专业/表面 UI | text.replace、object.update/convert/structure/place/author、media.insert/apply、presentation.update、course.configure/logic/media、surface.configure/duplicate、interaction.update；属性/Automation/Nodes/页面导航 | 新对象/状态/规则/动作身份、复制引用与结构/专业 planner、History 已有软件 owner；位置/样式/规则/变量是意图 | 图表 ID、移动行列全序列、嵌套平台引用、Flow 转浮层准备未全部收回；不以共享 planner 推定前置准备闭合 |
| 生成/图库/资产与正式素材使用、结果卡/媒体库 | image.generate/edit/status/search/preview/fetch；asset.search/use/save/import/delete/update；media.insert/apply/course.media；project.apply(from)、背景工具 | 连接/授权、字节解码、生成身份、完整包与资源闭包、默认插图、正式事务、结果卡 provide/apply、保存/Player/导出；候选选择保留 | 通用 job 回执、背景应用、材料/第三方图复用、音视频人端摄取与模型入口分列 |
| 文件创建打开与组织、当前稿复制、HTML/GJS/Office、媒体文件 | file.list/search/open/observe/reconcile/create/read/grep/write/patch/mkdir/copy/move/rename/trash；course.createFromHtml/importPptx；file.save/document.export | 文件授权、格式推断、binding/重定位、current-copy prepare/serialize、依赖闭包、原格式组装与落盘已归原服务；路径、disk/current 和外部冲突取舍保留 | 已落实主链；当前工程追加 PPTX 与新建 PPTX 工程不同，不能相互替签。旧孤立 API 不计当前支持 |
| Office、材料、研究、计算/委派及结果交付 | office.inspect/create/edit；material.list/read/find/extract；web.search/open；compute.run/delegate.start/read；job.status/wait/logs/cancel；artifact.save | OOXML/版本 binding、材料原件登记/提取、作业身份/输入冻结/输出发现、字节搬运与交付 owner 已存在；研究判断/代码/选择输出保留 | 派生表示/引用/分页/作业状态与确定性交付仍由模型串接；不强制预读全文或保存所有候选。当前未配置能力单列 |
| 浏览器/第三方能力与外部会话 | mcp.discover/invoke/resource；workspace.list/switch/workbench.state/operation.recent；受管浏览器八种动作 | 当前快照默认、授权、上传冻结、下载保管、操作回执由宿主；观察后选元素/动作属于意图 | 平台资源后续复用表示需统一；不能把网站目标选择或第三方业务参数自动化猜测 |
| 方法发现、上下文、确认、停止与结果事实 | skills.list/read；tools.load/context.read/task.note/task.finish/ask_user；Engine/MCP/ExecutionAssistant/六方法 | 专业方法按需读、冻结目标/授权、续作重签、上下文原材料可重读、当前保存事实 | 八族目前直接展示，load 无实际展开作用却仍在部分 Skill 中必做；finish 另行独立候选，未算 PASS |
| Spatial 镜头/路径/关系/语义缩放 | BottomSceneNavigator/SpatialPropertiesPanel→spatialAuthoringSlice/cameraCommands；project *.spatial.json | 人端会话相机、身份生成/删除引用、源码对象路径翻译已有 owner；pose、名称与关系为意图 | 源码按数组位置复用身份；当前视口镜头操作无对等语义准备，引用保真待迁移 |
| Recipe 与生产力批量/样板/参考页复制 | TopToolbar→App→RecipePanel/applyRecipe、ProductivityDialog/productivity；底层 project/batch/surface.duplicate | 配方/版式与组件装配、批量字段扫描/精确改动已有人端 owner；教学文案/正确顺序/样板选择为意图 | 表单强制稳定 ID、参考复制另造身份重映射、AI 需重做固定扫描/装配；须接现有用例而非新增平台 |

深度边界：这是当前接口、生产入口与直接职责链的源码审计；动态第三方实现、任意用户程序反解、全格式渲染/真实窗口/IME/安装矩阵不据静态表升级为通过。已明确尚未补完的生产入口继续标待核，独立 reviewer 最终核双向覆盖；表格数量不是完成证据。

### 8.3 已确认差额与既有迁移落点

下表使用本节局部 MECH 编号，不改原 R/N/M/F 归属。它是存量迁移范围，不表示已修或已派发代码。

| 项 | 源码证据与错误职责 | 复用 owner、全部必要消费者及退出条件 |
|---|---|---|
| MECH-01 意图/执行参数未分离 | ToolRegistration 接收任意 inputSchema，handler 直接收到模型原参数，describeTools 原样投影；已有原则未成为结构约束 | 在现有注册/领域用例区分 intent 输入与仅宿主构造的 prepared context；Engine/MCP/实际人端适配使用原能力。内部事实不从模型取值，不另建 dispatcher/能力目录 |
| MECH-02 自写 ACK 与逻辑目标续接 | Gateway 保留旧 footprint，已知自身提交后仍要求 read/inspect 复制新 target；path 与 handle 两种入口准备不一致 | 原 handle/ComponentProjectFileCoordinator 延续已确认自写的观察身份；同步 direct/batch/project/读取结果消费者。外部未观察修改、目标替换/删除、授权、epoch/停止与最终 CAS 保留 |
| MECH-03 专业数据身份/排序 | object.author chart/data 复用 categories/series/points 持久 ID；单行列移动需完整 ordered IDs；UI 已有 labels/names/values 和方向语义 | 原 chart.replaceChartTableData/table owner 生成并保留身份/引用、计算移动序列；专业属性、工具与 data 源入口同批接入。作者明确全新排序仍保留，旧强制 ID 输入退出 |
| MECH-04 嵌套平台引用 | trigger/condition/action、input-rules 反馈、背景 assetId、visibility/atSurface/paragraphAnchor、导航守卫、声音引用仍直接透出持久地址 | 原 interaction/input/placement/logic/media/background owner 从已观察逻辑对象/页/资源准备引用；核 nested/union 与回读/复制/保存/Player。courseState key、eventName 和用户程序变量保留为作者语义 |
| MECH-05 Flow 浮层准备 | courseFlowEdits 无 frame 拒绝；两个人端分别填不同默认，Gateway 直接转交要求模型补矩阵 | 原 Flow placement owner 处理默认/保留几何，属性/快捷条/作者切片/工具统一消费；明确坐标尺寸仍为意图，不借审计另选产品默认 |
| MECH-06 源码覆盖存储合同 | object.update implementation 暴露 workspace.ownerId/moduleBindings/resourceBindings；正常 project.apply 源码已有摄取 owner | 源码 owner 承担 workspace/依赖/引用装配；实例/共享/状态/恢复默认与 Developer 同粒度接入。退出低层执行字段要求，不改变真实局部源码能力 |
| MECH-07 作业与图片结果接力 | image ready/status 返回可消费 resource；job.wait/status、失联 lookup 返回原始 resourceId；模型需额外 status 或拼 job@resourceId，续作收集亦有差异 | HostToolCoordinator/HostJobService/共同图片 reader 投影同一可消费结果，接 Engine/MCP/预览/参考图/正式 apply/from/artifact 与恢复。保留原作业查询、Ready/unapplied/停止区分，成功图不重生 |
| MECH-08 素材到背景/其他来源复用 | UI importBackground 原子 asset.add+background；公开背景设置只接 assetId。material/MCP 图片可观察但没有同等应用/参考/交付桥 | 先核现有支持承诺，原资源 reader/背景 owner 处理选源后的准备和原子应用；不让模型临时造图对象再拆 assetId。材料/第三方桥与音视频文件插入按既有能力补接，未配置生成供应方不采购、不洗绿 |
| MECH-09 材料/计算/研究确定性接续 | extract/list/read 的派生身份、web PDF→材料、job kind/id→成果名→artifact、版本/offset 重填 | 原 Material/Web/Job/Artifact owner 管引用与续取；模型保留需要读哪些内容/诊断哪些日志、选哪个成果和是否交付。不能以减调用为由预读全部材料/自动保存全部输出 |
| MECH-10 Skill 与真实目录契约 | 八族直接展示；部分 Office Skill 必做 tools.load；方法/结果提示仍叙述内部簿记序列 | 共同注册/投影决定真实发现，六方法只保留专业方法与必要内容动作。同步实际生成消费者，旧无效 load/身份/结果拼接要求退出；不把策划/框架内容判断移入执行器 |
| MECH-11 Spatial 身份与当前视口 | coordinator spatial 按 index 复用镜头/路径/关系/缩放身份；人端 cameraCommands 按原身份重排/清理引用，AI 当前视口准备缺失 | 原 Spatial/camera 与投影 owner 管稳定映射/引用保真和已授权当前视口输入；project 源码/属性/导航/保存/运行同消费。不要求模型维护停靠内部号，不建立另一相机状态 |
| MECH-12 Recipe/参考复制/生产力 | recipe 表单要求稳定 ID 和 ID 正确顺序；referenceClone 自造 ID/有限字段重映射，不复用正式复制；AI 缺固定扫描/样板装配用例 | 原 planRecipe、duplicateSurfaceEdits、productivity 语义用例处理内部身份、完整引用、固定扫描/改写装配；接实际 UI 与公开意图入口。教学顺序/文案/样板选择保留，不让模型逐对象仿造人端算法 |
| MECH-13 当前工程追加 PPTX/音视频摄取 | 人端 Productivity PPTX 是追加当前工程，公开 course.importPptx 是新建另一工程；人端音视频导入不能由仅图片的 media.insert 替签 | 原导入/媒体 owner 补核现有语义入口和全部结果消费者，保留原件与当前人工内容。存在底层源码路线不等同已接共同用例；目前仅静态差额，不宣称所有路线均不能运行 |
| MECH-14 结束 owner | finish 与普通 stop 都可在读过确定失败后直接结束，未分明确可恢复缺口/真实阻碍；无关 save 不证明插图恢复 | 本轮共同早退先修已独审并合主树：注册 write/save + typed 明确可纠正拒绝、当前未消解相关链、同一退出/停滞事实；空白创建由真实 opened/created/commit 回执归因。已恢复诊断/可选观察不增门，unknown不重放。缺原逻辑目标的 target-not-found 不猜消解，其完备恢复仍依 MECH-02/04，不能写全部目标判断已完备 |
| MECH-15 专业插入/对齐分布的确定性算法 | Elements 与 Slide 拖放/右键分别准备默认数据/frame；已有多选对齐/分布算法，AI 需算派生坐标再 batch。教师控制器 ensure 已有人端 owner；当前入口未发现 group/ungroup | 原 insertCourseElement/既有插入 planner、alignment/placement 与 teacher-controller ensure 接意图，软件计算身份、组件/容器、尺寸与父坐标；所有实际点击/拖放/Flow body/paper/工具接原用例。保留位置尺寸/控制模式语义，区别 Slide Web HTML 保真和 Flow 专业解析，不虚增 group/ungroup 承诺 |

### 8.4 后续开发机制与存量退出证据

后续迁移沿既有 S1–S5 槽位、领域 owner 和全部实际消费者分组，先落真实职责再退旧入口，不先搭空统一层。**当前只授权梳理与独立 finish 修复；其他 MECH 项均未实施。**

本轮实际交付：有限静态覆盖由独立 `review_mechanical_coverage` Astra/xhigh PASS；共同早退先修与查询/活跃队列增量由另一个 `review_finish_guard` Astra/xhigh PASS，五个owned文件已原样集成。首候选两直接测试文件51/51；增量只选相关5/5（47未选），普通stop面对pending/unknown先查询原结果，live refresh不将本轮未调用的排队finish当成崩溃遗留，崩溃恢复原路径不变。主树“空白file.create→图像Ready→invalid-target→无关保存→finish及新读→纠正正式插图→保存冷开”1PASS（9未选），随后原运行job查询与unknown/同批read+finish/停滞两链2PASS（9未选），原计算/未知写均仅启动一次。最终Electron构建exit0。候选tsc仍报既存无关componentDataEdits.ts:88 TS2345，不宣称全仓类型绿。没有重启驻留宿主、GUI/付费创作或修改原作品，新Main构建待正常重启消费；不回填任何旧partial。

专业插入补核范围已到 ElementsTab、SlideLocationWorkspace/crossSurfaceCommands/slideAuthoringSlice、ComponentsTab/insertComponentPackages、FlowInsertMenu/flowInsertCommands、教师控制器 ensure/恢复、NativeSelectionContext/MultiSelectionPropertiesPanel 的对齐分布及 NodesTab/selectionObjectCommands。Flow 正文 HTML 已按 labels/names/values 自动生成表格/图表内部身份；MECH-03 不扩大为所有创建路径缺陷。Slide 普通 HTML 表格可保真进入 Web，当前专业映射与 Flow 不同，不能据此替签原生专业构造。未发现 group/ungroup 的真实入口，既有 group 数据不据此升级为能力承诺。

1. 能力定义只暴露内容、逻辑选择与公开选项；宿主执行身份/版本/资源/事务参数经原 Gateway/领域 owner 准备，处理器从宿主上下文取得。模型可以引用被观察的候选，不能生成、重签、拼 namespace 或维护内部表。
2. 确定性前置/后续步骤归现有用例：资源准备、装配、已确认自身提交后的接续及用户明确要求的交付；需要新的内容/来源取舍才回模型。两端 schema 由同一意图合同生成，人端真实命令同 owner。
3. 结构保证只承诺内部执行事实来源与调用方向；字段是否承载语义、存量遗漏、旧旁路是否退出由现有独立 review 判断。不用 mechanical=false 自报、字段名 lint、Hash 或模型绕行成功作为保证。
4. 每个存量组核入口→owner 及 owner→全部必要消费者；只读/已软件承担/待迁移/当前未配置分别记录。迁移 Acceptance 必须证明普通意图足够、软件完成已知机械步骤、旧 schema/Skill/端内准备同时退出。
5. 静态覆盖梳理与动态验证分开。共同机制用最低成本代表行为与真实错写反例证明，未变有效证据复用，不对每个字段/工具付费或 GUI 重跑。审计闭合、迁移闭合、真实创作通过、Owner accepted 是不同状态。


<a id="non-office-report-integration"></a>
## 9. 两份报告整合：非 Office 近期开发路径（2026-10-08，GPT）

### 9.1 本轮性质、依据与总判断

**本节是对当前唯一执行包的规划增补，不是另一个执行入口。** Owner 本轮要求读取两份最新报告和现行计划，寻找解决大多数近期可直接解决问题的开发路径，仅暂缓 Office 后续开发。本轮据此更新规划，不修改产品代码，不派发实施、不将 queued 改 active，不解除既有付费创作、宿主操作或发行暂停。后续收到实施指令时按本节释放剩余范围；实际状态仍以当前任务卡/状态页为准，旧授权字段不覆盖较新的暂停决定。

规划基线：`main / 3095ea020a4eef9864e865e4560ffbc1987cc913`，加读取时全部有效未提交成果。不能从只含 HEAD 的旧 worktree直接覆盖主树。本节作者未重跑报告中的离线复现、真实模型或 GUI；“已有通过”均引用原有效证据，“拟解决”不等于本轮已修复。

输入：

- [AI 创作与修改核心链路审查汇总报告](../../../AI创作与修改核心链路审查汇总报告-2026-10-08.md)：11 项已确认问题、R01 待 GUI 核实及证据缺口。下文用 **AI-F01–AI-F11 / AI-R01**，避免与旧计划历史 F/R 编号冲突。
- [全会话综合评估与优先级建议](../../../果铃_全会话综合评估与优先级建议_2026-10-08_GPT.md)：C0、H1–H6、O1–O3、X1–X3。
- 本计划 §7–8、WORK_PACKAGES.followup、CURRENT_STATUS 及两张 queued 卡：既有原生共编成果、15 组机械差额、MECH-14 已完成部分及仍未实施的迁移。

**推荐路线：用原领域 owner 的纵向切片，同时完成机械职责迁移和对应症状修复；先交付安全短编辑，再关闭资源续作与源码链，继而补齐存量语义、长程上下文及通用操作。** 不是先修完所有小错误再重构，也不是先完成全量抽象才让普通改字恢复可用。

不改变 V10 / Published V3 / Component API5、HTML-first、GrapesJS 投影、共同正文、三表面与唯一 DocumentSession。已完成的 U/S 子项和 MECH-14 有效成果复用，不重开历史全矩阵。F08 的来源结算及 MECH-02/04 的目标接续仍是剩余，不被“finish 已修”覆盖。

### 9.2 影响排序的本轮复核

| 发现 | 本轮依据与证据层次 | 对开发路径的影响 |
|---|---|---|
| 首轮载荷冻结与最终上下文不是同一步 | 静态复核 PayloadCompiler.ts 的完整载荷 manifest，以及 ExecutionEngine.ts:1393–1540 的摘要/当前文档追加；AI-F01 的真实核心服务离线反例来自报告 | 优先修最终装配的共同来源；不能仅改摘要值、错误文案或删除发送比较 |
| 开卡、排队、自写后续接是三个时点 | 静态复核 elementCardController.ts:199–430、ExecutionDesktopService.ts:462–645；MECH-02 来自现行审计 | 统一目标生命周期的规则，分别保留三种反例；不得以当前 revision 套旧字符坐标 |
| 图形承载问题与选区表示不是同一问题 | AI-F02/F06/F07 的解析器、Gateway 与人工差分证据来自报告；本轮复核 documentSelectionCommands.ts:21–28 仍限单目标 | 多范围支持、表示选择和表格升级同属正文 owner，但不能只删单目标判断或把图形转文字 |
| 图片与计算的恢复规则不一致 | 静态复核 HostToolServices.ts:213–453：workspaceImageScope 用 writableRun；readableJobRef 仅恢复 image；计算读取传当前 run | 将 F09/F10 与 MECH-07/09 同批，区分读取原成果、修改/取消作业和当前交付权限 |
| 压缩先丢输入，换模型不能补回 | 静态复核 summarizeContext 的 >100 字符过滤、末 12 条及前 1800 字符摘录；ConversationHistoryIndex.ts:29–36 的 600/8000 字符投影 | 先覆盖新退出区间与跨用户轮次的有效决策，再接可选独立压缩模型 |
| 搜索已有适配器，但 factory 未接 | workbenchToolServices.ts:178–181 创建空 WebResearchOptions；WebResearchService.ts:132–133 返回 not-configured；DeepSeekSearchProvider.ts 确有适配代码 | 优先核现有连接/适配器并接线；代码存在不证明当前线上协议可用，也不证明中转支持官方搜索 |
| 源码依赖两端采用同一种错误路径解释 | 静态复核 componentSourceClosure.ts 与 esbuildComponentCompiler.ts，均把带 URL 后缀的引用直接用于文件解析；动态差分来自 AI-F11 | 两端消费同一解析规则，不分别补一个字符串 replace 后宣称整链一致 |
| 当前仍有独立计算收尾卡 | teacher-local-compute 为 queued，已有离线计算/资源/Stop 等证据；完整 GUI/正常退出仍缺部分证据 | 并入 NI-02/07/08 的相关叶，不漏掉旧卡，也不恢复私有端口/隐藏启动支线 |

上述定位足以形成排期，不再启动新一轮全仓审计。报告的未确证 MCP 未 ACK 时序候选仅在命中相关改动时做最便宜判别；没有可达反例不升级成已确认缺陷。

### 9.3 唯一产品暂缓范围：Office 后续开发

| 暂缓的增量 | 本轮继续保留/处理的范围 |
|---|---|
| O1：PPT 原件深对象回写、轻画布和新渲染路线；O2：DOCX→Flow 原件精确回写与分页；O3：以 Office/Sheet 兼容为目的的表格内核引入 | 已有 Office inspect/create/edit、PPTX 导入/现有追加 UI、原格式保存与导出不删除、不降级；公共 owner 迁移只做必要薄适配/受影响回归 |
| X3 中的 WPS/Office.js/Office 引擎采购合作及相关前置研究 | 非 Office 的既有文件、材料、媒体、计算、HTML/Markdown 与开放格式工作继续 |
| MECH-13 的“新增公共 AI 入口，把 PPTX 追加到当前工程”及其新增 Office 专用适配 | 原人端追加能力保全；MECH-13 的**音视频文件摄取**独立进入 NI-02，不能整组暂停 |

“仅暂缓 Office”不等于新增任意格式引擎、递归 swarm、全局知识图谱等无限目标。本轮包含 H1–H6；X1 实现有限隔离子任务，X2 做显式来源/版本提示的近期切片。其长期自动联动形态保留为战略方向，不列入本轮交付承诺，也不偷偷取消已批准能力。凭据/费用/真实 OS 权限仍按原授权边界处理，只阻塞对应外部接入叶，不阻塞其他开发。

### 9.4 工作包与最短依赖

本表同时受 [§10 机制实施](#enforced-capability-methodology)约束：MTH-01–06 随实际能力迁移交付，完成标准不再止于修复或共享接口；规则/基线保护先做相关小切片，不形成全仓治理前置。

NI 是本节的规划索引，复用原 S/U 槽位、writer 与任务板，不新建执行器或第二任务管理系统。表中“可以开始”描述实施恢复后的依赖，不表示现在已派发。

| 包 | 优先级、结果 | 原归属/覆盖 | 开始条件与交付边界 |
|---|---|---|---|
| **NI-01 安全短编辑** | P0：请求发得出、只改原选区、无静默内容损坏、文字卡正常收放 | S1/S2；AI-F01–F07、AI-R01；MECH-01/02/04 的目标与正文切片 | 立即释放已定位叶；请求/目标/正文组合通过后交付。无须等待全量 MECH-01 类型迁移或所有专业组件 |
| **NI-02 成果复用与可靠交付** | P0：原 Ready 成果能继续查看/应用/保存，旧视觉失败不污染当前结论 | S3/S4；AI-F08–F10；MECH-07/08/09、13-AV；复用 MECH-14 | 与 NI-01 的领域实现可并行；接线消费稳定目标/当前权限事实，不等待所有语义迁移 |
| **NI-03 存量语义与机械职责收回** | P1 主线：普通意图足够，软件处理身份/排序/前置/复制装配，人工与两 AI 同源 | S2/S5；MECH-01/03/04/05/11/12/15；承接 NI-01 的 MECH-02 | 各领域按稳定目标/资源小接口释放，不将全体注册一次迁移当全局前置 |
| **NI-04 局部源码与依赖闭包** | P0/P1：URL 后缀模块可编译、保存、运行；源码输入不要求内部存储合同 | S1/S3；AI-F11、MECH-06，配合 MECH-04 资源引用 | 编译/闭包叶可与 NI-01 立即并行；Gateway 薄接线交唯一 I writer |
| **NI-05 长程上下文与压缩成本** | P0 可靠性＋P1 可选模型：多次压缩/跨轮仍保留有效约束与决策 | H1/H3；原 Engine/历史投影/task.note/context.read | 回放样本和独立投影可先做；Engine 改动接在 NI-01/02 当前请求与结果事实稳定叶后，不等 NI-03 整包 |
| **NI-06 真实工具接线与 Skill 解耦** | P0/P1：搜索/发现/提示与实际配置一致，退出无效必做工具步骤 | H2、MECH-10、MECH-09 研究叶、X2 近期切片 | 配置/适配器/Skill 核对可并行；涉及已迁移输入的 Skill 与对应生产注册同批更新 |
| **NI-07 通用执行与运行中协作** | P1：真实本地工具链、同 run steering、有限隔离子任务 | H4/H5/X1；复用原 jobs/执行/权限/文件/事件服务 | 执行依 NI-02 的作业事实；steering 依 NI-01 的目标生命周期；子任务依 NI-05 与原循环/作业接续。三叶不是互相串行前置 |
| **NI-08 差量验收与原主线收口** | 全程同行：把工程候选变成真实用户结果 | C0/H6、S5/S6、旧计算卡与当前剩余消费者 | 出题/最小观测从首波开始。核心旅程相关阻断消除即验证，不等无关低风险叶；最终本轮范围逐项有事实处置 |

**建议实际派发节奏：** 恢复实施先按 §10.9 为相关叶建立可信规则来源、行为基线和一条能抓住违规/漏测的检查；与安全候选并行，不等待全仓机制完成。首波 NI-01、NI-02、NI-04 的非重叠实现，加 NI-06 搜索/目录叶与 NI-05 回放准备；第二波逐领域合入 NI-03，同时完成 NI-05；第三波补 NI-07。NI-08 全程同行。某接口就绪即释放后继，不按整包瀑布等待。

**关键路径只有两条共享主干：** 一条是 `输入/目标/表示 → 语义写入 → 资源/保存/运行`；另一条是 `真实执行事实 → 上下文连续性 → steering/子任务`。同一 Engine/Gateway 的共享修改顺序合入；目录不同或 worktree 不同不能绕过同文件单 writer。

### 9.5 NI-01：把“可发送”与“不会改坏”一起交付

**首轮请求。** 在现有 PayloadCompiler/Engine 职责内，让最终上下文、实际 messages/tools、附件/自动上下文索引、预算、序列化与发送回执对应同一份最终请求。先判明哪些事实应在编译前冻结、哪些属于后续动态读取；不引入第二套请求快照服务，不只重算 hash 掩盖索引/费用账目失真。绑定文档首次请求与无绑定空白工作空间分别验证，不能把后者的成功当作前者已修。

**三个异步时点同一目标原则。** 开卡时保存正式 capture/baseline；排队接受时保留原 epoch/revision；启动/发送时沿原 Session 的变更映射到同一逻辑范围；自身已确认提交后按回执续接观察身份。模型不搬新句柄，重复文本不证明同一目标。删除/替换、相关范围冲突、epoch 改变和最终 CAS 仍正确处理；无关位移不应误拒。F04、F05、MECH-02 分别保留反例，不以修一个入口替签另两个。

**连续可见选区。** 一个用户选择可对应多个源范围或跨 Flow 对象的有序片段；共同读取、预览、授权、应用及逆操作必须完整表达它。复用原文字/正文用例和一次事务，不取首尾包围区间吞掉列表前缀/链接地址/未选内容，不只改第一片。不要重写成熟编辑器或改变整文档存储形式。

**内容承载与表格格式。** 对可承载 SVG/Canvas 的现有组件/源码路径按真实表示处理；映射会丢内容时原输入和原文保留，给可修诊断，不返回 applied。不能为了让文字工具成功而把图形抽成标签文字或空串，也不能擅自扩大选区写权限。紧急止损可以先做明确拒绝，但它只算“停止静默损坏”，不冒充“图形编辑完整恢复”；可承载路径在同一包继续接通。默认表格单元格的加粗/链接复用人工已有 text→content 升级，保身份、精确范围与撤销。

**卡片和源文诊断。** 未发送卡外点收起，卡内输入不误关；已提交任务的停止、结果、追问、撤销仍可达。复核当前 closeText 会删除会话，不把外点直接接成破坏性关闭；未发送草稿沿现有机制保全，不新建草稿 store。AI-R01 先做正常源文 GUI 判别：原文已 ACK、只有版式诊断时应能读取并修错；IME/输入尚未 ACK 仍等待原输入 owner，不以放行诊断绕过输入保全。

最低证据分组：生产 Compiler＋Gateway＋Engine 组合实际到达 stub provider；重复文字前插、排队前序插入、自写后继续三种目标题；跨段/列表/混排保未选结构；SVG/Canvas 不静默降级；默认表格格式/Undo；未发送外点与已发送会话；R01 正常 GUI 判别。使用实际生产类，不为凑“最多三条”删掉不同已知风险；可合为少量参数化运行。

### 9.6 NI-02/04：成果和源码进入同一个持续编辑闭环

**资源/作业共同语义。** 原 HostToolCoordinator/HostJobService/图片与计算 owner 返回可直接消费的来源，不让模型拼 `job@resourceId`、重新识别 kind 或为了复用原 Ready 再生成。创建、status/wait、历史 lookup、预览、参考图、应用和 artifact.save 沿同一来源解析；各端只编码/显示。背景、材料图、MCP 图和已有音视频文件摄取沿既有资源/背景/媒体 owner 接入；选择哪张图/哪份输出仍属于用户或模型内容判断。

**续作权限不是旧 run 的复活。** 通过已验证同任务接续链解析原生产者和原成果；读取范围、停止状态与当前交付权限分开。Ready 图片只读查看不授予 generate/edit/cancel 权限；计算续作只读原成功成果，不放开任意 run，也不重算绕过身份问题。保存按当前显式交付意图和授权，不能为完成率自动保存全部候选。

**结算按来源和目标。** 同一张图后续分析成功可以消解其旧视觉缺口；另一张图成功不清除真实失败。历史诊断保留，当前任务完成依当前目标与实际交付。复用 MECH-14 的 finish/stop、pending/unknown 与 live 队列成果，仅补缺失来源/逻辑目标事实；不得引入固定“继续 N 轮”、无界重试、结束 checklist 或重放未知副作用。

**源码闭包。** componentSourceClosure 与实际编译器消费同一现有 URL/模块解析规则：区分磁盘 pathname、query/fragment 与加载语义，保持授权根、realpath 和当前已开依赖优先。缓存后缀与改变加载方式的特殊后缀不能一概删除；未支持含义如实诊断，不能误作普通 JS 成功。MECH-06 将 workspace.ownerId/moduleBindings/resourceBindings 等准备交还原源码摄取 owner；实例/共享/命名态仍遵循原粒度，不给模型一套新的工程装配格式。

最低证据：原 Ready 同任务恢复→status/wait→明确保存/应用；只读旧图可见且无写/取消；同源视觉失败恢复与异源未恢复对照；背景/材料来源原子应用；音视频一份既有本地样本；普通模块与 `?v=1` 模块真实闭包/编译同样成功并验证受影响运行 consumer。保存/冷开只补受影响属性，不额外生图或跑全组件矩阵。

### 9.7 NI-03/06：按领域迁移，避免“抽象完成，用户仍要簿记”

MECH-01 是渐进接口约束，不是先改完 83 个注册工具的全局大工程。每个实际迁移用例在既有 registration/领域命令中区分“内容意图/已观察候选引用”与“宿主准备的执行事实”；同批接人工真实入口、内置与 MCP 注册/回执，退旧参数/旁路。不可通过字段名批量删 ID：作者的变量、业务 key、真实第三方参数可能本来就是内容。

| 领域切片 | 软件收回的职责 | 必须保留的用户语义与消费者 |
|---|---|---|
| 图表/表格、专业插入（MECH-03/15） | 内部身份、单行列移动序列、默认专业数据/容器/frame、必要控制器准备 | 标签/值/顺序意图、用户位置尺寸；Elements/拖放/Flow/属性/工具/源码及运行保存 |
| 互动/背景/页面引用（MECH-04） | 从已观察逻辑目标准备 nested/union 内平台引用，处理复制/命名态引用 | eventName、状态变量、规则逻辑仍由作者决定；回读、复制、Player/保存同消费 |
| Flow 浮层/布局（MECH-05/15） | 使用现有默认/保留几何、对齐分布算法及父坐标换算 | 不另选产品默认，不用 AI 手算所有对象坐标，不破坏正文阅读顺序 |
| Spatial（MECH-11） | 镜头/路径/关系重排后的稳定身份与引用、已授权当前视口输入 | 原视口/相机 owner 不复制；属性/源码/导航/保存/运行一致，不用数组 index 冒充身份 |
| Recipe/生产力（MECH-12） | 固定扫描、完整参考复制、身份重映射和样板装配 | 教学文案、正确顺序、模板选择仍由模型/用户决定；UI 与公共意图入口复用原算法 |

**搜索和真实可用性。** 优先核现有 DeepSeekSearchProvider 与原 Connection/凭据/运行授权边界，接入实际 factory；实施时查官方当前协议并用已经授权的单查询验证。不能将“有官方适配代码”“已配置聊天模型”“兼容中转可用”当成原生搜索已成功。无可用连接时显示准确配置原因与已有 URL/受管浏览器能力；不能伪造搜索结果，也不能以显示 not-configured 就把“真实搜索可用”勾完。外部凭据未就绪只记该叶待条件，其余任务继续。

**目录与方法同步。** 按 §10.7 将本项扩为六入口的方法/共用操作指南/可执行能力重组，并贯通真实打包、发现、安装和读取消费者，不只是删旧提示词。核对注册、生产启用、配置可用和当前权限可用四种事实。六方法同步删除无效必做 tools.load、资源/身份拼接和重复装配指令；Office 方法中纯目录说明修正属于共同清理，不借此新增 Office 能力。当前目录不必为了渐进披露重建工具平台；是否收起长尾由真实首轮成本决定。Skill 不能先承诺还没落地的意图操作。

**X2 近期切片。** 研究、材料、计算的已有结果/笔记保留显式来源引用和源版本；后续明确读取或更新时提示引用可能过期。优先复用原 sourceId/version、输入冻结与记录，不建全局依赖数据库、后台全盘扫描或自动跨文件覆写。这是可交付的轻量空间认知，不宣称完成操作系统级认知模型。

### 9.8 NI-05：先可靠连续，再做便宜压缩

处理同 run 压缩和跨用户轮次历史投影两个边界。仅修 summarizeContext 而让关键决策继续在历史索引中截断，不算 H1 闭合。

1. 按 token 预算保留近期完整工具轮；对真正新退出活跃上下文的区间增量整理，取消“短于 100 字符就无意义”等选择性遗漏。大结果使用确定性的来源/范围/错误或结果摘要与回读引用，超长退出区间可分段，不要求一口气重新摘要全部历史。
2. 复用 task.note/原始运行/现有宿主事实，保留有效目标、约束、否决及理由、后续用户更新的替代关系和来源。模型提炼语义，软件掌握提交/保存/权限；工具输出和文件里的文本不能因被摘要而变成用户授权。
3. 摘要和引用可用后才推进相应压缩覆盖水位；失败保留原记录/旧有效摘要，不错误声称新区间已覆盖。正常短编辑不触发强制摘要，不加每轮 LLM 审核门。
4. H3 使用现有模型连接/角色配置添加可选压缩选择，未配置沿主模型。无工具/写权限，按压缩模型自己的窗口/协议/输出预算构造；独立记录使用模型、用量/费用和等待。不同供应商的数据外发与收费授权不能继承为默认允许。
5. 覆盖正确后，再比较同一策略下廉价模型与主模型的语义质量/总成本。提供方不透明 native compaction 或某个 CLI 实验不是本轮前置；不为它更换整个 Harness。

最小回放覆盖：早期短禁止项、否决方案后明确改目标、关键事实位于长结果后部、多个用户轮次、连续多次压缩、已提交后的恢复。以保留约束/正确续做/引用可回读/不重放/总成本衡量，不以 JSON 可解析宣称语义无损。先用离线或可控 provider 定位；比较真实模型时仅使用现有授权连接和必要样本。

### 9.9 NI-07：补实际工作上限，不再造一套 Harness

**H4 受控本地工具链。** 复用既有作业生命周期、取消/终态、输出管理和文件提交能力，补命令/参数、工作目录、输出读取、退出码以及需要时的 stdin。第一切片使用已安装工具完成一个非 Office 的实际任务，如开放格式校验/构建或本地数据处理；只读诊断也必须有真实进程回执。Pyodide 继续处理合适计算任务，不冒充宿主工具链；已有 Codex 委派环境开关不能未经实际验证直接打开。

工作目录不是安全沙箱，原 workspace 读写许可不自动变成无限宿主命令权限。按现有明确执行授权/确认边界暴露宿主能力，保留必要隔离；没有可用受控边界时只处理已批准具体命令，并如实说明，不能用字符串过滤宣称限制任意代码。组件/外来内容不得取得宿主执行凭据或工具权力。可在候选目录执行的先产出候选，由原 FileService/DocumentSession 接入；已打开 dirty 文件不得被进程直接覆盖。未知副作用仅查询，取消不得残留继续写入。通用执行的工程实现与某次真实命令的权限确认分开，不让外部授权阻断其他已就绪叶。

**H5 同 run steering。** 首切片在下一安全工具边界吸收新用户指令，明确 UI 上“调整当前任务”与“排队新任务”的区别。新要求只影响后续动作，不改写已完成事实，不扩大旧任务权限、不读取用户临时新选区替换旧目标。进行中工具结果正常收拢，相关人工修改重新读取/映射；停止屏障、同范围冲突与已提交不重放继承 NI-01/02。接线沿既有 Engine/事件/ExecutionAssistant，不造第二会话系统。

进度主显自然语言和真实阶段，工具详情可展开；分别呈现模型响应、工具运行、压缩、等待用户、渲染/保存及错误。先复用已有事件/时间戳；不显示假百分比、不记录或展示秘密推理内容，也不为“性能可见”建遥测平台。

**X1 有限隔离子任务。** 在稳定原循环上复用任务/作业能力，先做只读研究或候选产出：明确输入/来源、有限预算、状态/结果/取消，结果带可回读引用，主任务按需吸收。不得直接写主文档，正式应用仍由主任务原 writer 决定；父任务停止能停止/回收子任务。首切片不递归，不引入另一个模型控制同一正式任务的停止/重试/权限。已有外部委派是可用性待核的实现选项，不等同必须依赖 CLI，也不因为“不做 swarm”把全部隔离子任务无限后置。

最小证据：一个真实本地工具任务及失败/取消；一个在写入间隙改变要求且保留人工修改的 steering；一个只读子任务返回原来源、父停止可落实的闭环。无真实宿主执行权限时可以完成代码/离线候选，但不能写“宿主工具链已验收”。

### 9.10 写域、旧方案保留与真正的停止点

保留 followup.writers 和任务卡已有精确归属，以下仅指共享实体的合入约束：

| 实体/域 | 既有唯一归属 | 本轮跨包次序 |
|---|---|---|
| ExecutionEngine / ExecutionDesktopService / executionOutcome / ExternalMcpService | G-agent | NI-01 请求/队列 → NI-02 来源/结算薄接线 → NI-05 上下文 → NI-07 steering/子任务；非重叠准备可先做 |
| DocumentToolGateway / ToolTargets / ToolRegistration / 公共 schema / project coordinator | I-core | 先目标/无损正文/自写续接，再逐领域 intent 迁移；其他包提交窄接线需求，不各写一套 |
| HostToolServices / 图像资源 | A-realm | NI-02 为主体；NI-06/07 的资源/作业增量由同 owner 合入 |
| 当前源/输入；源码闭包；正文/Flow；交付 | U-lifecycle、C-import、D-document/F-flow、X-delivery | 各守原域；新增/未列路径在实际任务卡分配唯一 writer，不能以本表推定未派发者已持锁 |
| workbenchToolServices composition factory、模型设置/IPC、新进程后端等 | 以当前任务卡精确域为准，派发前明确一个 writer | factory 不能同时被搜索/资源/通用执行各自覆写；package/lockfile/生成索引由原 Root-config 或指定机械 writer |

不因方便并行就拆巨石文件；只有真实职责/依赖证据要求时才在原 owner 内提取。用小纵向候选逐批集成，旧错误职责同批退出，不能留下两套可写事实。已明确成熟算法/输入/布局/运行保留行为继续按 §7.7，不能以“本轮只做 Harness”为由取消 GJS、三表面或共同正文。

每个近期待办在原任务卡记现有范围、变化、直接消费者和最低证据即可。NI 不新建永久缺陷库、覆盖率平台或另一套完成状态；机器包表只是静态派发输入。修复成立、迁移完成、真实模型任务通过和 Owner accepted 分开。

### 9.11 NI-08：验收足够早，又不让验证吞没开发

首轮就固定三条代表任务，不追求 harness 排名；它们不替代 §10.5/§10.8 的行为基线，“三条”也不是覆盖上限：短选区共编；多对象/资源/保存交付；长程研究/文件/计算续作。记录首个可见响应、首个正确修改、工具/压缩/等待时间、返工和已知费用；没有测到的成本/时长记未知。复用现有记录，不建立新 benchmark 产品。

| 验证层 | 要证明什么 | 何时停止 |
|---|---|---|
| 直接反例/生产类离线组合 | 本次已知错位、损坏、恢复/权限、压缩遗漏确实关闭；同时保留相应反例边界 | 属性已充分证明即停；测试穿过真实 compiler/job owner/consumer，不能 mock 掉失效位置 |
| 领域纵向消费者 | 人工/内置/MCP 的受影响适配实际同源；一次 History、当前稿、保存/冷开/Player/出口按变化闭合 | 只验证该切片必要消费者；UI 外点/IME 等用正常 GUI，真实编译用实际编译器 |
| 新正常完整任务 | 原 S6 MCP 与内置从空白的单请求完整创作，无 Root 救场，保存重开/运行交付成立 | 相关核心已知阻断关闭、候选/构建稳定后进行；不等无关低风险叶，不重复同因付费 |

S6 恢复时沿 §7.8 的既有模型、推理、材料/规模和图片连接规定，不换强模型掩盖软件问题，不重生成功 Ready。当前暂停收费验证的状态未由本规划改写；真正启动按最新明确实施/费用指令。首次失败、续作与新验证分别保留，原裸 HTML 对照与未受影响证据复用。

旧 fixture 的处理：不传 initialCompiler 的用例不能证明 F01；mock 原计算读取不能证明 F09；V9 断言和缺 scope.events 的 fixture 只在本次需要验证当前生产属性时修正，不据它们扩成全仓类型/测试迁移。全仓既存红灯不能冒绿，也不阻断无关已证切片。宿主加载新 Main 构建前须在正常安全退出/重启点进行，不能把磁盘 build 通过当成驻留 GUI 已消费。

**本次最终覆盖要求：** AI-F01–F11 均有相应修复和证据；AI-R01 判别后修复或有依据排除；未实施 MECH 的非 Office 部分逐域完成、旧旁路退出；H1–H6 及 X1/X2 近期切片有真实结果或明确外部条件；原主线剩余按有效证据收口。外部条件未满足的叶如实列未完成，不把“已接接口/未配置”洗成成功，不让它拖住全部已完成能力。

### 9.12 覆盖映射与接手指令

| 来源 | 去向 |
|---|---|
| AI-F01/F02/F03/F04/F05/F06/F07、AI-R01 | NI-01 |
| AI-F08/F09/F10 | NI-02 |
| AI-F11 | NI-04 |
| MECH-01 | NI-01 最小目标/正文切片＋NI-03 各领域迁移 |
| MECH-02 | NI-01，NI-03 后续领域共同消费 |
| MECH-03/04/05/11/12/15 | NI-03；04 的目标/资源小接口由 NI-01/02 先落 |
| MECH-06 | NI-04 |
| MECH-07/08/09 | NI-02；09 的研究/来源续取与 NI-06 同 owner |
| MECH-10 | NI-06，并与各生产注册迁移同步 |
| MECH-13 | 音视频→NI-02；新增 PPTX 当前工程追加公共入口→Office 暂缓；已有 UI/接口保全 |
| MECH-14 | 已通过部分复用；剩余来源/目标事实由 NI-01/02 补，不重新实现整套 finish |
| C0/H1/H2/H3/H4/H5/H6 | NI-08 / NI-05 / NI-06 / NI-05 / NI-07 / NI-07 / NI-08 |
| X1/X2 | NI-07 有限隔离任务 / NI-06 显式来源版本切片 |
| O1/O2/O3、X3 的 Office 合作部分 | Office 后续暂缓，不进当前依赖链 |
| 原 U/S、R/N/M 及 teacher-local-compute 剩余 | 不逐项重开；受影响且未闭合的非 Office 叶并入对应 NI / NI-08，已完成有效证据复用 |

后续执行者在获得实施指令后：读取当前用户指令、CURRENT_STATUS、TASK_BOARD、本节及 §10 的相关机制；保全主树有效未提交成果，复用原执行包/writer/任务机制。按 NI-01/02/04 的非重叠叶起步，同步准备 NI-05 回放和 NI-06 接线，不等全抽象完成；把同根症状与机械迁移一起交付，按表接续到 NI-03/05/07。每项结束明确真实改变、证据限度和剩余，不能用旧 PASS 替签新断点。本节只规划，不改源码、不启动模型、不开新费用、不重启软件、不提交推送或发布。

<a id="enforced-capability-methodology"></a>
## 10. 架构收敛、Skill 解耦与防回退机制的实施（2026-10-08，GPT）

### 10.1 当前授权、目的与“完成”的定义

**Owner 已确认方法论并要求更新开发文档、纳入机制实现；本轮仅修改规划与工作协议，不实施产品、Skill、测试脚本、CI 或远端权限。** §9 的非 Office 范围不变；本节补充其实现方法、前置小切片和完成条件。最新实施状态仍为暂停，既有两个任务保持 queued，不启动收费创作、宿主操作、提交推送或发行。后续明确实施指令到达后，按 §9＋本节推进；历史授权文字不得覆盖当前文档工作边界。

统一的单位是**受支持能力中的业务决定**，不是目录、工具名字或最终 writer。每项能力收口必须同时成立：业务规则有唯一领域 owner；全部必要入口实际调用它；端内旧决定退出；受影响的用户行为保留；针对已退出旁路的自动检查能阻止重新引入。一个导入边、manual 标记、公共 facade 或局部 PASS 均不能替签。

机械职责的完成标准：给出充分的内容意图、目标选择和已授权来源后，软件无需模型补内部身份、捕获版本、资源拼接或固定调用接力即可完成准备、应用和结果续接。选择内容/来源、阅读范围、程序变量及真实冲突后的取舍仍属于人或模型；不以调用次数少证明机械职责已收回。

本节同时约束两个对象：产品内 AI 由能力接口和执行授权约束；开发 AI 由依赖边界、行为基线及独立验收权限约束。确定性检查不承诺识别任意重复算法或证明全部未来架构最优；语义差异、合理例外和行为取舍由既有独立 review/Owner 职责处理。

### 10.2 本轮已核现状与应复用的落点

以下为本轮只读复核，不是机制已经实现或测试通过：

| 当前事实 | 对实现的要求 |
|---|---|
| `scripts/check-g20-import-boundaries.ts` 已有 AST import/export/require/literal dynamic import、核心/运行域、CLI、工具定义链及 semantic-owner 规则 | 扩展现有检查；保留合法 UI/协议/lifecycle 差异。现有 required import 存在不证明消费者实际执行同一规则 |
| `package.json` 已有 `check:g20-import-boundaries`、legacy ratchet、能力索引、Vitest/Playwright 等入口 | 先复用，不默认再引入依赖检查库、测试平台或第二 legacy 台账；旧 legacy 分母不直接充当本轮能力分母 |
| `.github/workflows/check-contracts.yml` 的 related 测试使用 `--passWithNoTests`，inputs 为空时 exit 0；未显式调用现有架构检查 | 增加受保护的选择与汇总机制，区分合理不适用与本应执行却未执行；不能只删参数而让漏选仍静默通过 |
| 工作流 diff 范围取 PR base/head，未见与集成候选实际身份绑定的最终聚合证明 | 明确实际被测源码/制品及结果身份，验证当前组合候选；不把数个 worktree 的分别通过相加 |
| 本轮列出的 `.github` 中未见 CODEOWNERS；远端分支规则、角色和管理凭据没有读取或修改 | 不据本地文件推断远端无保护；实施时只读核对实际规则及平台条件，权限变更由独立管理者执行 |
| 六份实际 Skill 混有方法、工具序列和平台操作；`edit-content` 依赖创作 Skill 下的 `references/project-files.md`；Office 仍要求必做 tools.load | 重组知识职责和真实加载链，而非仅改六个标题；软件尚未支持的操作不能提前写进指南 |
| 原 F01/F09 的部分测试曾绕过生产 compiler 或真实计算 owner；部分旧 V9 fixture 未运行到行为断言 | 验证必须经过本次变化/失效边界；迁移 fixture 与修改行为预期分开，不能以载体过时删除行为承诺 |

不由本节启动新一轮全仓审计。各领域沿 §8 的有限覆盖、§9 的差额和已知 V9 正常行为建立本次必要基线，之后只对变化增量维护。

### 10.3 MTH-01：意图接口与软件准备事实分离

**归入 NI-01/02/03/04/07；由既有 I-core、领域 owner 与 G-agent/A-realm 薄适配协作。**

在现有 ToolRegistration、领域命令、Gateway/Host 服务内，将正常入口分为意图输入和宿主准备的执行上下文。处理器消费后者中的身份、当前版本、目标映射、资源绑定、授权及事务事实；外部 JSON 中同名字段不得覆盖它们。软件持有的窄类型、构造端口和实际权限校验共同限定来源，单纯 branded type 或 TypeScript private 不作为运行期权限保证。

人工 UI 不必绕经 AI Gateway；它与内置 AI/MCP 适配器调用同一领域命令。各端可持选择捕获、协议解析、IME、布局观测和呈现生命周期，不再分别决定默认专业数据、身份排序、资源装配或写入后接力。低层 primitive 不因存在就全部公开，通用字段修改不能绕开已知关联语义。

模型可以引用软件已观察/提供的对象与结果，不生成、重签或拼 namespace；作者变量、业务 key、第三方真实参数仍是内容。局部源码/通用执行保留表达上限，但正式文档写入、资源登记与 History 继续走现有 owner，不变成缺失正常能力的永久绕路。

接口变更同批更新：实际注册 schema → 工具投影/描述 → 人端与两 AI 消费者 → 结果/保存/运行 → 共用操作指南。可生成的事实只维护一份，方法文字不从字段 schema 机械生成。按用例迁移，不先改完全部 83 个工具或新建 dispatcher、万能 Prepared 平台。

**最低验收：** 普通意图完成一次原本需要内部参数的操作；伪造平台执行字段不能改变宿主事实；该用例所有必要入口得到相同语义结果并保留合法差异；自写后继续不要求模型搬新身份；原低层输入/重复准备已退出。所用 compiler、目标/资源 owner 和正式事务必须是真实实现，外部模型可 stub。

### 10.4 MTH-02：可执行边界与只减不增的存量例外

**归入 NI-08/S5，随对应 NI-01–07 迁移交付；`scripts/check-g20-import-boundaries.ts` 的唯一实体 writer 继续为 I-core，Root-config 写其他验证配置/工作流并接入该检查，不同时编辑该脚本。**

扩展现有 AST/import 检查，约束已明确的领域公开端口、正式 writer、资源内部写入及工具事实来源；检查规则按实际退出路径定义，包含相关别名/re-export 绕路。不能以“文件已 import owner”证明调用可达；用生产入口行为补足。无静态可解析边的动态注入需要有限接线测试/独立 review，不假装静态扫描覆盖任意运行代码。

对当前确认存量采用精确例外集合：规则、实际违规边/目标、原原因与对应关闭用例。优先扩展既有适用规则文件或小型测试 fixture；不复制 legacy 台账或开发永久能力登记平台。基线来自可信版本而非每次候选自动接受，比较新增具体例外，不只比较数量；一项消失后从允许集撤销，不能用另一项等量违规替换。新增/扩大例外必须作为规则变更显式评审，不得 broad glob、忽略整个目录或自动刷新基线。

这些例外只允许相关旧问题在迁移中被准确识别，不免除 §9 的清理义务。已知用户错写/损坏不能作为“旧行为”接受；既有无关类型/fixture 红债单列，不用它们证明全局绿，也不让它们触发无关重构。

**最低验收：** 在隔离检查样例中重新引入一条已退出旁路，检查实际失败；合法适配仍通过；删除后再次引入同一违规被发现；新增一项并删除另一项不能躲过集合比较。消费者断线即使保留 unused import，行为检查仍失败。反例只用于检查器测试，不污染正式产品代码。

### 10.5 MTH-03：独立于新实现的行为基线

**归入 NI-08，基线在各能力危险改动前就绪，随该 NI 关闭，不等待全部基线一次建完。**

基线取当前有效正向行为，加有证据且 Owner 未取消的 V9 正常能力；不能只用已经退化的 V10 现状作分母。每项在现有测试/样本中给出用户操作、应保留的结果和依据位置，关联本轮领域覆盖即可，不新建产品能力数据库。旧证据不足时做能判明原承诺的最便宜定位；缺证据列待补，不自行删出范围，也不宣称所有历史能力都已恢复。

V9 是隔离的行为参照，不恢复生产 V9 schema/兼容 writer。相同用户行为可用两版各自 fixture/适配器验证；语义比较不依赖随机 ID、revision 数值或全部归档字节相同。已知旧错误与 Owner 已批准改变的行为不作为黄金答案；改变行为须列出实际差异和决定来源。

先迁测试载体再验证原业务断言。fixture 无法装载、业务实际失败、业务已通过三态分开；调整新格式适配不得同时悄悄删除预期。所有正确断言的删除、skip/only/exclude、视觉基线更新、容忍度放宽和过滤规则变动进入 MTH-04 的保护范围。等价测试重写允许，但由独立者核对原行为仍覆盖，不按文本 hash 永久锁死测试实现。

| 长期行为性质 | 初始必要题目 |
|---|---|
| 局部性与目标连续性 | 两处相同文字、开卡后前插、排队前序改动、自写后续改；保未选内容和人工几何 |
| 可逆性与持久一致性 | 文字/图形/专业字段修改→Undo/Redo→保存重开；比较内容/资源语义，revision 仍按正式机制递增 |
| 非静默损失 | SVG/Canvas 等不能变成标签文字或空内容后返回 applied；受限承载保原输入并诊断 |
| 恢复不重放 | 原 Ready/计算成果继续读取应用；pending/unknown 查询原操作，停止后不继续提交 |
| 真实运行和视图一致性 | 受影响的 GJS/HTML 编辑、Flow/Slide/Spatial、运行/播放/正常出口保同一修改与互动；只取必要代表组合 |
| 长程约束连续性 | 早期短禁止项、用户更新、长结果尾部、多次压缩和跨轮续作不丢有效决定、不重做已提交动作 |

补有限、可重放的操作序列测试；先用现有 Vitest/可控调度，确有收益再评估属性测试库，不为本节默认增依赖。参考状态模型只表达简单性质，不复制一套产品算法。保存失败序列/种子，缩减为最小反例；不设置无界随机运行或每次完整表面矩阵。

**最低验收：** 至少一条有可靠 V9 依据的行为在当前 V10 入口成立；一个已知失败反例先能检出再被修复；相关序列可稳定重放；fixture 迁移保留原断言。GUI、像素、资源、保存和运行各用对应证据，截图相似不能代替可编辑与撤销。

### 10.6 MTH-04：实现权与验收标准修改权分开

**归入 NI-08 的首波基础叶；本轮只规划，不实际调整 GitHub 规则、权限或凭据。**

首先只读确认仓库远端、保护规则、现有 CI 状态源及执行者权限。选择平台实际支持的受保护分支/必要状态/独立审查方式，管理凭据由实施者以外的主体保管；实施者不能既改产品又直接删除保护、改必需状态或自行签准。CODEOWNERS/本地 hook 单独不构成硬保证；共享管理员凭据的不同 Agent 会话仅是独立判断，不是权限隔离。

受保护对象至少含：验证工作流与范围选择、结果汇总器、架构规则/例外、行为测试及关键 fixture/预期、截图基线/阈值、控制这些入口的脚本配置，以及保护规则本身。正常补测和等价迁移不逐条交 Owner；独立技术 reviewer 评审保护范围变化，产品能力取消/降级、扩大权限和新费用仍由 Owner 决定。规则修改可以与实现同一提案，但未经独立确认不能用新弱化规则验收该实现。

可信校验入口从受保护基线/经独立批准的策略取得验证义务，计算候选实际变化；不能只运行候选自行提供的选择器然后相信其退出码。以真实运行报告核对必需检查是否执行、结果是否属于被测组合候选、所需产物是否更新、是否存在 skip/零匹配/缺失报告。明确不适用可以通过，但必须由可信范围规则决定；选中受保护行为却未执行不得用 `--passWithNoTests` 或空 inputs 成功代替。

候选源码和测试在无管理凭据的隔离作业执行；可信规则与状态发布不得把管理员 token 交给候选代码。不在有仓库写密钥的高权限事件路径直接执行未信任候选。这里保护的是既有团队开发边界，不声称能从任意恶意代码中形式证明架构或语义无误。

集成候选验证实际组合后的代码及相应构建身份，而非只验各分支 head；base 改变后按受影响闭包更新证据。源码/制品标识或 hash 仅证明被测对象身份，不证明行为正确。Windows/Electron 必需的验证不能以 Linux 无 GUI 测试代签；复用既有适合运行环境，不将每个改字升级为多系统安装矩阵。

若外部权限/平台条件暂不满足，完成本地检查器与独立 review 的代码候选、明确列出未具备远端强制保护；不能宣称不可绕过。其他非重叠开发可继续，涉及保护标准变化的合入及相应结构候选沿既有独立签准处理，不自动扩大写权限或采购。

**最低验收：** ①删除或 skip 一条应执行的保护用例，可信检查拒绝；②修改 selector/例外/截图阈值不能自行把自身改动洗绿；③错误候选身份、缺报告或必需检查零执行均拒绝；④纯文档和确无影响路径可据可信规则标不适用；⑤权限落实后实际证明开发角色不能直推/绕过对应必需规则。只读规则记录不是第⑤项的动态证明。

### 10.7 MTH-05：Skill 重构为方法、操作指南和可执行能力

**NI-06/MECH-10 的范围由“删除旧说明”扩为真实知识职责重组；与各 NI 的能力迁移同批更新，不改造为强制工作流引擎。**

| 职责 | 权威载体与内容 | 不能承担 |
|---|---|---|
| 任务方法/创作 Skill | 六方法中属于教学、局部修订、研究、数据分析的目标分解、取舍、质量判断 | 内部身份、资源拼接、版本维护、固定软件接力；简单改字不必加载完整创作方法 |
| 共用软件操作指南 | 拟在现有 Skill 资源树形成独立共享参考入口；机械可生成事实来自当前能力定义，人工说明解释操作语义/适用边界 | 第二份 schema/工具目录；不写未实现工具，不要求每轮读全量说明 |
| 软件可执行能力 | 原领域命令、Gateway、资源/文件/作业服务及 DocumentSession | 不依赖读对某份 Skill 才能保证目标、权限、History、资源与保存正确 |

拟用共享位置如 `.agents/skills/workbench-usage/`（名称为实现候选，不是本轮已存在能力）承载按主题参考：当前选择与局部编辑、来源/成果、文件与保存交付、运行与观察、工具发现与当前可用性。是否注册为一个 discoverable Skill，沿现有加载器决定；不再增加每次任务的前置 load。保持 AGENTS 已指向的六个入口名称可达，优先通过其薄入口/参考重组实现，无需本轮修改 AGENTS；这不是恢复内部旧格式兼容层。

| 当前入口 | 拟迁移结果与保留义务 |
|---|---|
| orchestrate-courseware | 保留教学设计/质量/互动方法和已批准策划、框架行为；project-files、资源使用、保存等软件指南移至共用参考，不让它成为其他任务使用软件的入口 |
| edit-content | 保留局部修订方法与未选内容保留原则；按任务直接使用高频能力，操作说明从共用参考读取，不依赖教学创作目录 |
| build-courseware-project | 保留纯外来 HTML 导入的可达入口与保真/诊断边界，归入软件用法；不把新课创作或已有工程修改再绑到整课导入 |
| research-and-report | 保留证据/引用/推断和研究方法；网页材料续取、来源版本和保存等共用用法不再另维护一套机械序列 |
| data-and-report | 保留字段/单位/方法/结论质量；成果身份和交付接续由已实现 jobs/artifact owner 承担；用户选择哪些输出仍保留 |
| office-content | 只调整共用发现/指南和已有能力说明，退出失效 tools.load；既有 Office 用法保全，不启动 §9.3 暂缓的后续能力 |

辅助脚本按职责分：计算/内容转换/候选制作可以留在 Skill；触及正式文档身份、事务、资源和保存必须调用现有能力，不在脚本再建 writer。把内部簿记从正文搬到 references 或 scripts 不算完成迁移。

迁移沿实际分发链：源 Skill/参考/脚本 → 打包与安装源 → 发现元数据/方法映射 → 内置 skills.list/read、外部客户端和独立 T 的实际入口。优先核现有 Bundled/Scoped Skill 服务、courseAgentMethodSkills、生成能力索引及 `scripts/install-courseware-skills.ps1` 的真实消费者，再指定精确 writer；不能只改 `.agents` 文件后认为用户已加载新版本。安装验证用隔离目的地，保全用户自定义 Skill/全局配置；确需调整注册名时同步所有引用，不擅自删除入口。

**最低验收：** 不加载教学创作 Skill 的短选区编辑仍正确；教学创作、资料报告和 CSV 报告共用相同软件操作来源；一次接口变化不必重写三份方法正文；发现/读取返回实际新内容且引用可达；不再要求模型维护内部平台事实。内容质量可以受方法加载影响，基础执行正确性不能受影响。自动化仅验证事实一致/引用可达，方法是否清楚由有限独立 review 判断。

### 10.8 MTH-06：验证选择、真实边界和组合候选

**NI-08 全程执行；不是在每次产品工具调用中增加验证环节。**

采用“小型固定关键行为基线＋受影响领域/消费者检查＋本次失败反例”。固定基线服务代码集成，不让每次纯文档修改启动产品测试；领域测试按真实依赖和入口映射选择，不能只靠静态 related 推断 IPC/动态注册/GJS/生成资源等关系。共用合同改变必须展开必要消费者，缺映射不能默认为无影响。允许复用同一未变候选的有效证据，不因换 reviewer 重跑。

`1–3 条检查`只指组织方式，不是最多保护三项行为，也不是实施者可以删掉固定基线的额度。保留行为和足够反例决定实际内容；昂贵 GUI、模型、格式和安装验证仅在相关属性需要时进行。便宜固定集应小而稳定，不以持续堆案例扩成全产品矩阵。

用受控 provider 代替外部模型时，生产 PayloadCompiler/输入 ACK、目标映射、Gateway/Session、实际作业身份校验和交付 consumer 中正在验证的部分不能被 mock 掉。验证 F01 的测试必须穿过生产首次装配，验证 F09 必须穿过实际 ComputeJobService 身份检查；图形/格式需要真实相关消费者。属性/序列题补广度，真实 GUI 题证明入口可达，两者互不替签。

对新加的硬机制做有限负向自检：一个违规依赖、一个被移除的必要消费者、一个漏执行用例、一个保留错误旧目标的时序，分别能被对应检查抓住即可，不建设全仓 mutation-testing 平台。已知失败与预期需要变更的行为分列；不把旧错误录成应通过的黄金行为，不因 known-red 状态而宣布该能力完成。

**最低验收：** 受影响选择覆盖共同调用链和动态接线；故意绕过真实失效边界的测试不能替代必需题；集成结果报告能区分通过、不适用、缺执行、失败与未验证；首次失败、续作和新完整创作仍分列。

### 10.9 纳入八个 NI 包的实施顺序与唯一 writer

MTH 是同一 NI 计划内的横切交付索引，不建第二任务板、执行引擎或六支独立治理团队。机器字段置于 `WORK_PACKAGES.followup.report_integration_20261008.methodology`，各 NI 只引用相应机制及其叶依赖。

| 时点 | 机制与实际产品工作如何结合 | 不必等待的事项 |
|---|---|---|
| 恢复实施后的首个小切片 | NI-08 先保全可信规则/行为来源，接一个现有边界检查与漏执行反例；同时为 NI-01/02/04 的真实失效建立题目，NI-06 开始共用指南结构 | 不等全仓基线、全部工具迁移、全部 Skill 文稿或远端管理员操作后才写安全候选 |
| 每个能力切片实施时 | MTH-01 的意图/准备、MTH-02 的边界、MTH-03 的行为题、MTH-05 的操作说明与该 NI 同批迁移；MTH-06 核对全部必要消费者 | 稳定小合同即放行后继，不造全量 Prepared 层或长阶段门 |
| 候选合入时 | MTH-04 的独立规则修改权、真实检查结果和相关 MTH-06 组合验证生效；旧规则退出后撤销对应例外 | 不重跑未变作品/费用/全格式矩阵；未具备远端保护时不能冒充已强制保护 |
| 本轮收口及以后新增能力 | 每项 NI 留下唯一实现、有效行为与防重入检查；NI-08 报剩余基线/权限/真实验证缺口，新能力沿同一合同增量进入 | 不再周期性全仓重审已未变部分，不以本轮架构闭合宣称永无设计错误 |

| NI 包 | 本轮必须随能力完成的机制 |
|---|---|
| NI-01 | MTH-01 目标/正文；MTH-02 旧目标/旁路；MTH-03 开卡/队列/富文本/表格/Undo；MTH-05 精确编辑指南；MTH-06 生产 compiler/GUI 组合 |
| NI-02 | MTH-01 资源/作业事实；MTH-02 端内拼接退出；MTH-03 Ready/计算恢复/只读与停止；MTH-05 共用成果指南；MTH-06 真作业 owner |
| NI-03 | MTH-01 每领域意图；MTH-02 专业/布局/复制旧规则退出；MTH-03 原人端行为；MTH-05 共用操作说明；MTH-06 全体必要适配 |
| NI-04 | MTH-01 源码摄取；MTH-02 双解析/装配旁路；MTH-03 模块/资源/保存运行；MTH-05 源码指南；MTH-06 真编译消费 |
| NI-05 | MTH-03 长程决策/多次压缩；MTH-06 真实历史投影/覆盖水位；MTH-01 宿主事实与语义笔记边界；相关指南随实际能力更新 |
| NI-06 | MTH-05 六入口实质解耦与分发；MTH-01/02 同源工具事实；MTH-03 不加载创作也可短编辑；MTH-06 搜索/发现真实状态 |
| NI-07 | MTH-01 宿主执行与任务意图；MTH-02 第二 writer/循环旁路；MTH-03 steering/子任务取消/保稿；MTH-05 共用用法；MTH-06 实际进程/权限 |
| NI-08 | MTH-02/03/04/06 基础机制与聚合证明；追踪各包 MTH-01/05 是否实际闭合，不代替领域 owner |

共享 `ToolRegistration/ToolTargets/DocumentToolGateway` 由 I-core；Engine/ExecutionDesktopService/MCP 由 G-agent；HostToolServices 由 A-realm；领域 planner/正文/Flow/源码/交付沿原 owner。检查语义与测试题由相关 owner/T 提供，`check-g20-import-boundaries.ts` 实体继续由 I-core 写；其他验证脚本、工作流、package/生成输出由 Root-config 或实际指定唯一 writer 顺序合入。Skill 源/引用/分发脚本在 NI-06 派发时明确一个 writer；未派发不产生锁。独立 reviewer 不参与所审候选实现，不能借“机制自测”替代独立评审。

### 10.10 完成标准、权限缺口与防止机制过度生长

本节六项均为 **planned / not implemented**。文档一致性检查不是代码通过、CI 已启用、远端权限已保护或独立 review 通过。实际实施记录沿原任务卡/结果，不另建一套长期状态机。

本轮机制完成须证明：正常意图足够且内部事实来自软件；必要消费者实际同源、旧决定退出；存量例外按真实集合收缩且防新增有效；有证据的旧正常行为由当前入口保留；创作方法不再充当软件使用的唯一入口；受保护验证能识别漏测/弱化/错误候选身份。远端强制保护、GUI/真实模型验收若尚未落实，分别列未完成，不能以本地 PASS 填平。

约束只放在与已知风险对应的接口、开发检查和合入边界，不加入每次用户改字的审批、截图、二次 LLM 审核或完成 checklist。只读、未配置、已由软件承担、待迁移与真实未验证分别处理。不重写成熟前端，不升级 V11，不建第二作者模型/writer/History、万能能力平台、知识图谱、递归监督体系或评分委员会。

恢复实施后，受保护路径只在改变验收义务/规则、扩大例外或缩减能力时需要独立裁决；符合既定规则的正常实现自动走原流程。外部权限配置未具备不阻断无关安全叶，也不把“团队规范”说成不可绕过的技术保证。Office 后续开发继续仅按 §9.3 暂缓，现有 Office 能力及公共迁移必要适配保全。

**每个能力交付留下：唯一领域实现＋受保护的用户行为＋相关旧旁路防再引入检查。** 复用现有有效检查；仅本片实际退出旧旁路时补最小防重入反例，无相关旁路则说明不适用依据，不强造新门。V9/当前保留行为按相关变化选择，既有有效证据复用，不要求每包重新寻找或重跑版本对照。这是 §9 的完成条件，不是先完成全部治理才能恢复普通操作的全局前置。
