# 核心体验统一解决方案

更新：2026-10-08。分析基线：`423a96dcceb1cdef16791ecd668e0abe391e2fb1` 及本会话问题记录。本文是本批方案的唯一入口；问题来源保留在 [CORE_EXPERIENCE_ISSUES](CORE_EXPERIENCE_ISSUES.md)，不另建永久缺陷平台。

**本轮只分析、编写方案和校正状态，不启动产品代码、模型调用或发行。** 后续恢复实施时，原 [执行指令](CORE_EXPERIENCE_EXECUTION_PROMPT.md) 的人员、费用、三路创作与最小充分验证约束继续有效；旧的暂缓分类不能排除本方案已纳入的真实问题。

本方案已转为[可执行计划包](../20261008-core-experience-unified/README.md)，该包是下一轮唯一执行入口。本方案继续承载决策依据；最新GPT Pro六项补充已进入对应既有工作包，未新增总架构或永久台账。

## 1. 收敛结论

问题不是缺一个拖拽库，也不是需要再换 V11。共同根因是：正式作者语义在迁移中没有完整贯穿**对象地址、操作准备、事务 ACK、渲染、运行生命周期和保存出口**；共享底座之上仍有重复的入口业务编排。同一能力被不同入口部分接线，导致轻/完整、人工/AI、原 HTML/H5、编辑/Player 结果不同。

选择的方案是：保留 V10/V3/API5 和现有专业算法，以同一对象语义操作连接人工与 AI；复用当前正式事务；以原 HTML 与 H5 两个持久化适配器承载同一个内部编辑核心；各表面保留自己的布局语义，但消费同一几何结果。需要真实职责调整就做，不以最小 diff 为目标，也不建立万能编辑器、全局语义图谱、第二工程或第二 History。

原 9 项及直接补充、React P0、48 条审计记录、4 项新增能力缺口、3 项维护问题均有归属。行为差异按最新 Owner 决定处理，不机械恢复 V9。七批是职责归属与并行单位，不是必须逐批等全绿的阶段门。

## 2. 已确认的结果与边界

| 事项 | 有效决定 |
|---|---|
| 人类布局 | 普通独立对象默认自由拖拽、缩放；不把重排作为默认。富文本、专业组件内部结构和 Flow 阅读顺序保留。 |
| AI 与人工 | 同一个持久对象、同一实际能力与应用器。模型负责内容/意图，软件负责身份、布局转换、资源、事务、撤销和保存。 |
| 轻编辑 | 轻的是界面，不是能力。H5 light/deep 和原 HTML 工作台均纳入，不要求先导入工程才能深编辑。 |
| 锁定 R06 | 所有作者入口，包括属性和 AI，修改锁定对象前需解锁；运行互动与动画不受作者锁影响。 |
| 复制 R05 | 普通复制保留完整作者对象、命名状态、互动及所属依赖；不是当前画面快照。 |
| HTML 分页 R26 | 明确独立的页面宿主化，真正耦合的 React/程序保真保留；整体承载不豁免内部编辑。 |
| 尺寸 R08 | 设计尺寸、窗口 fit、观察 zoom 分离；默认保留坐标，另有显式等比适配，页面作用范围独立。异比例适配允许留白，不拉伸、不裁切。 |
| 镜头 R22 | 保存当前固定画面与跟随目标是明确操作；保存后不能因另一模式而完全不生效。不以新增跟随偏移模式为修复前置。 |
| 取景 R23 | 默认适配当前有效可见内容，另保留全部内容；适配不改变显隐，可见集合不是只取屏幕内对象。 |
| 控制台 | 三表面沿原 Slides 逻辑默认收起，选中后由快捷工具条收展；Flow 使用同一手柄调尺寸，不增加外部收展按钮。 |
| 初态 | 暂停/继续保留现场；返回初态恢复当前页作者初始表现，不跳整课首页、不回滚已提交内容。 |
| 修复范围 | 原暂缓项也要修，统一排程；先后顺序不是能力退出。发行继续暂停。 |

### 当前事实，不再按旧根因重复开工

