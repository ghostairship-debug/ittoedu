# 教师首发与统一内容协作：实施结果

更新：2026-10-07。Owner 已授权持续实施；发行暂停。本轮38工作包的实施与确认优化、20补充候选处置已收口，随本次实质合并进入 main。工程候选通过相应最小验证及 R0–R4 独立审查；不声明全软件矩阵、art candidate 或 Owner accepted。

## 模型路由更正

开发验证使用 TeamoRouter `https://api.teamorouter.com/v1` 的精确 `deepseek-flash`，沿用 Owner 已确认的 V4.1。`deepseek-v4-flash` 是另一条旧版本路由，不可混写；实时目录只确认确切别名存在，不能按名字是否包含“4.1”猜版本。

Root 首次代表任务错误选择 `deepseek-v4-flash`，4次请求实际返回 `deepseek-v4-flash-ga-260731`。原记录保留为错误路由，不计 V4.1 验证；计费类型 unknown。该任务有真实 applied 回执，但公式身份断言失败，不能记通过。后续原文投影及配对公式分隔符修复、精确工具输出离线回放已绿；离线回放不是新供应商调用。探针、live 脚本和交接已统一回 `deepseek-flash`，正确路由已实测通过：请求 deepseek-flash，实际返回 deepseek-v4-1-flash-260910；1个任务4次请求，History 1，资料数字/链接/公式身份/未选内容及保存冷开均通过，验证脚本 exit=0。计费类型仍 unknown。原证据见 [V4.1](evidence/live-v41-evidence.json)，不外推全模型或图像供应商。

## 基线与最终集成

B0 main=`afc65c9e4d713a9d362768f34e017789fad265ae`；用户已有 archive/开发入口/当前状态与执行包未提交文档，保全且未 reset/clean/stash。产品写域隔离在 `D:/果铃并行/20261007-content-revision`。最终 integration 测试 cut 为 `bf4fb7c1`，最后产品源码 cut 为 `6087a936`；此后仅独立测试变化；包含数值输入实际绑定修复、浏览器原生承载和普通退出生命周期修复。旧绿检查保留其精确源码 cut，不能统称旧批次全绿。E 的 merge cut 单独记录，不能把两个 hash 写成一个提交。

共享文件唯一 writer；Session/Journal/资源域由固定 A 实施后回交 I，G 七文件普通收尾明确交 H。独立 T 全文写测试，E 固定 cut 机械执行，R0–R4 及普通 R 未参与对应候选实施。沿预分配模型与强度，未改全局配置；没有第二 writer、第二工程、通用依赖图、写作 DSL、协调平台或全模型矩阵。

## GPT Pro 补充的收口

已并入原 K02–K07、TE08 与 T01/T09/T10：默认内容目标不关闭工具；普通对话、进度、查询和错误不写正文；纯文本、内联 HTML 富文本、专业数据和源码沿实际表示应用；直接读取数据变化交回模型，明确无关布局保留；表转图、说明、图像生成后嵌入中断只续作未完成部分，保资源和正式回执，显式再生成创建新操作，撤销嵌入不撤销生成或费用。

**快路仍有明确差距：**现简单改写为1次模型请求、`text.replace` 与 `task.finish` 两个模型工具调用、1次 History，无预读/规划/加载或再总结一轮。当前三个 Provider 的作品正文和普通回复共用 `assistant.content`，`stop` 只表示一轮生成结束，没有可靠的作品/对话结果载体。因此不声称满足“零额外工具调用”。未以关键词、隐式写回复、关闭工具或新增 DSL 掩盖。见 [R4](evidence/R4_REVIEW.md)。

## 最小证据

原失败、相关修复和后续结果保留在 [evidence](evidence/)；详细精确文件/命令映射见[普通包摘录](evidence/PACKAGE_CLOSURE_NOTES.md)与[输出摘录](evidence/DELIVERY_EVIDENCE.md)。组内总 passed 不能抹掉失败或证明未选用例。

