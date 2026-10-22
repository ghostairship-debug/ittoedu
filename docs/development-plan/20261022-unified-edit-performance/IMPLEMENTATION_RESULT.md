# 统一编辑体验与性能收敛实施结果

> 先期实施记录：后续独立复核发现的问题、修复和最终性能对照见[修复闭环报告](REPAIR_RESULT.md)。本文保留原阶段条件和旧失败，不覆盖后续结果。

2026-10-22，本轮统一总方案确定的软件主线与实际触发的新增修复已完成。最后 Flow 文字—内部图—父级—回文字交叉接线已在原严格断言下完整通过；条件专项与保留成本明确列于下文，不将127个定位编号写成127个全部消除的缺陷。

依据：[统一总方案](../../archive/果铃统一编辑体验与性能收敛总方案-2026-10-22.md)。起点 HEAD `1af578e57c120210810d8e2996d072efdc50a365`，保全原有 702 项 dirty、原作品、profile、恢复稿和历史失败。Root 是实际源码唯一集成者，叶子仅交隔离候选；无收费调用、commit、push、Portable、发布或部署。正式格式仍为 Project 11／Published 4／Component API 5。

## 实施边界

围绕同一精确目标、同次变化事实和实际生命周期实施，继续由 DocumentSession、原资源与文件服务拥有事务、History、保存和发布。没有第二 writer、History、全格式 store、通用调度或缓存平台。

| 闭环 | 已实际整合的内容 |
| --- | --- |
| U1 精确目标与输入 | 对象／字段／文档精确地址、稳定 scope、轻选择通知；四工作区、属性、图层、菜单／快捷键与 AI 结果使用同一目标。未支持命令不扩大到父级；真正关闭清临时选择，pin／草稿保留。 |
| U2 专业编辑与 Flow | 共享 rich／plain／cell 输入、caret、输入接管与按载体提交；T1 连续阅读组、PM 身份／Decoration 增量、隐藏源码惰性物化。FLOW02／06／07 按真实样式、对象依赖和受影响阅读后缀更新；字体不阻语义输入，失败保原框并允许保存。 |
| U3 History 与保存 | 效果及逆变化、journal v3 增量／checkpoint、轻 head／delta、内部 owned/COW、串行 rebase、固定 revision 归档 worker。派生 index/checkpoint 退出关键 ACK；操作 bytes 摘要有版本并保旧回执；HTML 局部范围事实贯通未失焦保存。 |
| U4 Runtime 与手势 | Source 准备与编译共享、轻 targets、单资产 URL 租约、相关 realm 停车；hover 一在途一最新、Slide／Spatial 显示手势按帧合并，pointerup 用最终点。真实 RO／作者尺寸减少重复布局，零尺寸及父级 fallback 仍采样。 |
| U5 HTML 与文件 | revision 内共享分析、预览／GJS／源码精确目标、局部扫描／稀疏控制、frame／lease 释放；文件分页快照、dirty 路径、watch 租约、前后台观察和轻恢复列表。保存后复用同次成功 publication facts，强版本及依赖检查保留。 |
| U6 AI 与工具 | 增量 stream parser／真实背压、终态释放、RunStore 增量、EventStore consumer 生命周期／锁外查询；checkpoint+tail、真实历史／组／正文窗口、增量读模型与可见前缀、布局相关性；预算统计复用唯一 prepared wire。project 文件按需物化，默认目录不组装整页。 |
| U7 启动与交付 | builtin／GJS 按需、库 metadata、实际字体字符准备；冻结 revision 导出 worker、job 捕获复用／取消；Office apply/inspect 与 PPTX 转换隔离、同包后处理。材料 PDF 单 document 逐页 ACK 入盘／取消，图片派生按 document／epoch 与活动 job 退役；保原图、alpha、可编辑与离线交付。 |
| U8 条件范围 | 按实际规模触发，不因 127 个编号机械实施全部专项。保留项与未触发项见下文。 |