- 源码已提交至 `423a96dc`，不再把该批代码写成“未提交候选”。候选检查/提交仍不等于完整真实窗口验收。
- `documentFileSession` 默认 `autoSave:false`，关闭已有 save/discard/preserve/cancel，旧稿不匹配已有诊断处理。旧“800ms 默认覆写”和原关闭断点保留为历史，不作为当前统一重写的理由；保存后关闭的实际残余问题仍需在现行链处理。
- 原 rev15 分节作品已有同数据、新 Player 的真实点击 `0→6→0→6` 回执，见 [native-section](evidence/core-experience-20261007/native-section/verification.md)。不再把该限定结果写成尚未修复；也不扩称所有生命周期通过。
- 当前共同 documentBlockMenu 已有 table，FlowLocationWorkspace 已调用 runtime.setPlaying；旧“所有共同菜单缺表格/Flow 完全未启动 Runtime”只留启动历史。需要收敛的是共同用例与实际入口消费，不按旧原因重写已经存在的实现。
- 三路首次交付已经发生。内置 AI 首次为 rev3 partial，不是尚未发送；MCP 首次 rev7 缺图、续作 rev12 补图；裸 HTML 首稿有图像事实、连线和返回问题。见 [FIRST_DELIVERY_REVIEW](evidence/core-experience-20261007/FIRST_DELIVERY_REVIEW.md)。首次记录不由后续修补覆盖。
- React 课例的隔离真实运行图文与 `authorSpots=[]` 证据有效，见 [复现说明](../../../output/html-import-p0-20261007/VERIFICATION.md)。未变的计算、生图、导入/播放及独立检查证据继续复用。

## 3. 一个共同编辑核心，不同内容的具体适配

```text
人工点选/手势/属性                 AI 观察/内容与修改意图
                 \               /
         现有目标捕获：对象身份、范围、版本、锁
                         |
        具体语义操作准备：专业数据/源/作者覆盖
                         |
        本文档唯一 DocumentSession + History + ACK
                         |
       当前投影 / 始终运行的内容消费者 / 正常保存出口
```

“统一”落在目标、语义与正式提交，不把所有内容转成同一种 DOM，也不把所有操作塞进一个总 planner。复制、判题、图表、Flow placement、源码与资源分别复用实际 owner；公共层只传递必要捕获上下文与结果。

### 3.0 五个维度解耦，四处真实职责迁移

采纳第二份 GPT Pro 架构整合报告的主方向：内容表示、布局、运行、作者输入、界面/保存不是互斥载体，也不应按其笛卡尔组合各写一份业务。MD 是表示/存储，Flow 是组织/呈现，light 是 UI 密度；必要差异由具体适配器承担，不能取能力最低交集。

| 共同职责 | 现有整合接点 | 原入口保留什么 / 退役什么 |
|---|---|---|
| 运行宿主编排 B5 | ModelPlayer.mountV10Model/createProjection、Runtime、NavigationOwner | 作者保留 React commit、DocumentBridge/IME 与编译适配，Published 保留只读资源/预编译适配；退役两入口重复的 runtime 创建、同步队列、资源准备/投影保护顺序和销毁编排。 |
| 外层呈现决策 B3/B4 | 既有 componentLayoutInput、Flow extent/media layout、共享 geometry/presentation | InstanceView、PM NodeView、modelProjection 保留各自 DOM/React/PM 生命周期与 bind；同一 frame/内容范围/子对象/section/媒体决策只计算一次，不各入口重写。 |
| 正文共同用例 B4/B1/B2 | documentBlockCommands/menu、SharedDocumentEditor/editorSession、既有 selection/draft | Flow 保留 document/paper 放置与专业实例，MD 保留源文/相对资源保存；退役重复共同内容工厂、命令目录与选区→AI→回显编排，不重写正文编辑器。 |
| 文档视图生命周期 B1 | 既有 DocumentProjection/draft lifecycle/关闭服务与视图会话 | 正式 Session、未完输入、视图选择/滚动、Runtime 状态各自归属；共用 activate/deactivate、drain、suspend/resume/dispose 完成语义，退役根入口按格式猜提交与隐藏浮层规则。 |

运行装配以现有 ModelPlayer 接缝为落点，不新增通用 host 平台。资源准备→实际投影提交→Runtime sync→端口绑定→ready/销毁使用一套时序；React 投影必须真实完成 commit，保留 light/deep 祖先变化及 ProjectionMutationBoundary 对存活 iframe 的保护，不能机械套一个同步 DOM projection 或删除 boundary。

同一编辑视图的编辑/暂停/当前位置继续优先保留同一个程序现场；独立整课预览可以有独立 Runtime 实例但消费同一实现。多个合法视图的 zoom/pan 是各自状态，不合成一个总 store，也不共享几个窗口的运行现场。

每次迁移在已有任务交接写清共同规则的落点、原调用者改消费什么、哪些旧业务代码已退出以及保留的行为。只增 facade 后旧入口仍自行处理相同规则，不算完成；接口名和代码量减少不是证据。

### 3.1 持久对象地址、运行绑定与修改落点

在现有 API5 `authoring.register` 与工具目标上补齐以下概念，不建立平行协议：