| 原记录 | 可复用的已绿属性 | 限定 |
|---|---|---|
| `e-focused-c234c618.txt` | 分页/Flow身份、默认能力、resident双客户端、接管/上传合同、资源History/坏日志隔离、按实际资源挂载、导出活性、V10验证 | 同组31例26绿5红，不称全绿/真实窗口 |
| `e-repair-c2dbcd1f.txt` / `e-resource-c2dbcd1f.txt` | 有效稿保存、numeric raw、真实DOCX回退、公开PDF/DOCX提取与取消、资源用途 | 晚到恢复/选集/alpha当时失败，后续另证 |
| `e-focus-d506.txt` | 高级稿6例、教师选集、测量失败保源/取消、native capture时序、当前源码离线sink4例 | 当时有7失败及图片fixture收集错误 |
| `e-repair-434.txt` / `e-diagnostic-6afd.txt` | 实际卡默认能力/直接读依赖8例、V10图片保存冷开、alpha Player DOM、真实source realm、current-copy | 不替代像素或正常退出窗口 |
| `e-closure-e6cc.txt` / `e-skills-e6cc.txt` | 默认Office Engine→真实binary review/rollback/CAS、真实多选资产库生命周期、当前Skill roots | Skill标题过滤的3不匹配不算通过 |
| `e-final-0b016.txt` | 9绿：rich输入/原失败输出回放3、新lease1、公开磁盘协调1、Canvas冷恢复1、全文日志分页1、组合图像续作2 | 同批2个finish fixture红，保留原记录 |
| `e-finish-867f.txt` | 真实finish前checkpoint与相同时点事件前缀冷恢复2绿；正文一次，unknown保留，业务不重放 | 不把人工unknown负向输入称真实硬件故障 |
| `e-presentation-3535.txt` | 三新例绿：原图像丢ACK后只读持久查证；草稿卡关闭释放tracker而打开卡Undo保留；事件磁盘pending时真实Engine正式回执/Stop完成，flush后顺序一次 | 原duplicate红因测试忽略read返回新句柄；`e-presentation-37cf.txt` 已消费真实公开新句柄，七动作/History/保存冷开1例绿 |

构建：ec208f43相关Electron一次构建 exit=0；5b366fc7 数值绑定相关Renderer一次构建 exit=0。`0b016835` Player、20项组件源码生成、Renderer 成功。Electron 首轮6个实际类型错误在原消费者修复，`867f9407` 实际 exit=0，零stdout/stderr已单独记录，不重建无关制品。当前合同一次生成已提交 V10/V3/API5 manifest 和四份 schema；未紧跟同义 --check。

真实窗口的最终证据：

本节60秒为原基线 playwright.config.ts 的测试单例总时限（expect等待10秒），不属于产品任务运行时限；本批未修改该配置或新增产品60秒限制。删的是重复诊断截图，保留原行为断言。

| T / 精确 source cut | 已执行结果 |
|---|---|
| T01 / 1487 | 1绿：实际文字卡按资料改写，可控provider实际工具目录，无预tools.load；链接/公式/未选布局、Undo-Redo、保存正常关闭冷开 |
| T03 / 4dccc104 | 1绿：有效源码真实Ctrl+S并核磁盘85，再输入半JSON/数字raw/Canvas IME；正常保稿关闭及冷开回原target，原文/布局不变，正式源85 |
| T04 / 60c9560f | 1绿：真实headless browser→同Main PID GUI，无viewport且MCP保持连接，普通native退出后进程自然exit0；不是强制清理通过 |
| T05 / ec208f43 | 1绿：实际后台native鼠标/一次POST Teacher+answer、冻结授权、未知动作拒绝、同页接管与恢复 |
| T06 / 37cf5d4e | 1绿：公开PPTX导入消费真实converter/隐藏worker，产生可编辑V10，公共编辑/撤回重做/保存冷开 |
| T07 / ec208f43 | 1绿：真实HTML Source observe/html.click/新鲜Count1/Stop迟到动作禁止；源文writable=[]/History0 |
| T08 导出 / d86dac8d | 1绿：实际PPTX蓝色图片像素/PDF、progress identity/sequence、主动取消、正式文档不变；仅跳过ZIP目录条目 |
| T08 绘制/互动 / bf4fb7c1，产品6087a936 | 1绿48.6秒：真实screen映射像素、pseudo/clip/alpha，原父iframe开闭和实际group→web子互动；model/revision2/undo2不变，真实GUI保存dirty=false |

