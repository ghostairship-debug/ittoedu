# 普通包收口证据摘录

整理 cut：integration `867f9407`（`867f` 同时匹配 blob，本文采用明确 commit）。用途是供 Root 编写 IMPLEMENTATION_RESULT，不是新 review、全量 audit、测试矩阵或 Owner 接受。只读现源码/提交、执行包、R-S/R-A 原报告及 E 已有日志；本次未跑命令验证、构建、模型或 GUI，未改 main/产品/测试。TE04–TE06 是整理者自己的实施域，只摘录独立 T/E，完全不自审。

下面“绿”只指精确已执行属性。旧绿在相关实现/依赖/验证定义未变时复用；后续真正相关的接线变化不能仅凭提交数量变成行为绿。原38包为结果分组；50/131/641/20是来源、候选与保留记录，不相加作为缺陷数。发行仍暂停。

## 可引用的执行证据

日志均在 `D:/果铃并行/20261007-content-revision/e/output/`。E 已确认以下文件/用例映射；失败报告未列出的绿色文件不能仅凭总 passed 数反推，本文使用 E 的实际命令映射。

| 代号 | cut / 原日志 | 本文引用的实际绿属性 |
|---|---|---|
| E1 | `c234c618` / `e-focused-c234c618.txt`，18 files/31 cases，26 pass/5 fail，无skip | T02 automaticCapabilities 2；T04 residentSessionContinuity 1；T05 takeoverRepair 2、browserFileHandoff 2；T08 measurementRecovery 2、exportLiveness 2、publishedAssetUse 2；T03 propertyInputRecovery 3；T10 unknownJournalScope 1、historyResourceOwnership 1；T11 currentFormatValidation 1。这里列绿不把同批红抹掉。 |
| E2 | `c2dbcd1f` / `e-repair-c2dbcd1f.txt` | T03 storeVisibleDraftSave 1、propertyInputRecovery 3；T06 officeBinaryRollback 1；T09 publicMaterialDelivery 3。该次 advancedVisibleDraft 尚2红、selectedLessonMaterialInput红，后续结果另列。 |
| E3 | `d50653cf` / `e-focus-d506.txt`，12 files/29 cases，22 pass/7 fail | T03 advancedVisibleDraft 6；T09 selectedLessonMaterialInput 1；T08 nativeCaptureReadiness 2、currentSourceDeliveryFacts 4；T10 unknownJournalScope 1。imageCurrentV10Target 当时 import error/0 executed，不能计通过。 |
| E4 | `434a148f` / `e-repair-434.txt` | T01 boundCapabilitiesAndBasis 8；T09 imageCurrentV10Target 1；T08 alphaTextRoundTrip 1、sourceResourceConsumer 1。currentDraftCopy、cancelledClose、officePublic、composite 当时红，后续另列。 |
| E5 | `6afdf5ec` / `e-diagnostic-6afd.txt` | T03 currentDraftCopy 1 绿；T04 cancelledClose、T06 officePublic 当时各1红。`e-contract-generation-6afd.txt` 实际生成5个合同制品；后续 `fdd03169` / `5c64ca0d` 已跟踪 V10/V3/API5 manifest 和 schemas，未据生成日志宣称 runtime 全通过。 |
| E6 | `e6cc60d9` / `e-closure-e6cc.txt` | T06 officePublicEngineReview 1、T02 librarySelectionJoin 1 绿；composite/taskFinish 当时红。`e-skills-e6cc.txt` 两次聚焦命令：g20EnabledSkillRoots 1绿；g20ScopedSkills 3匹配绿、3被标题过滤排除，不作为6全绿。 |
| E7 | `0b016835` tree / `e-final-0b016.txt`，7 files/11 cases，9 pass/2 fail，无skip | T01 richBoundContent 3、T04 cancelledCloseContinuation 1、T03 headlessFileReconcile 1、slideCompositionColdRecovery 1、T09 computeUsableOutput 1、compositeImageContinuation 2 绿；仅T10 finish2红。T09 composite 在 `e-resume-a4f.txt` 已2绿，E7是相关组合复验，不泛化为供应商生图验证。 |
| E8 | `867f9407` tree（E merge `2588701f`） / `e-finish-867f.txt` | T10 taskFinishRecovery 2绿：从真实 finish 前 checkpoint/非终态事件前缀冷恢复，已提交正文一次、保另一真实 unknown 写，不重放业务动作。与E7的9绿分开引用，不写成“一次11全绿”。 |

