# 教师首发与统一内容协作：实施结果

更新：2026-10-07。Owner 已授权持续实施；发行暂停。本轮38工作包的实施与确认优化、20补充候选处置已随 a8cea6c1 合入 main。后续原 S09 冷 PPTX 创建回执尾项也已完成，随本次实质合并交付，见下文精确源码与测试 cut。工程候选按对应范围最小验证及独立审查交付；不声明全软件矩阵、art candidate 或 Owner accepted。实际协调只见[任务板](../TASK_BOARD.md)。

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
| TE08 | V10图片卡/异步固定目标/同media事务；图片替换/保存冷开/组合绿；10月7日原OAuth当前账号真实生成/参考编辑通过；后续可控 provider 完整 V10 计算/可编辑表图/现有图像/保存冷开/HTML-DOCX/Player 点击全链1例绿 | 真实模型续验另记；实际图片模型/单次费未由供应商披露，不冒全部GUI已验 |
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
| S01 | --mcp-connect/随包PowerShell helper/ready，launcher按需准备；后续 Windows dir 候选已生成，原 helper EOF/前导空白及首次 GUI 显示已窄修，已有 owner 的实际 attached/ready 回执绿 | 无 Node/WSL 新鲜完整候选消费另验，尚未记全链通过 |
| S02 | 同profile同Host/Registry升格、detach不停宿主、单文档新lease；resident/A-B授权绿 | T04真实Main同PID后台→GUI/未打开viewport/普通退出整例60c 1绿 |
| S03 | 冻结web范围→真实DOM事实→一次精确grant/consume | ec208f43原真实Engine/后台POST窗口1例绿 |
| S04 | 同页接管/resume、失败还human控制、真实File owner上传字节；合同各2绿 | ec208f43真实WebContents一次POST/同页接管恢复绿 |
| S05 | Office同公共owner，模型语义/软件OOXML/CAS；默认执行/review/rollback绿 | 非Office重写/全对象兼容 |
| S06 | 授权数据桥、可用产物、artifact共同交付；坏辅助保CSV/全文日志/分页绿；后续工作候选默认随包 Pyodide，真实 CSV/NumPy/pandas/中文图及资源交付最小证据绿 | 不再要求 WSL/Podman；打包后消费另验，不声称完整系统 CPython 兼容 |
| S07 | 附件/选集/公开教材同材料owner，PDF/DOCX/取消3及选集绿 | 不虚构页/扩写权，视觉理解另证 |
| S08 | 当前HTML Source共享observe/act，发出后unknown查证、发出前不虚构unknown | ec208f43真实observe/html.click/Stop窗口1例绿，源文writable=[]/History0保留 |
| S09 | 六格式同producer/File writer，PPTX公共入口复用converter→V10/真实保存回执；原create owner持久因果事实接已有lookup | 公开PPTX导入/hidden导出原绿复用；新增b54cf2e2两例绿，丢ACK冷查证/回执失败保文件。旧记录或create→record真正中断仍unknown、不重导 |
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

主包最终 R4 已直接核对产品6087a936 / 测试bf4fb7c1 / E实际merge b7d1fcc3的同次原stdout/exit0、原生.last-run passed、最终facts及真实嵌套截图，所追踪的当前真实阻断均关闭。38包及候选按上述范围交付并合入main，旧检查不因后续继续指令重跑。S09尾项按下节另记实际变更及最低证据，任务卡依工作协议退出active；保留源提交、原失败与最终证据。

条件与明确差距继续保留：发行暂停，Windows dir 候选已生成，实际无 Node/WSL 入口验收正在收口；本工作候选默认计算已改为随包离线 Pyodide 并有最小运行证据。OAuth真实生成/编辑已复验通过，完整V10创作链仍按实际后续结果记录，实际执行模型/单次费用供应商未披露；历史native trap及全仓旧类型债未清零；PPTX缺创建事实仍保持unknown、不重导；简单改写1请求2工具/1History、零工具建议未满足，本次判断不因数量继续深改。详见下节；不将未测范围改写成通过。