原失败日志全部保留，不能以这些最终聚焦结果称旧批次全绿。T03最初将未保存源码与fresh文件打开混用：已核物理原文件42，公开保存后才预期85；普通已保存文件创建空History，Journal restore才保原栈，本例不新建跨冷启动Undo。T08已证初期截图坐标漏iframe缩放、后期空children层截真实点击、最后重复诊断截图耗尽60秒；独立T修准确观察及删冗余图，原行为/像素阈值、60秒与retry0均保持，正式修复只在正确Player投影owner一行pointerEvents。

## 全部38工作包

表内“已实现”指隔离源码及直接consumer，不等于所有GUI、外部环境或播放属性通过。

| 包 | 已实现/已绿范围 | 剩余限定 |
|---|---|---|
| K01 | Office/材料/HTML/交付/历史/资产/状态公共注册同业务owner；Office与resident真实链绿 | 公开PPTX导入及HTML Source动作窗口均绿 |
| K02 | 默认目标与适当编辑表示由软件准备；rich输入/链接/公式回放绿 | T01真实选区/资料改写黄金链已绿 |
| K03 | 正式planner保身份、未选内容/人工布局；Table→Chart及组合、资产保存冷开绿 | 不做任意deep-merge |
| K04 | 真实卡工具可达、仅明确正文提交；绑定8例/rich3例绿 | 零额外工具调用未满足，T01真实文字卡窗口已绿 |
| K05 | 固定分页/直接事实、同任务修订、范围冷恢复/回执不重放/磁盘协调绿 | 不跟踪全部浏览；真unknown先查证 |
| K06 | 宿主自动披露核心及已配置精确能力，默认Office/必要参数齐；无tools.load/Skill前置 | 未配置准确unavailable |
| K07 | applied/saved/generated/written/unknown分开结算，纯finish恢复、Office及组合绿 | 简单结束仍显式工具 |
| TE01 | Source/Developer自然生效、晚到恢复、无效原文/IME保留；高级6例绿 | T03真实保存/三raw/正常关闭与文件冷开1例绿 |
| TE02 | numeric原字符不转0、图表自然边界、恢复须继续输入；raw/收稿绿 | 不外推所有表单 |
| TE03 | GUI/tool有效稿收集、Main持久未完输入、Canvas同载体；Store保存/冷Main/续输/磁盘协调绿 | T03真实保存/三raw/正常关闭与文件冷开1例绿 |
| TE04 | Office真实before/after及CAS回退，公共review；DOCX及Engine绿 | 不承诺任意Office对象/系统未保存栈 |
| TE05 | disk/current复制分开，current不存源；保dirty/History行为绿 | 未blur输入完整UI组合未测 |
| TE06 | 真实资料选集版本/冻结进入Main；所选DOCX段落/出处绿 | 完整checkbox UI未测 |
| TE07 | 研究/数据方法、中文目录、单文件版本；读Skill不撤核心能力，roots/scoped聚焦绿 | 不冒充所有CLI安装 |
| TE08 | V10图片卡/异步固定目标/同media事务；图片替换/保存冷开/组合绿 | OAuth真实生图/计费/显示仍条件 |
| TE09 | 13导航按钮任意限制移除；七展示状态操作走正式surface.presentation.set | 公开七动作/撤回重做/保存冷开1例绿，所有Player切换未测 |
| TE10 | 多选提炼与真实库包导入/使用/更新/删除同owner，资源/frame/冷开绿 | UI作品视觉接受归Owner |
| A01 | 分页captured快照、Flow markerless身份/专业数据；原blue→cyan及interaction换ID反例绿含保存冷开 | 局部不支持保源并诊断 |
| A02 | 实测保pseudo/sourceScope/paint/Flow root/fixed；测量失败保程序/取消不提交、alpha绿 | bf4真实像素/iframe滚动后native开闭/嵌套互动1绿；不外推任意resize矩阵 |
| A03 | 提取→预览/Runtime资源用途一致、坏资源保源/修复；用途与offline sink绿 | 非全媒体/公网/离线承诺 |
| A04 | 不等全素材、真实URL按使用取；source不靠bindings，capture等实际fetch/decode/update；native2/source realm1绿 | 真实hidden PPTX/PDF及Player像素已绿，无长期量化 |
| A05 | identity/sequence活性、取消到producer、GUI/hidden worker同port；晚回复不结算 | 真实hidden PPTX/PDF/像素/cancel原单例d86dac8d 1绿 |
| A06 | 内部共享资源字节，公开脱离别名，坏Journal只隔离可证明owner；Undo/Redo/save/cold绿 | 不用hash当正确性门 |
| A07 | 去重复validate/投影复制，实际candidate校验保留；局部/live Flow事实复用 | 不声称全链parse一次/性能幅度 |
| A08 | 非业务有序queue，真实pending/failure可见，Journal仍durable；受控真实Engine/Stop绿 | 不量化生产磁盘延迟 |
| A09 | 公共V10验证、历史consumer边界、当前生成制品已提交；validator绿 | 全仓旧V9红债未清零 |
| S01 | --mcp-connect/随包PowerShell helper/ready，launcher按需准备 | 发行暂停，无安装版无Node实测 |
| S02 | 同profile同Host/Registry升格、detach不停宿主、单文档新lease；resident/A-B授权绿 | T04真实Main同PID后台→GUI/未打开viewport/普通退出整例60c 1绿 |
| S03 | 冻结web范围→真实DOM事实→一次精确grant/consume | ec208f43原真实Engine/后台POST窗口1例绿 |
| S04 | 同页接管/resume、失败还human控制、真实File owner上传字节；合同各2绿 | ec208f43真实WebContents一次POST/同页接管恢复绿 |
| S05 | Office同公共owner，模型语义/软件OOXML/CAS；默认执行/review/rollback绿 | 非Office重写/全对象兼容 |
| S06 | 授权数据桥、可用产物、artifact共同交付；坏辅助保CSV/全文日志/分页绿 | 无Podman/default Ubuntu，不安装；可控非真实后端 |
| S07 | 附件/选集/公开教材同材料owner，PDF/DOCX/取消3及选集绿 | 不虚构页/扩写权，视觉理解另证 |
| S08 | 当前HTML Source共享observe/act，发出后unknown查证、发出前不虚构unknown | ec208f43真实observe/html.click/Stop窗口1例绿，源文writable=[]/History0保留 |
| S09 | 六格式同producer/File writer，PPTX公共入口复用converter→V10/真实保存回执 | 公开PPTX导入窗口已绿；真实hidden导出/PDF/取消/文档保留原单例d86dac8d 1绿；cold ACK无持久lookup，保unknown不重导 |
| S10 | 公共History/资产/展示状态同owner，资源History/资产绿 | 公开七展示状态操作闭环绿，所有播放不外推 |
| OPT01 | 清不可再用maps但留回执/unknown，原job只读lookup、卡tracker自然释放；新三例绿，全文/metadata/行动错误已补 | 不声称内存/耗时测得改善 |
| OPT02 | opaque短色/rgb归一、alpha保留、CSS/Flow范围、裸公网域原parser归一 | 无native历史trap同因结论/无等价别名不自造 |