构建只据原输出：`0b016835` 的 component-source 20项生成、Player build、Renderer build 成功；`e-build-0b016-electron.txt` 有6处实际类型诊断，不能宣称全部构建通过。I/H 已交相应窄修复候选，但不以提交代替后续 build 结果。

真实模型 `e-live-a4f.txt` / `content-revision/live-representative/evidence.json`：TeamoRouter `https://api.teamorouter.com/v1`，请求 `deepseek-v4-flash`，返回 `deepseek-v4-flash-ga-260731`；run completed、有 applied text.replace/History 1，但 `validationFailure=Existing formula identity must survive` 且 `accountBilling=unknown`。这只证明该代表调用与回执发生，不能记V4.1 Flash、公式保真或能力验收通过。后续已修标准 V4.1 路由/原文传递不等于新供应商实测。

## TE01–TE10

| 包 | 当前实际实现与已绿属性 | 剩余范围/条件 |
|---|---|---|
| TE01 | Developer/ComponentSource 注册当前稿准备与原始输入恢复；源码保存与运行诊断分开，未完成JSON/IME保原文、恢复不自动提交。E3 advancedVisibleDraft 6绿覆盖不点Apply准备源码/对象JSON→保存冷开、源码字符串无语法保存门、晚到恢复、no-op无History。 | 真实窗口中新文件名/缺入口/源码与JSON一起Ctrl+S→正常退出→冷开呈现，未由Vitest替代；实际运行成功另证。 |
| TE02 | numeric raw输入不转0；Buffered/Structured/Chart 自然提交与保存收集，恢复epoch及IME须真实继续输入。E1/E2 propertyInputRecovery 3绿证明原始数值/恢复属性；相关有效高级稿收集由E3覆盖其实际测试输入。 | 图表与属性在真实GUI同次保存、半截数值/IME正常关闭重进仍需窗口动作；不能由近层反例声称所有专业表单均验收。 |
| TE03 | App/Store/Bridge/DocumentHost 同一 current-draft collector，保存固定有效版本；正常退出保未完高级稿及Canvas原字符/spot，不另建History。E2 storeVisibleDraftSave 1；E7 Canvas composition冷Main恢复1（真实continued input才提交）；E7 headless file.observe/reconcile→save 1含stale CAS/Stop。 | 最近层Main冷恢复不是冷启动真实GUI视觉；已准备的 Electron Golden/Canvas spec 未见本摘录认领的成功输出。 |
| TE04 | **仅摘独立证据**：Office原格式before blob/after真实file token在既有ChangeReview登记与CAS回退。E2真实DOCX rollback1；E6公共Gateway/Engine默认目录Office edit→saved→review→rollback及later human conflict1绿。 | 未宣称任意Office对象支持；DOCX绿不等于XLSX/PPTX三格式实际关联Office打开、所有公式/图片版式验收。系统Office人工编辑栈归其原应用。 |
| TE05 | **仅摘独立证据**：默认disk/current显式选择、当前稿准备不保存源；File owner复制canonical snapshot，资源逐项处理。E5 currentDraftCopy1绿证明目标为新V10稿、源磁盘仍旧稿、源dirty/History未清且可undo。 | 真正未blur的GUI输入复制、副本附件可用、同名失败/资源重试的窗口动作还未给实际GUI结果。 |
| TE06 | **仅摘独立证据**：Host采用实际课例selected fragments、版本检查/刷新，Assistant一次submit冻结materials，Main/Compiler绑定真实来源且保附件共存。E3 selectedLessonMaterialInput1绿证明只冻结所选DOCX段落、真实出处、无虚构页或模型目标ID。 | 该绿是源owner/冻结近层；实际材料checkbox→Assistant UI→模型payload、切课例/版本更新/取消选择的组合UI动作仍需直接证据。后续Main初始材料输入接线提交不自行算新绿。 |
| TE07 | Skill扩研究/数据方法，中文路径可发现、reference按实际单文件版本，不隐撤同任务核心工具。E1 automaticCapabilities2及E6 roots1/scoped3聚焦绿；过滤排除3不计。 | 所有外部CLI安装/具体动态Skill兼容未实测，Skill可发现不等于媒体服务已配置。 |
| TE08 | 图片时间线卡/Main目标升级V10；异步前捕获真实选中目标，保frame/effects/资源事务。E4 imageCurrentV10Target1绿覆盖ready image更换目标、邻选择变化、undo/redo/save/cold reopen且不再生图；E7 composite2绿覆盖图表更新或表转图+解释+图像中断后只补缺插入。 | 时间线真实ready卡点击、实际图像显示/教师布局接受未证；ready fixture不证明GPT OAuth连接/计费/真实生图。 |
| TE09 | 第13导航按钮人工限制删除；七种正式presentation状态通过V10 surface.presentation.set计划，身份由软件维护。已有提交及源码接线；本文引用的E日志没有独立命名第13按钮/presentation完整case。 | 不把源代码/广泛T02绿当第13按钮、初始/缩略图/覆盖、undo/save/reopen及真实播放通过；这些具体UI/状态属性仍需现有T/E明确证据。 |
| TE10 | 冻结多选roots共同提炼资产，现catalog owner导入/插入/更新/删除和dependency closure，replacement保正式身份绑定。E6 librarySelectionJoin1绿：公工具读冻结多选→真实managed library→插入/更新/删除→冷重开保内容、frame及resources。 | 实际多选提炼UI的所见范围、库与工程实例归属提示及作品显示仍是GUI/Owner验收。 |