GPT OAuth 后续免费检查当时确认：真实产品 profile 的原 secureStorage/OAuth resolver 可用，沿正式 discover-models 服务两次HTTP200/live，原响应models:[]且parser读取正确；该步骤刷新/生成0。见[目录回执](evidence/oauth-directory-evidence.json)与[响应形状](evidence/oauth-directory-shape-evidence.json)。此目录不能清零历史图像能力；Root此前仅据当前角色为空/目录为空，将真实生成编辑泛称未验证，漏查9月23日原证据，已在下节纠正并完成10月7日真实复验。

最后 Player 修复只在创建 children 几何容器时设 pointerEvents:none；真实 child.outer 原来在 Flow/free 都显式 auto，人工图层、源 HTML、frame、缩放和层序未动。9919实际首命中空DIV/iframe第二/子summary无事件确证截点击；修后父及嵌套点击均由真实mouse完成。6087相关Player/Renderer直接构建各一次exit0，未重跑生成器/Electron。发行继续暂停。

## 后续 S09 冷创建回执收口

源码 `fe503968`，parent 为主包 main `a8cea6c1`；独立 T 原 tests-only 提交 `65f3011e` / `9fcdf306`，隔离 integration/E 最终测试 cut `b54cf2e2`。六文件仅在原 WorkspaceFiles 创建 owner 成功 coordinate 后、成功 ACK 前原子持久紧凑创建事实；Gateway 原 run/op/requestDigest 贯穿既有 import/lookup。回执失败沿既有 unknown 传播，已创建文件保留，不回滚或误报普通未创建。Main 在 converter 前查询原事实，历史查询不读当前目标、不 open/attach，不恢复旧 document/entry 句柄或写权；后来改动或删除目标不会触发重建。没有完成记录则仍为 null/unknown，不猜成功或重做。

独立 T/E 单文件一次执行：**1 file / 2 passed / 0 skipped，exit 0**，原命令、cut、stdout/stderr见[原测试回执](evidence/s09-pptx-cold-ack-b54cf2e2.log)。第一例以实际默认工具目录、Engine/Gateway 创建及真实 executing RunStore 切片模拟 ACK 丢失，Stop 后 fresh Host/Engine 查得历史 saved；converter/create 各一次、原输出一份，后改/删目标不重写，新写仍 run-stopped，Registry/handle/lease 不复活。第二例仅在私有回执 rename 注入 ENOSPC，实际 V10 文件仍可解析且保留，底层与 Agent 层均为 unknown，fresh lookup null，不重建或 open。converter 和 Host service port 是受控 seam；本例不冒充新版真实转换器、Main GUI或真实磁盘耗尽，原 T06 已绿真实 converter/GUI 证据继续复用。

该 Main 活动消费者的唯一直接 Electron 构建 `node scripts/build-electron.mjs` / `fe503968` 已 exit 0，见[原构建回执](evidence/s09-build-electron-fe503968.log)；后续仅 tests-only，不重建 Renderer/Player或重跑生成器。R4按原边界完成设计、六文件实际 diff 与两例定义定向审查，原回执见[报告](evidence/R4_REVIEW.md)。源码、独立测试、结果与证据一起实质合入，用户无关 archive 修改保留，发行继续暂停。

## 10月7日 Owner 后续问题与真实图像复验

**简单改写的技术判断：不为工具数量继续深改。**两次工具在同一次provider回复完成，正文只产生一次History；暂无新增模型轮次或明显性能退化的反例。第一项承担正文提交，第二项明确整个任务结束，保留复杂任务继续与失败续修语义。零工具建议仍未满足，但合并或自动结束需要调整提交/恢复语义；没有可观察收益时，不把这项数量优化当当前可用性或发行阻断。今后若有真实额外轮次或性能问题，再针对实际原因修，不新增当前核验门。

**OAuth历史与本次结果：真实生成/参考编辑通过。**已直接核9月23日generation/edit-status与real-image-document/status、ui-status、real-image-chat-ui/reopen原记录；请求gpt-image-2曾成功生成、编辑并在当时V9正式应用/保存重开，另有透明背景成功。10月7日本次从main8cea17c6源码、当前默认profile、原secureStorage/resolveOAuthCredential和ImageGenerationService复验同账号：生成1次、参考编辑1次，HTTP均200、状态ready，刷新/文字/目录请求0；没有改角色、产品源码或重试。两张1254×1254真实PNG由Root实际查看：蓝色铃铛改橙色，轮廓、位置、白底保留，原图仍可读。[安全原回执](evidence/oauth-live-20261007/evidence.json)、[同次执行日志](evidence/oauth-live-20261007/run-reviewed-probe-main8cea17c6.log)、[生成图](evidence/oauth-live-20261007/generate.png)、[编辑图](evidence/oauth-live-20261007/edit.png)。实际执行者为guoling-direct-chatgpt-images，请求模型gpt-image-2，actualImageModels=null，billing metadata=subscription，单次费用unknown。不据此冒称本轮Main GUI/V10保存重开或完整创作链已运行；后续沿同job/资源复用，不重复生成。