## 20补充候选与全来源

| 项 | 当前处置与理由 |
|---|---|
| O01/O02 | 专业opaque便利已补、alpha真实Player保留；全面拒CSS颜色推断反证 |
| O03/O04/O05 | current-copy、精确batch广告、公共磁盘协调已补，copy/协调绿 |
| O06/O07/O08 | 原owner清不可再用状态留unknown；全文日志/软件页≤100，实际221行及长末行绿，非累计额度 |
| O09/O10 | 保wrapper paint/正式scope，区分Flow fixed与free frame；bf4真实源网页→Player像素与互动及局部Flow/人工布局保全绿 |
| O11/O12 | 局部/live Flow事实复用、launcher按需准备已实施；不称全部parse一次/安装实测 |
| O13/O14/O15 | 可行动错误、0current-consumer旧叶、历史gate诊断与当前合同生成；不机械清全仓红债 |
| O16 | restore(live)返回existing，unbound live拒；无同ID新epoch并存consumer，document_evidence_only，不造平台 |
| O17 | optional中文/长ticket转内部关联标识；业务身份和unknown仍保护 |
| O18 | 支持裸域https归一；ID/版本/枚举保留；Flow auto/fit-content无等价持久语义，按现合同关闭 |
| O19 | 无害transport归O17；未找到一致冗余被拒阻正确任务的具体consumer。target/path/binding有实际语义，保strict业务版本/Stop/冲突，不strip未知字段造成功 |
| O20 | native历史trap未确认；正常观察/释放非长期消除证明，保环境条件，不造OS平台 |