Flow 的首次 Enter 曾规范化 11 个未选节点；现由唯一 Flow planner 仅在完整 block 语义等价时保原 data，覆盖 PM 与源码回环，真实文字／样式／链接／公式／结构变化继续写入。完整 T1 已实证未选节点保持。

最后 V1 追加复核沿同一选择归属修复真实出口：渲染对象的 click 不再把旧 PM caret 重报为当前选择；本文件权威字段／对象选择接管时，迟到 revision 不再重报旧文字选择或旧 AI 捕获范围，父组自己的属性 ACK 也保持当前目标。只读调用栈另证实 PM 对右键 mousedown 建立了 MouseDown、mouseup 再抢字段归属；现有精确字段命中预筛认领该右键，不提前编辑或选中，原 contextmenu 仍唯一负责选字段和菜单。后续栈和独立 hasFocus=false 查询又证实失焦 DOMObserver 的纯选区重建会夺权；现仅在该同步观察栈、应用后无正文变化、PM失焦且现有外部选择仍持有时，退出对外选择／AI捕获通知，本地状态照常应用。来源事实局部 try/finally 还原，真实点击、内容变化、有焦点输入及栈外主动 API（包括先 dispatch 后 focus）均沿原路。Flow 仅把与单选实例匹配的现有 author spot 接回一份 NativeSelectionContext，旧 PM 卡按权威选择退出；精确右键事件对齐该消费者已有的最近 main 根。未改 DeveloperTab、Escape 路由或 PM 库，未增加选择镜像、优先级、事件重放、时间窗或逐 API 例外名单。

同链进一步发现原生图片字段替换只更新显示资源、仍以旧图作为“恢复原图”基线。现沿既有专业 replaceImageSource 语义，在原精确 assetId delta 后、同一事务追加 originalAssetId；保原目标校验、裁剪、样式和布局，不写整个 data 或顺带填默认值。仅有效 builtin:image 的原始 assetId 字段走此语义，Source／HTML／程序 override 不扩面，旧资源保留。

## 真实用户链与最终载体

所有运行均使用隔离副本和 profile。测试、UI、冷开、交付 carrier 与 Owner 接受分别记账。