## S01–S10、OPT01/OPT02

| 包 | 当前实际实现与已绿属性 | 剩余范围/条件 |
|---|---|---|
| S01 | packaged --mcp-connect/PowerShell helper→现headless Main/ready parser与HTTP客户端；builder已接资源分发；工程launcher按需准备，不要求教师Node/tsx/手抄票据。 | 没有真实已装或便携产品“无源码/Node→ready→HTTP”成功记录，不能从Main参数或分发清单称安装版一句话自连完成；不发布来造证明。 |
| S02 | 同profile现context/DocumentHost升格GUI；SDK DELETE detach不停owner；单文档lease Stop保另一文档与client，取消关闭可重新观察取新授权。E1 resident1、E7 cancelledClose1绿。 | 真同PID/Registry/dirty工程后台→GUI→隐藏/显式退出drain动作未有Electron结果；浏览器随机partition不承诺重启登录。 |
| S03 | 冻结web task authority进入具体DOM动作观察grant，同params/snapshot/effect再次消费；已授权准备不逐次ask，未知最终结果保提问。结构补审见R-A4。 | Electron真实提交/下载/上传/显示同页spec已有但未在Vitest绿中执行；不能由mock backend或grants解析推全部网页授权行为已通过。 |
| S04 | 同task WebContents takeover/resume；失败会恢复实际backend human control；上传冻结File owner授权字节、scratch副本，Stop/unknown不重放。E1 takeover2、upload authorization2绿。 | injected backend/File-owner合同绿不是真实窗口键鼠/登录与外部同页接管；实际producer接线结构已补，最终Electron动作未证。 |
| S05 | OfficeContent/OfficeFile/File owner经公共注册内外一致，模型交语义、软件OOXML/CAS/原格式review。E6 public Office Engine1绿，E2 DOCX binary1仅其范围。 | 不承诺任意图表/数组共享公式/图片版式；真实系统Office三样打开缺证。 |
| S06 | Compute授权资料和实际work/output归旧job owner；缺辅助输出保可用CSV与诊断；artifact.save公共注册归真实File owner。E1/E7 computeUsableOutput1绿；E7组合续跑2证明ready资源软件续接，非生图供应商证明。 | WSL/Podman/固定镜像真实运行未探测/验收，测试用可控backend不能称环境就绪；搜索/音视频音乐未配置则准确未配置，不能新增收费路线。artifact GUI交付/真实生图另证。 |
| S07 | 共用资料manifest/immutable attachment owner、真实selected content；公开PDF/DOCX响应先保原件→提取器→同material read；坏图局部gap不拒正文；取消缓存/晚提取。E2 publicMaterialDelivery3绿（PDF/DOCX/取消），E3 selected1绿。 | PDF真实页图与DOCX段落/无虚构页仅限该fixture；PPTX嵌图、实际视觉payload/模型理解和所有教材来源未因此通过；资料read-only不扩写授权。 |
| S08 | 当前HTML Source Session共用observe/act；版本/身份宿主管理、按需worker；派发后结果不明保html-action-outcome-unknown，先observe不重放。源码与结构已接。 | 真实截图/DOM交互、密码/文件控件范围、late action unknown实际服务用例及后台GUI承载尚无本文认领绿输出。截图也不等于教学质量。 |
| S09 | export六格式公共producer→现File writer；进度/取消/晚回复归A05。E1 exportLiveness2绿证原总时限之外有效progress、silent build不能靠旧progress延长、abort精确取消/晚结果忽略。公共PPTX按需worker复用人工converter→V10 archive→正式create/open/save，`7718380f`才按真实receipt报saved。 | 六格式实际可用字节/Office打开、hidden Published capture、PPTX文字图片转换编辑保存冷开Electron spec未有执行绿；冷启动create后ACK前恢复没有配置持久lookup，不能声称自动查证；不静默重导。 |
| S10 | History命令、presentation与冻结多选/library走同owner；软件拿history head/目标/CAS。TE10的E6 library1可复用，T10 resourceOwnership1证明现资源随history/recovery保留。 | 单例History资源绿不等于所有公共undo/redo/state操作已跑；presentation具体检查仍同TE09，不新增管理平台。 |
| OPT01 | 完整可用日志、oversized page规范化、metadata容错、回执压缩facts、精确可行动错误；stopped Gateway清author caches仅留receipt身份，Host工具清runtime不删unknown/正式receipt，element tracker随close/delete释放且公开实际counts。E8 finish恢复2绿；日志data retention在E1/E7 compute1绿；新public oversized page和runtime count属性若无单独日志不得冒称已测。 | resident operations摘要仍有真实最近结果consumer，没有内存/卡顿改善量化；真实backend日志来源仍条件。未知副作用保持，不为了“清零maps”删查证事实。 |
| OPT02 | opaque颜色词形归一、alpha保真、CSS/Flow paint/fixed/refinement局部处理；裸公网域经现publicHTTP parser归一，本地相对路径不塞公网；discovery枚举/版本及Flow仅既有语义保留。E4 alpha archive→实际Player1绿；E1 measurementRecovery2、E3 nativeCaptureReadiness2仅其属性。 | wrapper outline/clip/mask、Flow fixed resize实际Electron视图样本未证；native历史trap未复现同因根因，不可写长期消除；未支持layout语义可按合同反证，不扩大新CSS/OS平台。 |