**教师免WSL计算：随包离线Pyodide/WASM 已实现并通过最小运行验证。**Owner已卸载WSL，教师安装WSL不能作为生产前提。I在原 ComputeJobService owner 接薄 backend 与 sandbox 隐藏窗口/module Worker，默认 Main 使用 Pyodide；既有作业、资源和正式 ArtifactDelivery/File writer 保持。随包资产为官方 Pyodide 314.0.7/CPython 3.14.2、NumPy 2.4.6、pandas 3.0.2、Matplotlib 3.10.8 及完整递归依赖，Noto Sans SC Regular OTF 与许可，共61文件39,491,221字节。运行不取 CDN、pip 或 WSL。授权输入进入只读 WORKERFS，成果字节仅交 Main 原 scratch→artifact.save；保 cwd=/job/output、/job/work 别名、GUOLING 环境变量、Stop、迟到结果、ready 复用及冷 pending unknown 不重放。OS子进程与任意未预装原生扩展不在该端承诺内，不声称完整系统 CPython 兼容。

独立 T/E 原中文 CSV 主例 **1匹配/1通过/0跳过、exit0**，实际均值一班90、二班80、总体85；中文 Matplotlib PNG 600×360 已直接查看，真实 CSV/PNG 正式 written。实际输入改写被拒绝且原件不变，Worker 宿主 file/HTTP fetch 均 AbortError，测试服务器0请求，无 Node/preload；fresh Electron 对同 ready 作业 starts=0、不新建窗口或重算。原启动阶段 Stop/冷 pending unknown 最近层与真实 Python exit3 反例各按相关变化执行，不重复全部矩阵。原 file origin 泄露和 SystemExit:0 误判失败记录保留；最终仅 compute 私有 HTTPS origin 映射真实本地 entry/assets/vendor，以 realpath 闭包保资源边界，使用真实 SystemExit.code，不猜错误字符串。所有最终相关构建 exit0，独立 R4 的实际源码/原结果复审已关闭这两项真实缺口。[安全证据](evidence/teacher-compute-live-20261007/)、[独立复审](evidence/teacher-compute-review.md)。

这些新增源码仍是 `162aee26` 上的工作候选：当前环境 `.git` 只读，标准 worktree/clone 已被拒绝，采用明确单 writer 文件域，不伪称已提交或合入。Windows dir 候选已构建；首次运行后台 listener 实际存在，但随包 helper 等待 stdout EOF 未完成回执交接，正在原入口窄修。打包后计算/GUI/自然退出及代表性 V10 全链仍须其实际结果，不能以开发载体计算通过代替。没有新增软件任务累计时限、模型费用、调度平台或全局权限。

**发行准备判断：条件通过后可以进入准备，当前未发行。**先完成免WSL实现及对应最小验证，再做一份代表性V10创作链：材料→实际可编辑作品→所需计算/已配置图片→核心互动→保存冷开→关键导出。相关成功证据可复用；实际候选包仍须无源码/Node/WSL消费新增计算运行时及MCP bootstrap，不能由开发树成功替代。不要求全仓历史V9债或全模型/全组件矩阵清零；真实当前可用性阻断须修。准备/本地候选验收不等于对外发行，发布仍须Owner解除暂停。

## 后续代表性创作与 Windows 候选收尾

本次沿原 S01/S06/K03/K05/K07/TE08 与独立 T06/T10 收口，没有重做方案或增加模型矩阵。实际新缺口在正确 owner 上修复：随包 PowerShell helper 消费首个完整非空 JSON 回执而不等待驻留管道 EOF，仍要求真实 connector exit0/status=ready；GUI exe detached 启动移除隐藏首次窗口的 `windowsHide` 参数；导出草稿准备不再把缺少 GUI projection 当作 Main 正式文档不存在，已有投影草稿 drain 与 Main 身份/版本校验保留。[独立报告](evidence/teacher-compute-review.md)记录原失败、实际窄修和每项已到达的行为。