| 信息 | 归属与用途 |
|---|---|
| 持久内部作者地址 | 所属实例/HTML 文档根内的软件 `authorKey`，必要时有真实 state/data-item 作用域；文档身份由现有 Session 信封提供。 |
| 当前运行绑定 | 地址此刻对应的 DOM/SVG/专业程序对象、mount generation、命中几何、当前实际支持操作。可以消失、重建，不是正式身份。 |
| 正式修改位置 | 精确作者源码、专业/程序数据字段，或该组件内有作用域的作者覆盖。一次操作对同一属性只选一个落点。 |
| 绑定状态 | 暂未挂载、有效、失联/歧义、需源码修改；运行状态是派生诊断，不反过来成为第二作者 store。 |

默认修改当前实例、所选实际对象及其必要的程序区域/state/data-item；跨状态、共享源码和多实例修改须有明确范围。持久 authorKey 必须同时保存可重挂载解析的绑定记录，不能只存 UUID 或依赖当次 WeakMap。

同文字、同图片 URL、同 DOM 序号不代表同一对象。静态 source span 是当前版本定位，不是永久身份；程序重复列表必须使用真实数据项或可确认的局部区域关系，不以数组下标单独充当持久地址。首次绑定只处理实际要改的对象及必要上下文，不推理整页。

优先修改现有真实源/数据身份；无直接映射的普通动态 DOM 使用局部持久覆盖，恢复 V9 已有图文编辑语义。当前绑定无法唯一对应时保留原内容、覆盖与草稿，明确该对象限制，不猜写别处、不整份拒绝可用作品。这个局部边界不能以“缺 sourceRegion/register”为由排除当前 React 普通图文或 V9 已支持图文，其仍是必须完成的切片。当前未挂载不等于删除，也不能把真正失联称 applied。

“同一属性唯一落点”贯穿连续操作：UI/AI 读取最终有效作者值。人工先保存某属性覆盖后，AI 修改该属性应写当前有效 owner，或在明确迁入源码时于同事务更新/折叠对应覆盖；不能只改底层源码、迁移锚点，让旧覆盖仍遮住新值。未改属性及人工几何默认保留，只有明确重做范围才处置它们，不从任意源码变化猜全页布局重置。

### 3.2 必须成套补齐的数据与消费链

Web 严格数据 schema 当前只有 html/css/modules/resources 等，需增加本组件实际需要的作者记录：内部 key、作用域、绑定及内容/资源/样式/几何覆盖。相应注册输入、捕获目标、具体操作准备、运行消费者与序列化一起扩充；不是只加 UI，也不需要为此升级整个平台或恢复 V9 writer。

**正式修改的运行应用与编辑观察分开：** 内容消费者始终读取正式作者值；编辑态才开启目标发现、选框、手柄。源码 render/signature 未变化，覆盖变化仍须局部应用；不得被 `authoredDocument` 的 early return 吞掉。React 重建后局部重绑定/幂等应用，不每次扫描都重执行整段程序或重建 `innerHTML`。

当前 Published 实际已复用 `webContentRealmSource` 并传 `htmlAuthoring:true`。GPT Pro 对编辑开关的提醒是应防的消费链风险，不是本轮已证明 Player 一定关闭扫描的事实。