50主题/131记录/641来源主张/20补充的完整原位置、判定和工作包映射保留在 COVERAGE.json。实际状态由本38包与候选表承接，不造第二永久台账、不相加为缺陷数。preserve复用正向行为；implement以对应直接consumer/证据为准；candidate_probe有确认、限定反证或真实条件。未测GUI/供应商/安装/后端没有改成通过。

## 独立review与收口

[R0](evidence/R0_REVIEW.md)–[R4](evidence/R4_REVIEW.md)及[R-S](evidence/R_S_REVIEW.md)/[R-S4](evidence/R_S4_REVIEW.md)保留原失败和滚动cut。R4已关闭R2取消关闭lease、R3当前源码离线sink、R4纯finish恢复；A08实际pending反例现绿。R4新增F2：headless升格GUI且未开浏览器viewport时，隐藏BaseWindow阻断window-all-closed，普通退出遗留host。H在原Main退出owner接lifecycle continue/handled意图，仅真实closed才停并flush；R4已审ec208f43无新增静态阻断。T04实际Main PID20176保持至GUI晋升，未开viewport，MCP至普通native退出断言仍连接；启动cmd载体PID19488自然exitCode0/signalnull，行为主体已证。原runner随后已closed app.process getter异常，ffc→60c修仅缓存已有ownedProcess；原整例60c 1绿4秒。历史报告顶部open不当最新状态，作者未自审。

最终 R4 已直接核对产品6087a936 / 测试bf4fb7c1 / E实际merge b7d1fcc3的同次原stdout/exit0、原生.last-run passed、最终facts及真实嵌套截图，所追踪的当前真实阻断均关闭。38包及候选按上述范围交付并合入main；无必要检查或产品writer仍等待。任务卡依工作协议退出active，保留源提交、原失败与最终证据。

条件与明确差距继续保留：发行暂停下不制造安装包实测；Podman/default Ubuntu未配置，不安装；GPT OAuth真实图像连接/模型/执行者/计费未实测；历史native trap及全仓旧类型债未清零；PPTX cold-create-after-ACK无持久查证，保持unknown且不重导；简单改写仍为1请求2工具/1History，未满足零工具建议。以上没有改写成通过，也不阻断无关已交付能力。

最后 Player 修复只在创建 children 几何容器时设 pointerEvents:none；真实 child.outer 原来在 Flow/free 都显式 auto，人工图层、源 HTML、frame、缩放和层序未动。9919实际首命中空DIV/iframe第二/子summary无事件确证截点击；修后父及嵌套点击均由真实mouse完成。6087相关Player/Renderer直接构建各一次exit0，未重跑生成器/Electron。发行继续暂停。