| 用户链 | 当前事实与证据 |
| --- | --- |
| V1 Flow 图文接力 | [run-ZbYMIc](../../../output/unified-edit-performance-20261022/ui/flow-image-return/run-ZbYMIc/facts.json) passed、errors=[]，无Debugger／trace：原 caption输入rev186→真实图片字段右键／Escape保持及侧栏替图rev187→显式父组间距12px rev188、ACK后图层／可见JSON仍同父ID→回原caption输入rev189全链通过；实际新图解码1254×1254，图片只改两源ID，裁剪／样式／布局及未选实例／定义／旧资源严格保持。父组使用既有对象JSON入口，非新增专用间距控件；该入口仅对所选父对象显式填入四个既有效默认值，逐项记录，所有其它字段保持。回文字后Native字段消费者退出。89次工具命令及最终自有session关闭均exit0，旧失败独立保留。 |
| Program 编辑与运行 | [run-j4zUrM](../../../output/unified-edit-performance-20261022/ui/program/run-j4zUrM/facts.json) passed、errors=[]：中部 caret／Esc、button 编辑不执行业务、精确换图、整体属性、Undo/Redo、GUI 保存、新 PID/profile 冷开、同 button/input/canvas 运行及嵌套 Blob 标题通过。旧 nested 导航失败保留。 |
| 小 HTML 多视图 | [run-wrXwii](../../../output/unified-edit-performance-20261022/ui/view-roundtrip/run-wrXwii/facts.json) complete、errors=[]：预览精确选择→首次 GJS 同树／文字属性及 canvas→源码精确 range/focus／实际编辑→保存回预览与 button→新 PID/profile 冷开运行。GJS 选框未作为通过属性。 |
| T1 连续阅读与源码 | [run-20:01:21](../../../output/unified-edit-performance-20261022/ui/flow/run-2026-10-21T20-01-21-089Z/facts.json) passed-cdp-composition-carrier、errors=[]：Enter/Backspace、跨段选区、中文组合中无正式 ACK、正式中文、邻文保留、Undo/Redo、body.md/html 同源零改写及真实源码编辑、保存 rev185、新进程冷开一致。中文证据为 Chromium CDP；物理 OS 输入法未签。 |
| 原生图片／容器 | [run-V8ub4F](../../../output/unified-edit-performance-20261022/ui/native/run-V8ub4F/facts.json) 已过四次同子图拖缩、父组／邻图保持、嵌套 Spatial 进出与相机且无内容 History。该 run 最终 failed 于表格 Esc，不写整体 passed。 |
| 原生 rich cell | [run-Wy3dMU](../../../output/unified-edit-performance-20261022/ui/native/run-Wy3dMU/facts.json) passed、errors=[]：Tab/Enter、真实 Esc 完成、合并、同一公式ID改为 x^3、跳过合并覆盖格、富文字／邻格保持、保存与新 PID/profile 冷开全链通过；保存／重开 rev10、dirty=false。PM对真实键码27/13的兜底在原适配器转交，9项真实键码／插件／IME检查通过；屏外控件用成熟滚入可视能力且保严格命中，旧失败未删除。 |
| 大 HTML 未失焦保存 | [v6-unblur-cFQ2eR](../../../output/unified-edit-performance-20261022/ui/large-html/v6-unblur-cFQ2eR/facts.json) complete、errors=[]：真实 focused textarea 直接 Ctrl+S，无先行 blur／Apply，磁盘新文／saved ACK、warm Undo/Redo、新 PID/profile 冷开通过。 |
| 大 HTML 冷开继续改 | [v6-cold-continue-VpCcei](../../../output/unified-edit-performance-20261022/ui/large-html/v6-cold-continue-VpCcei/facts.json) complete、errors=[]：另一新副本／profile 冷开后实际修改、Apply、新会话 Undo/Redo；不冒称旧 History 恢复。 |
| PDF 材料／PPTX 导入 | [run-ZFMqp0](../../../output/unified-edit-performance-20261022/ui/delivery/run-ZFMqp0/facts.json) passed、errors=[]：真实 contextBridge／hidden host，2 页 PNG 落盘读回、已启动任务取消；PPTX 原生可编辑实例及正式 GLX Driver 保存／fresh load。属公开 IPC/worker/Driver 链，非全 GUI/Office 矩阵。 |
| 冻结导出／在途取消 | [run-xt71Tl](../../../output/unified-edit-performance-20261022/ui/frozen-export/run-xt71Tl/facts.json) passed、errors=[]：新稿 canonical ACK order25 早于 generated34；真实 PPTX 仍旧文字，Source PNG 红196320像素／蓝0，而当前 Session 已蓝／新字；第二旧 revision 构建开始后取消、reject、host 关闭、无 generated 晚结果。仅构建阶段，不冒称文件发布原子性。 |
| T2 嵌套缩放／遮挡 | [run-AN205M](../../../output/unified-edit-performance-20261022/ui/nested-scale-overlap/run-AN205M/facts.json) complete、errors=[]：.75 缩放、前景不穿透、露出 nested 字段非空 document scope／精确 caret、实际文字和按钮修改／正式 rev10、编辑业务0/0、运行同控件1/1全部通过。复用 known-HTML-Blob 捕获与唯一 owned 协议，首次导航前装饰、旧报告退役、最后叶锚和 records override；16项含 toString／fresh scope／Undo／捕获模式检查通过。本专项不额外签 nested 冷开或任意动态 iframe 身份。 |

第一轮大 HTML 显式 Apply、换图、保存冷开及 file:// 渲染见 [ACCEPTANCE_RESULT](../../../output/unified-edit-performance-20261022/ui/large-html/ACCEPTANCE_RESULT.md)，未受相关改变的属性继续有效。外部文件／资源观察、AI 冻结与人工交替、菜单精确命令、字体等属性由各直接 owner 的聚焦行为／真实相关 carrier 证明，不机械扩成内容×表面的全矩阵。