React 官方说明：随意增删 React 管理的 DOM 可能破坏其更新；本方案因此把结构/算法修改交回源码/数据适配，有限内容覆盖不承担未知程序结构重写。[React 官方说明](https://react.dev/learn/manipulating-the-dom-with-refs)

AI 修改源码时，在原事务准备中处理受影响绑定：保留对象更新锚点、有明确对应关系的迁移、明确删除的按授权处置、无对应的保留并诊断。源码、关联作者记录和资源一并提交，不让异步扫描另写一笔。既有有效内容可落盘；回执分别说明源已提交、目标已应用或待重定位，不用一个笼统成功掩盖覆盖失效。

### 3.3 原 HTML 和 H5 两个持久化适配器

共同核心包括发现、持久地址、局部操作、命中/手势与运行绑定解析。现有原 HTML `DocumentFileSession` 已连接 Main canonical Session，不是第二 writer，不应替换成隐藏 H5 工程。

- **H5 adapter：** 将具体操作编译为既有 `ComponentEdit[]`，进入当前 Course Session；专业字段、组件源码、Web 作者记录与资产均在工程内保存。
- **HTML adapter：** 精确静态目标局部 patch 原文；动态作者记录仍由该 HTML 的 Session 持有，随正常 HTML 内容序列化，并以原文件正常保存/另存服务落盘。不是只存在预览脚本、恢复稿、缓存或另一 H5 文件。

推荐动态 HTML 包装是软件维护的非执行作者数据区，加共享局部应用 consumer，保持普通 HTML 自携可运行；静态可回写时不必加运行覆盖。资源可内嵌或复用当前随附资源机制，但保存/另存须携带真实闭包。当前 TextDriver 仅保存 UTF-8，HTML 图像 preparation 又会创建 `.assets`，应在现有 File/保存 owner 接齐，而不是复制 Markdown 的第二资源 writer。

这是具体包装设计建议，不假称 GPT Pro 已替 Owner 选定。编号、登记、局部包装由软件做，不逐项审批；若实现需要改变用户交付格式、强制依赖原本没有的旁文件或损失单文件便携性，必须先报告产品取舍。原件保留，默认显式保存，不在内容 realm 新增文件/登录/Provider 权限。

导入有作者包装的 HTML 时识别软件维护区，把作者记录交给 H5 adapter，只有一个 active consumer；导出回普通 HTML 仍由同一运行消费者承载。不能在 HTML 内留一套覆盖、H5 再套另一套，造成重复移动或重复改文。

### 3.4 自由移动、视觉缩放与内容盒尺寸

复用 `FreeTransformGesture` 的父矩阵、冻结起点、吸附和临时预览；结束编译为对象实际作者位置，一次手势一次 History。外层实例仍用 frame.set，内部对象不能冒充 instanceId。

区分视觉 scale 与内容 box resize。图片/整体可等比视觉缩放；文字改宽应改内容盒并换行，不压扁字体。专业组件用原有尺寸/布局 adapter，保留 crop、富文本、组和原始比例语义。

先保持原布局占位并添加作者位移能解决的，就只处理该对象；需要真实局部自由容器时，先在原容器一次测量受影响对象及邻项再批量装配，不边拆边测、不让 Flex 补位、不冻结整页 React。组件的运行变换与作者增量在现有矩阵链明确组合，不把任意动画帧写入永久几何。

`getBoundingClientRect()` 是相对 viewport、受滚动影响的观察盒，不能直接当作者坐标；内容盒、父变换和裁剪沿现有几何取得。[MDN 观察几何](https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect)

### 3.5 GrapesJS / Moveable 不替代持久化闭环

普通 HTML 结构/样式编辑与 Runtime 内部编辑是两个共同保留的工作范围。**保留 GrapesJS 普通 HTML 投影接入路线，不因 React P0 不靠它解决就静默取消。** 本方案推荐 GJS 作为局部可丢弃 Model/View、Moveable 作为可选薄手势输入；果铃几何、目标、正式保存和 History 始终拥有结果。

GJS 自带模型和持久项目数据，不能将其 project JSON 或整页 getHtml 覆盖果铃作者真相。关闭独立 storage/自动保存，不让它承担正式 Undo；模型事件适配为局部语义操作，ACK/外部修改重新投影。Moveable 提供手势事件，不解决身份、React 数据和保存。[GJS 组件模型](https://grapesjs.com/docs/modules/Components.html)、[存储](https://grapesjs.com/docs/modules/Storage.html)、[Undo 管理](https://grapesjs.com/docs/api/undo_manager.html)、[Moveable](https://github.com/daybrush/moveable)

不重新设置全产品选型比较门。后续拟替代、不采用或延后既定路线时，向 Owner 说明原承诺、拟变更、证据及能力/成本影响；未决定前不删除对应工作范围，也不阻塞无关已授权修复。库集成不能充当 React 深编辑完成证据。

## 4. 七个职责批次及完整范围

下面每条 R 只有一个主归属。跨批消费由接口依赖体现，不重复分配共享文件 writer。N 为审计新增缺口，M 为维护项，不把它们冒充 V9 回退。

| 批次 | 主归属审计记录 | 原反馈及其他范围 |
|---|---|---|
| B1 作者事务与语义操作 | R01、R02、R03、R04、R05、R06、R09、R30、R32、R35、R39、R44、R45 | 原 1/7/9：输入、ACK、History、保存关闭、恢复；捕获范围与完整复制。 |
| B2 内部对象与编辑平权 | R07、R40、R42、R46、R47 | React P0、原 3/4/5、H5 light/deep 与原 HTML；N01 共享专业源码面板、N02 富表格。 |
| B3 显示几何与作者取景 | R08、R21、R22、R23、R24、R34 | 原 6 几何/8、所有入口同作品视口、控制台手势。 |
| B4 Flow 正文与放置语义 | R10、R11、R12、R13、R14、R37、R38、R41 | 原 2：共同正文表格/源码入口；环绕、锚定、落点、背景、媒体替换。 |
| B5 运行生命周期与互动 | R15、R16、R17、R18、R19、R20、R31、R33、R43、R48 | 原 6 运行、返回初态、控制台导航；分节已证行为保留。 |
| B6 当前内容与交付闭包 | R25、R26、R27、R28、R29、R36 | N03 CSS dependencies、N04 headless PPTX；HTML/工程保存出口。 |
| B7 开发输入与能力注册 | 无新增 R | M01 quick launcher 输入，M02 API5 catalog 验证，M03 Office 发现去重。 |

### B1：不是 instance.data 等于完整作者对象

复用 `DocumentSession`、`CourseV10DocumentBridge`、`DocumentToolGateway/ToolTargets`、`crossSurfaceCommands`、专业 draft projection 和现有复制/状态/托管判题 planner。

- 明确“输入尚未完成/提交拒绝/正式 ACK 成功”的结果，沿实际 draft owner 汇总后传播。History、保存、关闭、AI send 不能忽略 false 或丢 Promise；对应 ACK 成功才清 UI dirty。保存捕获版本后出现的新输入仍 dirty。
- 关闭沿现有 coordinator：save 保存有效当前内容；discard 停止本次写回并只丢弃对应未保存内容/原稿；cancel 恢复可继续输入；需要保留无法应用的草稿时提供具体恢复结果。旧稿不匹配只诊断，不覆盖新内容，也不阻当前有效保存。不得清空无关恢复目录。
- 文档视图切换沿同一完成/生命周期合同：输入准备归既有文档级 draft/lifecycle owner，正式保存/关闭归 DocumentHost/Main coordinator，App/工作台消费结果；接通后退役对应格式特判/重复 prepare，保留 DocumentFileSession 的源文、资源及文件观察适配。视图 deactivate、投影释放、正式关闭是不同动作，释放投影前保全其 documentId/epoch 的未确认输入，不以隐藏标签推断卸载 Session。未激活视图的命中、portal 与编辑手柄停用；选择/zoom/scroll 归视图，运行状态归该 Runtime；取消关闭恢复同一输入 owner，不重造另一份草稿。
- 完整复制先确定所属实例、规则、反馈依赖、所有命名态覆盖与层序，再分配身份、重映射并一次提交。明确外部独立引用不是无条件一起复制，托管反馈不能误指原题。Flow 菜单复制使用同一 semantic copy，不能直接复制旧 instanceId。
- 锁在同一作者操作准备/正式应用边界落实，检查实际受影响对象；解锁是允许的控制操作，播放/动画/临时显隐不属于作者修改。不靠禁用一个按钮保护其他入口。
- R32 UI/AI/导入共用 managed input 配置，答案和所属规则/反馈机械同步；仅有对象授权也能由其语义 owner 操作已声明托管依赖，不把模型授权扩成任意页面兄弟可写。
- 状态显隐与初始显隐走同一 state adapter，不落母版；删除状态清相应引用，隐藏找回复用当前 scope/适用页面。任务恢复保留 V10 冻结目标与 grant，不将过滤后空范围补为整课写权。

最小证据按改变的 owner 选择：一次被拒绝提交保稿、一次完整副本独立互动/状态、一次局部答案真实判题与范围保全；不为了 13 个编号造 13 个全链测试。

### B2：内部对象和专业编辑同一入口

第 3 节是该批核心。持久记录、实际落点和非编辑消费先成套落地，再接 UI/AI；不能先交几十种选框。

- H5 light/deep 使用同一工具及可按需展开属性/结构，不强制 deep 才能调用已有能力。原 HTML 使用同核心和其原 Session 保存 adapter。
- 图表/预置组件提供稳定字段目标；表格富单元格走已有 rich editor 与 cell-content，不通过 cell-text 丢掉 content/marks。不同面板改行距写相同专业字段。
- 专业识别按仍适用的专业 key/data/edit contract，不仅看 implementation.kind。保留合同的源码定制仍有专业面板/输出；真的改变合同才明确局部限制，不保证任意重写都能沿用旧控件。
- 普通文字保留 IME、点击落点和确认退出；绘图 Escape 取消工具模式；原成熟控件复用，不加新 AST/写作 DSL。
- DOM/SVG 的基础发现由软件承担，非 DOM 程序复用 authoring.register 暴露目标。首个非 DOM 样例证明适配，不建设新场景引擎。

最小证据优先完成第 6 节同一真实作品纵向切片；专业叶只补直接变更的真实操作。

### B3：共用几何事实，不建万能 viewport owner

复用 `fitPage/createStageViewportTransform`、Flow geometry、Spatial camera、PlaybackViewSession/ViewState 和当前 controller geometry。

- 各表面产生一次设计空间、实际内容/HUD 可用 rect、fit、观察变换及正反矩阵；绘制、命中、裁剪、夹限消费同一结果。light/full 只改变实际 host rect，不能改变同作品设计空间或算法。
- 控制台位于一份共同 HUD 投影，保留正式作者 frame，但独立于 Slide/Flow/Spatial 内容各自的 fit、zoom/pan/scroll/camera。共同 HUD 由统一作者参考空间和实际 HUD 可见 rect 一次生成，绘制、hit、clip、clamp 与手柄逆映射同源；直接挂该层，不再逐表面逆内容父矩阵补偿，也不在大 viewport 夹限后塞入小 page clip。不新增 dock store，不强迫三表面内容一种比例。
- componentLayoutInput、naturalFlow/localAssembly、内容 extent、媒体宽度及子对象放置等重叠决策归既有共享 presentation/geometry；作者 React、Flow NodeView 和 Player DOM 消费同一决定。section 可有“作者展开便于编辑/播放按折叠默认”的显式策略，不能各入口私自解释正式语义。
- 当前页/多页改尺寸默认保 frame，显式 refit 才生成作者变换；父子层级与共享层各按其归属变换一次，避免重复缩放。
- 固定镜头保存 pose；跟随镜头消费真实目标与取景策略；明确模式转换，不保存无效 pose。默认可见 fit 的集合复用当前状态/祖先显隐/适用性，包括屏幕外对象；全部 fit 是不同集合、同一算法。
- 独立 Spatial Player 接现有 pan/zoom 输入到相同 camera port；选项优先显示保存的对象名称。固定画布 reveal 保留占位；Flow 阅读展开按阅读语义，不统一 display:none。

最小证据是一个作品在实际工作台/完整编辑/run/整课预览消费同一几何，控制台可见、正确命中且手柄回写一致；再证明独立 Spatial 浏览与一次主动尺寸/镜头操作。不跑设备/比例全矩阵。

### B4：Flow 的阅读、纸面、浮层不混为一个顺序

复用 `FlowWorkspace`、SharedDocumentEditor、flowBodyPresentation/flowMediaLayout、paragraph anchors 与媒体提交 owner。

- 环绕、宽幅/通栏由正文组件共用 wrapper 与实际内容消费，不能只改 shell。稿纸背景设置写入真正绘制的稿纸，不被另一层默认白色遮住。
- 正文上下移使用正文成员集，排除浮层/behavior；拖入章节和菜单插入捕获真实 container/index/段落，不按旧选区或固定 `(0,0)` 放置。
- paper fixed、paragraph anchored、viewport 浮层明确模式；普通拖动保留模式，固定与随文切换保持当前画面并维护 anchor，不能拖一下就自动改成随文。
- 资源库替换复用 `replaceCourseMediaAtTarget`，保留同实例、frame、placement 和互动，不插一个新对象冒充替换。
- 加号/斜杠/顶栏表格与源码入口共用正文语义；表格、公式复用现有专业数据/控件。
- documentBlockCommands/menu 已是共同目录与工厂，Flow 插入目录改消费它的同类用例，只保留 paper/document 与实例类型的适配。Flow 专业 table 与 DocumentBlock table 不是同一数据，按真实对象选对应创建/编辑路径，不能以统一目录将专业能力降级。选区→捕获→AI→原目标回显同 B1/B2 共享，MD 源文与 V10 字段/资源不同仅在 adapter 翻译。

一个长章节真实作品可覆盖落点、正文排序、纸面模式与媒体设置的目标结果；内部投影逻辑用最近层验证，不把每个组合变成完整冷开。

### B5：运行事件与当前页初态由既有 owner 协调

复用 `ComponentPlatformRuntime/ComponentWorldInteractions`、`ComponentNavigationOwner`、AudioManager、正式规则装配和键盘输入 owner。

- 共同宿主装配迁入现有 ModelPlayer 接缝：准备资源、投影变化保护、实际 commit、Runtime sync、观察/镜头端口、ready 和在途销毁一套顺序。CourseV10RuntimeView 保留作者桥接及 React 时序适配，但退役其重复的运行创建/sync/退役 owner；Published 保留只读准备，各合法窗口独立运行状态，不把导航或作者 writer 移进 ModelPlayer。
- 声音库 ended 使用真实 soundId 桥接；视频阈值按规则 subscription 跨越一次，倒退/重播重新布防，scope 退休释放，不在每个 timeupdate 重启动作。
- 依次出现模板同时装配初始隐藏和规则；快捷点击按动作类型增改，保留其他动作及已有顺序，不静默替换整个 click。完整规则编辑与快捷栏同 owner。
- 当前页重播/返回初态清该页临时显隐、动作与运行 leases，并协调展示步骤/fragment、camera/scroll、观察变换和控制台临时偏移；保持当前 surface 与已提交内容，不使用全课 World reset 掩盖页内缺口。整课 restart 独立。
- 教师目录/强制跳转保留既有越过能力，普通学生导航继续守 guard；源码代理合法 targetStateId 与宿主端口等价。accepted/翻页笔反馈按实际执行，不按“有 listener”猜接受。
- 控制台存在、启用/关闭、收展分别消费其实际配置；当前位置 run 使用相同 runtime 与导航键 owner，不另建试播规则。

复用原 section 回执，只对被改变的生命周期补证。声音结束、跨阈值、页内重播/初态、教师源码导航分别在实际 consumer 验证，不用普通播放成功抵消事件缺口。

### B6：同一来源和交付 snapshot，多个真实格式消费者

复用来源 Session snapshot、`CreateCourseFromHtml/contentApply`、当前资源/模块 resolver、Main compiler、`buildComponentDelivery` 与格式 builder。

- 由当前已打开 HTML 创建课件使用已捕获当前内容，不重读磁盘旧稿；独立页通过当前 surface.add/装配进入宿主页，耦合程序保持行为与内部导航，不用重复复制脚本强拆。
- 递归 iframe/srcdoc 的相对 base、资源、CSS 与模块进入现有闭包并由真实子页消费；源码读到不等于 token/module 已供应。保持既有 origin/文件授权边界。
- CSS siblingFiles 真正进入编译 adapter 与依赖缓存；不是 reader 读到即完成。
- 内置字体从 bundledFontEmbedding 接单 HTML/网页包；GIF 经既有解码/捕获输出静态帧进入 PPTX，不承诺动画，也不继续缺图冒充完整输出。
- 页面选择、顺序与纸型从同一 drained delivery snapshot 传到各实际格式 consumer。保留公开能力，不能只在参数接口存在。
- headless PPTX worker 的资源 CSP/捕获单独修证，不扩大断言到桌面；不靠关闭整个 CSP 修可用图片。
- B2 作者记录和消费者随 H5 Published、单 HTML 与原 HTML 保存出口实际携带，导出不能只序列化记录而不执行。资源 Save As 闭包归既有 File owner。

每项从原明确失败样例验证对应输出属性；完整递归资源、字体、GIF、打印和 headless 是不同消费者，不能以一个万能 resolver 或全格式矩阵替代。

### B7：维护入口也有落点，但不冒充用户 P0

quick launcher 输入清单包括真实组件、生成器与 worker HTML；旧 catalog 验证脚本改消费当前 API5 reader；Office 能力发现使用唯一注册源去重。只做最低成本结构/脚本检查，不恢复全仓 V9 门，也不以这些项阻挡可独立交付的用户修复。

## 5. 实施顺序、并行与独立 review

恢复实施后先选真实纵向操作和可信失败模式，再写测试。按下列依赖释放工作，不逐阶段询问继续，也不将 planned 写为 active：

1. Root 固定本批 capture/scope/ACK 与内部作者记录的小合同；B1 已知正确性修复、B3 显示几何、B4 正文叶、B5 媒体事件、B6 资源/字体叶、B7 可按非重叠文件先行。无需等 B1 全结束。
2. B2 先贯通真实 React 图文的持久应用和两个保存 adapter，再接自由手势、同目标 AI 与专业/非 DOM 适配。B3 提供矩阵与 clip；B6 接作者数据出口。图文通过不等于其他承诺取消或自动完成。
3. 在同作品完成第 6 节切片，同时继续各批剩余落点。批次尾汇合以真实消费者为准，不以单元数、库初始化或序列化成功收口。
4. 核心路径修复后续接已有三路 Luna/medium 作者作品，先复用已成功图与原作业续未完成，不重做首次基线。三路正式比较仍按原执行指令；费用/账号/发行边界不变。

共享文件按实际内容单 writer：`ToolTarget/runtime/Web data/operations` 由接口 owner；`SandboxComponentImplementation` 涉 B2/B5/B6 由同一 writer 集成；`FlowWorkspace` 涉 B1/B2/B3/B4 由同一 writer；`courseV10Operations/crossSurfaceCommands` 涉 B1/B3/B4 用同一语义 owner；`CourseV10RuntimeView/ModelPlayer` 共同宿主、外层 presentation helper、`documentBlockCommands/flowInsertCommands` 各指定一个迁移 writer；Main 保存/资源与 Player projection 同样固定 owner。角色派发时才定具体文件锁和任务状态，不长期占整批粗锁。

专业表格/图表/预置组件、字体/GIF/打印/CSS 叶在窄接口稳定后可安全并行。重要职责/合同候选由未参与实现者独立 review，审原要求、实际 diff、直接消费者和保留行为；不只审作者新写的验收。相关未变有效 review 不重复，全局不因一个待决叶停工。

## 6. 最小充分验收与退出条件

### 第一条纵向切片：同一个真实 React 课例

使用已保全的 `Starter-Unit-1-Hello-standalone.html` 及其隔离工程副本，不操作 Owner 正在使用的窗口、不改原件。

1. 正常原 HTML 与 H5 入口发现/定位对应图文；修改文字、替图、自由拖动及正确尺寸操作；同文/同图的非目标不误改，邻项不意外重排。
2. 同一内部对象由 AI 局部续改，包含“人工先保存内容覆盖→AI 从有效值继续修改”的连续操作，旧覆盖不遮新值、人工几何保留；一次相关 React 重绘/Conversation 切回仍正确；撤销重做及显式保存重开保持正式结果。
3. 退出编辑、真实 Player 与正常 HTML 交付各消费该正式修改，原互动仍可运行；证明消费者和保存出口，不扩成所有格式/设备矩阵。

原导入/播放、资源解码、计算、生图证据继续有效。真实模型调用只在确需验证同入口 AI 内容时按已有授权执行，本轮方案不调用。一个已注册非 DOM 样例证明同接口可用，不把未知 Canvas 自动反解当验收。

其余 B1–B7 在目标 owner 最近层验证改变的属性；GUI/布局用真实呈现，保存/History 用对应往返，资源/格式用实际 consumer。每批先审测试题目，选择最便宜且足以证伪成功的 1–3 条；扩大仅由相关变化、失败或明确集成属性触发。

全部真实问题保留到修复或有证据的处置，无默认 D 排除。暂未绑定、partial、源码提交、应用、保存、真实窗口和 Owner accepted 分别报告，不用改写验收或成功按钮抹去缺口。所有问题的归属完整不等于软件已修复。

## 7. GPT Pro 意见采纳与证据来源

采纳第一份评审：持久地址/范围、正式数据落点、编辑发现与运行消费分离、scale/box resize 区分、原 HTML 自携保存、同目标 AI、重复内容不误改及正常出口验证。校正：Published 当前已传 htmlAuthoring；编辑开关依赖是职责风险而非已证停用。状态按实际回执纠正，不用旧 autoSave/关闭因果重写现行服务。

采纳第二份架构整合评估：五维解耦、共同运行编排、外层呈现决策、共同正文用例与文档视图生命周期。把真实旧职责退役写入 B1/B3/B4/B5，不新增第八个总平台。共同 HUD 的设计投影与内容 fit 分开；原草案“控制台跟随设计 fit”的含糊表述已由此修正，不是改变保存的作者 frame。

报告不是 Owner 指令。具体 HTML 作者包装为本方案推荐，GJS 既定范围保留、不擅自取消；若改变关键路线、用户能力/默认或交付结果，披露原决定→拟变更→证据→影响，只暂停受影响部分等待 Owner，不新增每文件审批或运行门。

- [统一问题与直接证据](CORE_EXPERIENCE_ISSUES.md)、[当前状态](../CURRENT_STATUS.md)、[历史实施结果](IMPLEMENTATION_RESULT.md)。
- [静态审计](D:/果铃审计/20261007-v9-v10-static/REPORT.md)、[评估分类](D:/果铃审计/20261007-v9-v10-static/CORE_ASSESSMENT.md)：分类不是本方案的暂缓排期。
- [GPT Pro 补充](C:/Users/74755/Downloads/CORE_EXPERIENCE_ISSUES_REVIEW_423a96dc.md)：固定 423a96dc 的只读意见，未重建所有原始口头授权，不替代真实消费者验证。
- [GPT Pro 架构整合评估](C:/Users/74755/Downloads/ARCHITECTURE_CONSOLIDATION_REVIEW_423a96dc.md)：同基线只读意见，提供职责迁移依据，不自行授权全面重构或新的能力取舍。
- 官方来源只支持技术边界，见第 3 节链接；不以库文档证明果铃已集成或任意 React 可自动逆向。

## 8. 本轮方案收口

由未参与本文撰写的独立 Reviewer 对原要求、必要当前 consumer 和两份 GPT Pro 材料定向审查。已补齐默认作用域/重挂载绑定、先人工覆盖后 AI 修改的有效作者值协调，并确认 B1/B3/B4/B5 的旧职责退役、React commit 保护与共同 HUD 策略；未发现新的实质方案缺口，可作为统一方案入口。

七批主归属覆盖 R01–R48，无遗漏或重复主 owner；N01–N04、M01–M03 及原反馈另有明确落点，本地引用存在。此检查只证明方案范围/导航，没有执行产品测试、构建、GUI 或真实模型，不代表任何新修复已完成或 Owner accepted。下一步按当时明确执行指令实施，发行仍暂停。