代表性可控 provider 完整主例 **1/1 passed，14.6秒，0模型请求/0新增生图**，见[稳定原证据](evidence/teacher-creation-controlled-20261007/)。从实际 Main Engine 默认工具读取资料和 CSV，真实离线计算一班90/二班80/总体85，写出中文图与 CSV，再创建 V10 原生可编辑表格/图表、说明/链接/公式、图片与答案互动；复用10月7日已真实生成的铃铛。人工经 Gateway 调整表格列宽260/160、字号20、opacity0.9，完整实例保留。公开保存 revision8/dirty=false，HTML/DOCX written；canonical Undo/Redo 递增到9/10且业务内容恢复，再保存并由新 DocumentHost 冷读工程，revision10/dirty=false。此处不冒称全 GUI Undo/Redo 或完整新 Electron 冷启动。

同例消费真实公开导出的 HTML：独立可见、sandbox、无 Node/preload 的内容浏览器执行真实点击，答案由隐藏变为可见，收到 trusted click/toggle，图片解码和作者工程/History/dirty 保全均通过。Root与独立 reviewer 已实际查看中文计算图及展开答案截图；DOCX 含原生表格、公式与媒体，并保留程序初态静态输出的真实诊断，源码/数据在工程保留。测试曾错误期待 Undo/Redo 版本回退、使用陈旧 Player 制品、在工作台 session 增设非产品消费窗口；原失败全部保留，最终观测只纠正合同/载体，原业务、真实点击及保全断言均到达，未以诊断 MiniProbe 代替通过。

## 10月7日核心体验转向与当前切片

本节承接上文当时的进行状态。Owner 随后要求先只读定位并讨论核心编辑体验，相关产品实施和验证支线已停止；当前窗口仅获准完成开发入口文档瘦身，不运行产品、测试、构建或创作。下一窗口收到[执行提示词](CORE_EXPERIENCE_EXECUTION_PROMPT.md)后按该指令恢复实施；本窗口的暂停不构成对下一窗口的新禁令。发行继续暂停。

真实 V4.1 单次创作请求 `deepseek-flash`，实际返回 `deepseek-v4-1-flash-260910`，原任务102次请求后为 partial；已保存并导出原作品 rev15，计算 CSV、中文图、原生可编辑表图及 DOCX 内容已有实际成果。原[事实与摘要](evidence/teacher-creation-live-20261007/)完整保留，结束循环的候选修复已有聚焦证据，但不能改写原供应商运行结果为 completed。后续零付费复用原作品续验到达冷读与导出消费，仍在真实 Player 点击原生 section 时失败：正式数据保有 collapsedByDefault 与六个 childIds，运行实现缺少对应收展。该问题已并入[核心体验问题](CORE_EXPERIENCE_ISSUES.md)，尚未实施；原失败 HTML 保留，可控主例的独立答案互动通过不替代它。直接消费缺口见[独立复审末节](evidence/teacher-compute-review.md)。

Windows dir 默认入口已实际连接、执行随包计算并交付三项 written 资源。随后的 GUI 工作区续接问题已有窄候选与独立三例；完整 GUI 延续及退出仍缺完成证据，完整安装消费未通过。私有端口、隐藏启动等续验支线已停止，不再表述为“正在续验”；各局部证据及限制见[复审记录](evidence/teacher-compute-review.md)。这些限制不清零已证免 WSL 计算、OAuth 生成/参考编辑及可控全链14.6秒结果，也不把它们扩成完整打包验收。

新增源码仍是 `162aee26` 上的未提交候选，Git 元数据只读；原38包/20候选及 S09 已合入的事实保留。核心文件关闭/保存/History、普通输入与插入/属性、公式、HTML 轻编辑、三表面视口/控制台、整窗放弃与恢复问题尚未修复。完整三路真实首产出质量/耗时比较、Owner 接受、全仓旧类型/测试债及历史 native trap 根因均未宣称完成。新窗口按实际核心旅程推进，不恢复旧全矩阵或把历史条件改绿。