V1 的[专项结果](../../../output/unified-edit-performance-20261022/ui/flow-image-return/RESULT.md)记录完整断言与历史诊断。所选父对象的四项默认展开为 visible=true、locked=false、playbackInitialVisibility=inherit、attachments=[]；原来存在的非默认值仍保留，不将此例外用于未选对象。该短链不重复签 IME、保存冷开或导出，分别复用上表直接证据。此前 ZXOTHV 的快照命令超时发生在右键前，失败后工程读取／截图成功；进程退出诊断与仅自有会话清理也经独审，未改产品来迁就工具，亦未把清理结果当作超时根因。

## 性能事实与剩余成本

| 观察 | 已证明属性／限制 |
| --- | --- |
| 原 25,709,739B 样本 | 最后一轮打开14.737s、未失焦保存 ACK14.499s、冷开12.073s；另一次冷开继续修改 Apply2.521s。保存仍有明显等待，不称普遍流畅。 |
| 保存分析 | 原 trace 同次约7.060s和5.716s两次依赖分析；现同次成功发布事实复用，目标检查证明两次变一次，正文／CSS／子页／缺失资源与未知结果边界保留。旧显式 Apply+换图保存21.619s与新未失焦场景不同，不给稳定加速倍率。 |
| 局部 History | 新 QA 逐帧解码：首次效果2范围，Undo／Redo各2范围、各390,922B，无 effect／receipt 的 >1MB 正文残留；原411MB大跨度效果根因已消除。见 [逐帧证据](../../../output/unified-edit-performance-20261022/ui/large-html/v6-unblur-cFQ2eR/journal-frame-structure.json)。 |
| checkpoint 表示 | 上述旧 QA checkpoint102,949,887B，约99.6%为 current／saved 两完整正文角色；后续已合编码 wrapper 精确共享，4项检查证明同kind/source/resources时免重复编码、异事实不合并及 decode 后 Undo 保保存基线。不修改旧 QA 日志，不将此表示收益冒充 Save 关键路径提速。 |
| 响应采样 | 未失焦保存58个样本，Main ping最大209ms、renderer最大1220ms；含自动化传输，不是CPU归因或帧率保证。 |

继续保留：首次／真正变化的完整 snapshot、必要 fsync/CAS／旧回执／源完整性读取；opaque realm 的同步动态资源 fallback；有副作用 Source update 保序；真实字体／宽度变化及受影响阅读后缀测量；AI 首次索引、结构变化 fallback、主动全文复制／展开；首次媒体完整解码、真实 DOM/字体测量、file:// 包装成本。

条件未触发或未据收益证据扩面：大 Spatial／对象及文件树窗口化、大复制锁融合、外部大库／Main require、公网／日志风暴／特定永久 pending、Python 大输出与编译制品规模、活动文字卡共享几何、RunStore更细阶段去重／跨字段结果共享；DOCX→Flow 纯解析进一步搬 worker、同批测量 host 复用、动画图准入、可见长源码与 HTML 首次分析进一步 worker 化、长历史恢复端点／容器和富文本 continuation digest。它们有原 owner，未冒充已消除；不为编号新造平台。MEDIA10 全图挂载的旧前提与当前单 fragment reader 不符。

## 独立审查与验证边界

新增问题均经独立 reviewer 审必要性／范围，实际候选由非作者审后由 Root 按 baseline hunk 整合。审查曾退回过过宽 capture、过时缓存／滚动锚点、失效异步结果和无依据验收门；修正未用候选自己的退出码替代真实链。

新增问题包括：库身份提炼、旧 bootstrap 稀疏状态、文件移回冲突／媒体迟到重绑定、同字段 scope／关闭重开注册、Windows 失败回退／跨 realm 字节、启动空快照、精确 caret、Flow 卸载前 realm、opaque Blob 导航、源码范围放大、保存重复观察、Flow 邻段规范化、Esc、checkpoint 重复表示、动态 Blob 作者接线，以及最后 Flow 的旧选区通知／精确消费者／右键与失焦观察归属、原生替图恢复基线。各隔离包的 HANDOFF／REVIEW、[integration-log](../../../output/unified-edit-performance-20261022/integration-log.jsonl)及 UI 报告保留实际差异和审查来源。工具坐标／引号／iframe 定位／captured 基线／进程诊断和自有会话退役等脚本问题也独审修正，原失败保留，未变产品以迁就脚本。