## O01–O20 处置摘录

这张表区分“实现/已有反证依据/尚有条件”。不把未验证候选自动写成缺陷或完成；Root若已有后续具体probe回执，可替换相应条件行。

| 项 | 当前处置与准确依据 |
|---|---|
| O01 | 已确认 opaque shorthand/rgb便利并在现color owner归一；alpha/var不默丢。相关代码已交，不声称所有颜色控件/Office都支持全部CSS。 |
| O02 | 活跃htmlText alpha分支已保RGBA；E4 alphaTextRoundTrip绿是V10 archive→专业Player，而不是一般hash证明。 |
| O03 | current/disk copy已实施；E5 public current copy绿，GUI未blur与资源组合条件见TE05。 |
| O04 | batch compact contract改为同源子工具schema，仍一文档原子；E4 bound/相关公共能力绿不等于每种batch排列全验。 |
| O05 | 公共file.observe/reconcile接现DocumentHost/Session；E7 headless MCP磁盘/当前稿协调→save、stale CAS/Stop绿，原R-S4 cut缺口已被后续接线与证据关闭。 |
| O06 | Gateway/Host/Engine/cache/element tracker终态释放已实施，留receipt/unknown查证身份；runtimeCounts是实际结构计数接口，尚不能写内存或耗时改善数字，resident最近摘要仍有consumer。 |
| O07 | 本地不再截前100行/每行2000字符，保实际全文、标backend截断；E1/E7 usable compute近层绿，真实backend条件保持。 |
| O08 | limit是期望页数，软件每页最多100、nextCursor继续，工具/service不因较大期望整次拒；`6afdf5ec`及源码已接。public oversized页新反例已提交，不据未列日志假绿。 |
| O09 | wrapper paint predicate/正式scope已扩保outline/clip/mask相关事实；原计划本就未复现实际失真，实际capture→assembly→Player paint样本仍条件，不能由静态predicate称视觉通过。 |
| O10 | Flow viewport fixed与free frame作用域已区分并有代码处理；真实Flow fixed/resize载体显示尚待现样本，不把所有Slide/Spatial fixed定义为缺陷。 |
| O11 | 局部输入解析事实复用在原装配owner收敛，不建全仓hash缓存；只记代码候选/结构结论，不声称量化性能。 |
| O12 | launcher不因file read预要求所有observer/export制品，产品bootstrap复用Main；安装版条件同S01，未新增Node/OS服务。 |
| O13 | current facts/字段错误/冲突/unknown提示已在原消费者改进；机器码与真实身份保护保留，不宣称所有协议异常均已覆盖。 |
| O14 | 零current-consumer spatial helper移除，仍有历史consumer显式历史入口、悬空schema consumer修齐；V10 validator E1绿，旧全仓类型/测试债没有因此清零。 |
| O15 | roadmap/preservation默认为历史诊断、显式历史consumer保留；当前5项contracts实际一次生成且跟踪manifest V10/V3/API5。没有生成后同义--check；Electron构建红仍按真实输出记录。 |
| O16 | 当前Registry.restore对已live同documentId直接返回existing；unbound restore已live会拒，不能由静态restore代码推“同ID新epoch与原活run并存”。可据这些callee保document_evidence_only/反证边界；若另有close后活run实路径需其具体probe，本摘录不假造该复现。 |
| O17 | optional ticket中文/长字符串转内部关联token，read自编号；无害transport不再先拒业务，真正未知payload/目标仍校验。已代码覆盖，不宣称所有CLI metadata形式实测。 |
| O18 | 裸公网域确认可按https归一，已在现parser实现；discovery的enum/semanticVersion/limit/ID保护没有等价性反证，保留。Flow正文content-width/wide/full-width、页面fluid/reading有直接consumer，auto/fit-content没有当前等价持久语义，不能引入新布局能力来“容错”；这两个子域按现合同关闭或条件记录，非统一全放枚举。 |
| O19 | metadata容错归O17；当前object.update/convert的target与project/path仍分别strict、create+expectedVersion仍非公布创建语义、ask_user context非原input。未知/冲突业务字段不能strip。本摘录未找到一致冗余target/path的独立一次parser处置记录，应明确条件/反证依据，不能默计全部candidate完成。 |
| O20 | 现观察owner正常近层准备/释放绿不证明历史native trap长期消除；没有本摘录认领的同因crash重现。保未确认native条件及现生命周期边界，不预拆Main或建OS沙箱。 |

## 交付口径

源码接线与上述近层绿可支持对应 `engineering candidate`，不能统一提升为完整软件、art candidate或accepted。尚无成功日志的实际Electron/安装动作保持未测；可控provider/backend是确定性实现反例，不能冒真实供应商/计算环境。`t01-golden/run-9H6YWf/evidence.json` 本次读到仅初始scope、requests=[]，没有终态/实际写入证据，不能据目录存在写GUI Golden通过。

Root后续只需追加真正新结果或原条件处置，不重跑未变绿证据，也不为本整理创建新的audit/平台/核验门。