正式树已通过的有效证据分包复用：Session／History／资源／归档／PPTX59项、Projection／IME／状态／文件30项、Office／字体／捕获35项、HTML53项及相关14项，后续字体／Flow15项、默认样式5项、局部消费44项、资源／字段／布局21项、材料／预算33项、AI集中31项、V6 hints6项、Flow／Esc9项、checkpoint alias4项等。数字不跨包相加冒充全仓唯一用例；无 exclude/skip 当通过。旧基线失败和故障注入修正见 [AI_VERIFICATION_TRIAGE](../../../output/unified-edit-performance-20261022/AI_VERIFICATION_TRIAGE.md)及原 JSON，未宣称全仓测试全绿。

最后动态 Blob 包的16项正式树检查、20份内置组件源码闭包重新生成、顺序 Player→Renderer／Main 生产构建、两套完整类型检查均通过；PM完成键正式树9项、checkpoint精确共享4项通过。闭包数量是生成产物数，不冒充用户用例。新测试载体的必填字段已按实际合同补齐并独审，无产品类型放宽。一次依赖构建错误（并行 Renderer 早读 Player 产物）已改顺序执行，原日志保留，不因此修改软件。

V1 选择交接的正式树检查另有 [ObjectClick／NestedFocus 8项](../../../output/unified-edit-performance-20261022/verification-flow-selection-final.json)、[迟到 revision 的2项挂载反例](../../../output/unified-edit-performance-20261022/verification-field-owner-final-after-fixture.json)和 [字段右键命中及原入口16项](../../../output/unified-edit-performance-20261022/verification-right-pointer-final.json)，均通过。最后 [失焦观察及保留路径6项](../../../output/unified-edit-performance-20261022/verification-observed-selection-final.json)包含前述2项和新增4项，不能再相加；15项无关过滤用例不计通过。两迟到通知反例在旧树真实失败；首次新树非空选区的 EditorState 身份断言失败，经独审和事务探针确认只是现有 pin 装饰的纯 metadata 更新，仅改为文档／选区语义保持检查，未为测试改产品。DOM观察反例使用真实 PM DOMreader／DOM selection；一次 JSDOM 缺 Range 几何，仅该 fixture 委托既有滚动入口，未改正文、选择或外部通知断言。[原生换图／恢复与程序对照3项](../../../output/unified-edit-performance-20261022/verification-native-image-source-final-after-fixture.json)正式树通过，8项无关过滤不计；首次两个 Source fixture 的未知业务键不符合既有专业 schema，仅换合法 alt/crop 后保全部对照断言，未改产品/schema。最后 Renderer [完整类型](../../../output/unified-edit-performance-20261022/typecheck-native-image-source-final-renderer.txt)与[生产构建](../../../output/unified-edit-performance-20261022/build-native-image-source-final-renderer.txt)均 exit0，之后只改 fixture；未变的 Player／Main 证据复用。

## 覆盖与交付状态

原 F01–F20、T1/T2、A01–A14 和13域127项继续按统一总方案§9逐项承接；127是定位清单，不是127项必须无条件改代码。本轮确定主线、实际触发修复、保留成本与条件项分别列明，旧缺口列表不重复立项。[独立覆盖分类](../../../output/final-coverage-draft.md)为中途审查快照，后续以本文实际结果覆盖状态。

本轮确定主线和实际触发修复已完成，最后 V1 Flow 图片交叉接线完整通过，未重跑其它有效证据。条件专项和真实保留成本仍按本文披露；Owner整体接受及发行未签，本轮无commit／push／发布。原执行中报告完整备份于 [历史快照](../../../output/unified-edit-performance-20261022/IMPLEMENTATION_RESULT.before-final-rewrite.md)，旧失败、作品和profile均保留；自有QA应用已退出，精确会话的官方close回执保留。

