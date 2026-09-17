# Flow 与教学文档共用编辑能力实施方案

日期：2026-09-15；状态整理：2026-09-17。**本文件保留 040–051 的实现边界与分项证据；上轮有限收尾已结束，050/060 未完成。当前先实施[教师可用性与前端专项](R19_FRONTEND_SPECIAL_IMPLEMENTATION_PLAN.md)，不按本文历史将来时重开整批。** 有效证据与缺口见第 4 节及[有限收尾记录](reviews/2026-09-17-r19-limited-closeout.md)；046 与 Word 证据见[首批实施记录](reviews/2026-09-15-r19-shared-document-contract.md)。工程检查通过不等于节点全部完成或 Owner accepted。

入口与布局更新：工作空间允许无项目会话，项目为可选真实文件夹；旧固定三栏、强制课例和简洁／专业模式由前端专项替代。本文的唯一正文、保存／恢复、阶段确认、三格式消费和工程事务边界仍有效；新身份接口以 F01 实施时同步的 strict 合同和 consumer 为准，不把设计当成代码已实现。

## 1. 结果与已确定边界

教师先选择真实工作空间，再命名并创建或打开独立课例。在同一工作台中整理材料、编辑真实教学文档，与 AI 共改并生成/修改课件；Flow 是连续正文，文字和公式混排，默认直接编辑排版结果，按需切源文。首期 Word 数学导出保持结构化、可继续编辑。

| 决定 | 来源及执行结论 |
|---|---|
| Flow 连续编辑、右侧教学文档复用、Word 数学整体纳入 1.9 | Owner 明确选择；均为本版必选验收范围 |
| 首期同步完成可编辑 Word 数学 | Owner 明确选择；浏览器显示与 Word 结构编辑分别验收 |
| 不保留任何兼容边界 | Owner 最新明确；直接采用统一新 Flow 正文与新课例模型，不承担旧工程、旧 AST、旧会话/缓存兼容或迁移 |
| 原始材料支持 PDF、DOCX、PPTX | Owner 已确认；各类实际读取和创作消费，不能互相替代 |
| 真文件、连续对话、AI 直接改稿并标记/可撤回 | Owner 已确认；文档保存与工程保存各有唯一归属 |
| 文档默认排版编辑/按需源文，有限数学集合、自动保存和源文扩展 | 在持续收敛授权下采用配套合同的明确默认值；不再留给不同开发节点各自选择 |

V9 与 Published V2 名称、三 Surface、唯一工程/资源/History 和原生 CLI 分工保持。本次 Flow 目标域可直接变更严格结构；这不是任意删除其他 Surface 能力或另造通用 Agent 平台的授权。Runtime 位置编辑与持续 AI 深化仍属长期路线。

## 2. 两份可直接落地的合同

- [共用正文、源文与数学合同](R19_SHARED_DOCUMENT_CONTENT_CONTRACT.md)：唯一 inlines/LaTeX 模型、所有正文承载字段、选区与稳定身份、Markdown 扩展、资源映射、有限数学输入/OMML/实际 Word 样例及生产器/消费者切换。
- [课例、真实文档与共编合同](R19_LESSON_DOCUMENT_WORKSPACE_CONTRACT.md)：首次进入、命名建课例、左侧导航与右侧标签、真实四阶段文档、身份/首存/另存、文件接口、外部冲突、选择性撤回与当前稿确认。

两份文档规定实现目标，不宣称当前源码已符合。源码与生成物在对应开发节点同步，工作协议的工程验证和教师验收继续分开。

## 3. 共用实现与选型

正文核心共用内容规则、选区、输入、格式、数学、源文转换和只读呈现。Flow 连接既有工程事务，保留纸张、宽度、媒体/组件、导航与浮层；真实 Markdown 连接文件编辑 Owner，正文仍在课例磁盘文件中。两者不嵌套历史，不同时维护库 JSON 和产品正文两份真相。

| 部分 | 本次确定的实施路线 | 首个开发验证 |
|---|---|---|
| 排版编辑 | Tiptap / ProseMirror，产品自定义节点和命令适配 | 中文输入法、跨段落/公式选区、光标和撤销；不以库默认 history 接管工程 |
| 源文编辑 | CodeMirror 6，固定版本的 cw-markdown-v1 方言 | 源文/排版往返、身份/格式/对象保持、错误定位及恢复 |
| 数学 | 复用046有限语法、派生结构与OMML，KaTeX负责浏览器呈现 | 九类数学Word结构编辑已有证据；新接入只补浏览器及真实Flow导出路径 |
| Markdown codec | 以046已验证的Marked产品映射接入连续编辑器 | 用同一完整样例检验实际编辑器往返；出现保真或维护障碍才评估替换，不新增第二套持久正文 |

依据：[Tiptap 数学](https://tiptap.dev/docs/editor/extensions/nodes/mathematics)、[Markdown](https://tiptap.dev/docs/editor/markdown)、[CodeMirror](https://codemirror.net/docs/ref/)、[KaTeX](https://katex.org/docs/options)。046 已固定并验证 Marked 17.0.6 与 entities 8.0.0 的产品 codec 适配；编辑器及浏览器数学库在对应 consumer 接入时验证，详见首批实施记录。不能把选型建议当性能或保真证据。

## 4. 剩余范围与滚动批次

2026-09-17：此前[产品可用性方案第 7 节](R19_PRODUCT_USABILITY_IMPROVEMENT_PLAN.md#7-常规任务完整链路与效率收敛)的三批已由 U01–U10 完成工程实施，见[执行记录](reviews/2026-09-17-r19-usability-execution.md)。不再按“尚未实施”派发。当前先完成前端专项；之后 050 只补相关组合与既定缺口，已有证据按依赖变化复用，不反复重开已通过课例。

2026-09-16 最新授权批次见[产品可用性改进方案](R19_PRODUCT_USABILITY_IMPROVEMENT_PLAN.md)。该方案接续下文冻结的样例诊断，取代此前讨论暂停期间的建议未实施/预算不擅改边界；既有通过与失败记录不改写。 本轮A–D已完成工程实施与受影响验证，见[完成记录](reviews/2026-09-16-r19-product-usability.md)。

2026-09-16 Kimi review 时曾发现 E 公开不支持状态分支、跨位置名称误判及 G 反馈接线缺口，形成[产品可用性方案第 6 节](R19_PRODUCT_USABILITY_IMPROVEMENT_PLAN.md#6-refg-批次首次选路原因驱动恢复与真实结果验证)的 R/E/F/G 设计基线。随后已实施和真实验证的范围见该方案第 5 节及下文证据，不能继续把当时“尚未实现”作为当前事实恢复整批工作。已有通过、失败及人工干预记录保留，后续按最新第 7 节完整链路收敛，不降低050/060既定结果要求。

1.9共13个路线节点。040–049、051的实现与直接consumer已按精确写域持续集成，050正在补真实组合；060版本收口尚未完成。各节点的已有证据与剩余缺口逐项记录于第4.2节，不以首批046或一次组合通过推算整版完成百分比。**范围和进度摘要维护在本方案**；queued/active/blocked只看任务板。其他入口引用这里，不另存一份当前进度。

正式依赖和必选验收仍以[1.9路线](roadmap/1.9/README.md)、manifest与独立规格为准。以下批次是交付分组，**不增加全员等待关卡**：前置接口和写域就绪就接续，不等同批无关节点；已授权实现、修复及批次接续不逐节点重新询问。稳定窄接口后的独立叶子可提前准备，整节点完成仍须真实接线与验收。

| 批次 | 节点与执行次序 | 可观察交付与接续点 |
|---|---|---|
| 一：课例与编辑底座 | 040→042与047并行；051独立推进 | 真实课例/对话及首存归属成立，共用核心可输入和撤销；047接口就绪即准备048，042接口就绪即准备041/045。051未结束不阻塞这些工作 |
| 二：工作台和真实文件/Flow | 041与045按写域并行；048接047；049接042、041、047 | 真实Markdown可编辑保存，新Flow可编辑/保存/播放/导出，三类材料各自读取；049不等048完整导出，048不等材料和双流程 |
| 三：完整创作与接续 | 044接042、045、049；043接044及记录/材料接口 | 自动消费成功读取的材料，手动四稿确认绑定当前文件；压缩、重启、切CLI接续不重放旧任务 |
| 四：组合修复和版本收口 | 050汇合040–049；060等待050与051 | 在真实课例补组合证据、关闭实际核心问题、形成同一工程候选；发布动作按既有授权规则 |

### 4.1 可并发的实际写域

起始安排课例、编辑器、PPTX三条开发线，由唯一集成人接管共享改动。集成人可兼做一条线；有更多已稳定、互不重叠的叶子且能减少总等待时再增加执行者，不为占满并发数额外拆包。

| 开发线 | 可分配的独立工作 | 共享改动及依赖 |
|---|---|---|
| 课例与文件：040→042→041→049 | 040记录repository/service；042身份与目录；041导航/标签容器；049文件I/O与共编，按前置接续 | 任务/身份合同、App/Chat、IPC和工程保存入口由集成人接线 |
| 正文与Flow：047→048 | 047新共用编辑UI/适配模块；048在稳定正文接口上分配编辑命令、Player呈现、DOCX/print叶子 | 共用正文合同、V9/Published根Schema、工厂/工具合同、共享History和根切换由集成人负责 |
| 材料：045 | 042身份/材料引用接口稳定后，材料repository/service及PDF、DOCX、PPTX提取适配可与042剩余生命周期工作并行 | 材料合同、IPC/preload、UI入口、发现生成物顺序集成；真实课例接通和创作消费仍为完成条件 |
| PPTX：051 | PPTX导入媒体/效果映射、Slide与适用导出 | 与045共用的pptxPackage.ts、pptxImport.ts只由一个writer修改；与042/048共有保存入口由集成人修改 |

开工时将候选写域落实为**精确文件清单**再分配。以下共享实体文件只交给唯一集成人：App.tsx、CourseChatPanel.tsx及共享样式，ipcTypes.ts/main ipc.ts/preload入口，workspaceIdentity.ts/localAgentTaskContract.ts，useCourseProjectLifecycle.ts等保存入口，正式根Schema/公共工厂/共享命令与History，package.json/lockfile和生成索引。独立命令实现可分配，但不能由两个执行者同时修改同一命令文件。路线粗锁只按当批实际文件和时段持有；同一粗锁由一个协调Owner持有并分配非重叠叶子，不创建争用同锁的active卡。

多执行者写入使用隔离worktree/分支；共同基线须包含本批依赖的046实现及已授权未提交改动，不能从缺少这些内容的HEAD直接开工。集成人只携带相关改动，保留其他用户修改，不以清空工作树建立基线。依工作协议只为真实并发协调建必要卡，不预建12张卡或新锁平台。

共享改动及时顺序集成，为同一候选集中准备制品与验证。041只负责容器，049负责编辑，044负责阶段；047先交付真实UI验证过的核心，不反等049文件集成。048可并行准备叶子，但正式根Schema与全部直接producer/consumer必须在同一可运行批次切换，删除旧Flow writer并接通保存播放/导出后才开放新写入口，半成品不能成为可运行基线。

### 4.2 当前实现、有效证据与剩余缺口

截至2026-09-16，本轮多数040–049/051直接消费及已定位产品修复已有证据。**当前按Owner纠正停止样例付费重试；六轮日志审计已完成。样例revision23及全部失败冻结为诊断事实，不以反复修绿样例为目标。050/060未完成，2.0未启动。** 静态校验前移、导航说明、Spatial取景、Published修复及 E/F 工程增量已有各自证据；最新缺口是首次按能力选路、已知失败分支排除、原因驱动恢复及 G 播放反馈。先按产品可用性方案第6节闭合这些入口和行为，再启动三通道自然任务；旧聚焦测试不证明首次路由已完成。当前只更新计划，不把待实施事项记作通过。

| 节点 | 当前有效证据 | 边界与当前状态 |
|---|---|---|
| 040 记录与删除 | 真实Electron导航/搜索/分支与三范围删除；MD、工程、附件及恢复稿保全，删后新conversation继承已存target，52.6秒（output/r19-conversation-navigation/2026-09-15T09-49-51-170Z） | 复用有效结果；不将导航测试扩成所有CLI生命周期证明 |
| 041 工作台 | 工作空间、目录/材料/文档/课件标签；原课例delivery包含真实760×900窗口、简洁/专业切换及完整导航 | 已有真实组合，不再把旧组件截图作为唯一证据 |
| 042 身份与保存 | 真实首存保留lesson/conversation，Save As独立target；独立副本唯一新conversation、材料重绑，关闭移动重开31.9秒 | 取消/失败/迟到目标按Owner反例保全；早期丢失的未保存空工程曾经明确授权由新target承接，不称旧身份恢复 |
| 043 长任务接续 | 真实compaction后教师改正文→同原Codex thread恢复→同conversation切OpenCode改文；共3个native task，最终精确单句替换并保留教师段和其余文件 | **修复接续已通过**；首次OpenCode额外改一字失败保留，非clean first pass。证据见4.3 |
| 044 双流程 | 原自动四稿/Builder最终保存，重开/双预览/HTML 1项2.3分钟；原手动四份当前文件分别确认，正式保存后delivery自动操作1项1.5分钟，后续视觉/路径修复已保存重开 | 原两课例研发恢复已闭合；普通教师新链仍有真实机制失败，见4.4 |
| 045 材料 | 实际PDF/DOCX/PPTX分别提取/原图读取/来源定位，删除外部原件后可读，48.9秒；手动PDF/PPTX电路事实被采用；扫描PDF19.4秒及独立副本材料读取通过 | 原自动DOCX蓝色块误读曾经纠正，不计图像语义首遍正确；字节读取不等于模型理解 |
| 046 合同/数学 | 新Flow根Schema及直接producer/consumer统一inlines/LaTeX，旧正文writer删除；67项首批检查与九类Word结构试改保持有效 | V9/Published V2，无旧格式迁移；后续只验证实际变化 |
| 047 共用编辑 | StrictMode/核心/恢复、真实跨Owner图片/callout→MD保存重开→Flow一次Undo；最新表单/DOM选区修复后共用及文件编辑消费17/17（r19-final-shared-editor-focused.log） | 不扩为所有复杂对象/选区；完整Wave C已通过 |
| 048 Flow交付 | Word16 COM得到12个可编辑OMath，分子U→V保存重开仍12；组件capture/DOCX与属性转换通过；**完整Wave C 1/1、1.1分钟**：格式/公式、一次Undo/Redo、两次真实archive保存、重开、两个预览入口、媒体换源/题注/三层几何及零console错误 | output/r19-wave-c-complete.log；最小4媒体URL与实际字节消费10秒通过，不再列为待验 |
| 049 真文件共编 | 实际外部冲突/reload、相对PNG/MD保存重开、真实Luna文件编辑及教师修改后选择性撤回保全；重开/选择性撤回29.3秒 | 空edits、恢复稿冲突及额外改字等首次失败保留；043最终精确改文已补组合 |
| 050 组合验证 | 原双课例、既有工程机制修改、手动修复、043、Flow/Word、PPTX及工作台组合证据复用；最新Player按钮经原样课件重开和离线HTML通过 | **未完成**：revision23冻结不返工；新有限教师编辑首任务7.27分钟提交1→2，但有图示/跳页/解释内容错误，修正4.34分钟只预检未交付。根因及产品改善已记录，不把模型失败改称整链成功，见[最终记录](reviews/2026-09-16-r19-final-closeout.md) |
| 051 PPTX媒体/效果 | 媒体9项+diagram8项；真实WebM/WAV导入→canonical/Undo→保存重开→离线HTML播放/跨页停播；PPTX结构编辑/保存/离线Player4项 | 已支持媒体/简单效果证据有效，不扩为复杂时间线；仍与050分别验收 |

### 4.3 已通过组合与必须保留的修复历史

- **原自动与既有工程机制：**原profile在output/r19-authoring-luna/2026-09-15T08-47-28-467Z，revision52/4locations交付通过（r19-auto-original-delivery.log）。后续B“重新预测”正式candidate已提交至revision53，真实retry、一次Undo/Redo、保存重开已通过；原生保存modal曾阻塞主进程，仅取消modal后在同进程保留History继续，证据output/playwright/r19-existing-mechanism-3/r19ExistingMechanismLuna-r-afaba-it-one-Undo-Redo-and-reopen/evidence内same-window-postcommit.json与saved-reopened.json。早期Buffer/global/rule.id/新正文合同等内部协议提示、模块教学缺口及修复仍保留，不能把这条研发恢复算普通教师首遍成功。
- **原手动课例：**output/r19-manual-luna/manual-parallel-20260915-170551内四份真实文件分别确认，原profile应用保存revision33；原始嵌套列表、错误恢复稿、空edits、标题污染教师干预、Builder素材归属/rule.id拒绝均保留。delivery第七次自动操作通过后，截图发现白字浅底及清除后L1路径不完整；同原课例正式提交33→34，经恢复保存重开，两处已修。7按钮对比度13.503:1、完整L1/L2路径与6采样点及推进通过（output/r19-manual-contrast-recovery/result.json、structural-preservation.json）。该native反馈因测试误用“保存”而非“保存（Ctrl+S）”后teardown中断，不称自然全任务终态，也不与自动反馈ack问题混同。
- **043已闭合：**真实压缩事件76562363之后，教师手改、重启、同原Codex thread resume成功；随后OpenCode文件AI首次额外将“与”改为“和”，自然修复后全文精确等于原单句要求加教师段，其余文档及工程不变。3个native task的timing/usage和边界顺序保留于output/r19-continuation-final-summary.json、r19-continuation-boundary-timeline.json、r19-continuation-file-ai-result.json；修复例1/1、2.4分钟。记录修复接续通过，保留首次失败，不重做已完成步骤。
- **材料与目录：**扫描PDF此前页面PNG可用却被无文字gap阻断，现只在所选同页图片实际读取且PNG完整解码成功时满足typed read-page-image前置，19.4秒零模型UI通过；不称模型理解。副本最初材料lessonId仍属旧课例且产生双对话，修复后原文件保全、新lesson唯一conversation、真实材料读取、关闭移动重开31.9秒通过。证据output/r19-scanned-material/2026-09-15T10-47-53-389Z与output/r19-lesson-copy-move/2026-09-15T11-02-06-596Z。Windows运行中目录EBUSY与前序失败不改写为首轮通过。
- **共用正文与资源：**Wave C暴露并修复公式form被工具浮层遮挡、DOM折叠选区未同步PM、恢复会话fence重用、等值MIME对象引起blob URL整批撤销。恢复根因是main永久retire[path,authoring epoch]，Undo/Redo后New→Open raw epoch回0复用；hook改每activation UUID fence并隔离过期失败，main retired不放宽。App恢复副本失败提示但不阻断可验证的手动工程保存，lesson文档/无效草稿guard保留。URL由同Owner按真实字节/MIME复用并通过consumer租约持有代际。最终完整Wave及URL实际消费均通过；全部失败日志保留，不把静默保存失败误归为mtime或另一轮首次文件权限错误。Flow WYSIWYG亦已1/1、39.9秒通过（r19-flow-wysiwyg-verified.log）；活动草稿保存56.8秒的原实际tool报告有效，其原目录后被别例覆盖，不因目录命名重跑。
- **当前集成证据：**完整Vitest原始结果保留为414文件407通过/7失败；4051项4023通过/13失败/15跳过，440.04秒、exit1（r19-final-integrated-unit-suite.log）。7失败文件随后按根因由repo-index26、architecture6、Flow21、benchmark13项聚焦闭合；未变化的407文件证据继续有效，不把原整轮改称全绿。另有runner/capabilities/harness87、File AI replacement14、交互Schema28、生命周期18、字体18、双预览网络1、图片副本重开1等有效结果；三套tsc、contracts、roadmap、capabilities和desktop构建分别回链实际版本。repo-index仅修文档稳定锚点，属维护维度。Windows能力目录发布EPERM发生于预启动、零native task；窄修后32项、Electron build（r19-capability-publish-electron-build.log）及真实后续启动通过。

<a id="44-043--050--060验收边界与当前候选缺口"></a>

### 4.4 050 / 060当前剩余范围与验收边界

**最新：原电路课例三处修改闭环已通过，050 完整代表链仍未完成。** 当前导航事实与未改规则已由正式 Player 序列投影进入请求/观察。Luna Fast 两任务分别 329.347 / 366.145 秒，合计 695.492 秒；一条普通视觉 QA 反馈后，模型在原任务自行修正颜色区间。最终三个起点单击直达 Flow、灰/黄灯泡、延后解释、保全、保存重开与离线 HTML 通过，0 导出 errors、8 warnings、17 infos。首轮视觉失败、9 条显式非零命令退出和一次保存访问失败后重试成功保留，未人工修改候选。详见[本批记录](reviews/2026-09-16-r19-navigation-facts.md)。下一步补从材料与四稿开始的完整普通教师代表链及其他真实剩余缺口，不重复已通过导航；060/Owner accepted 不晋升。

**2026-09-16 前轮补验未通过。** 原电路课例 revision 2 的独立副本完成两个 Codex/Luna Fast 任务（525.716 / 125.358 秒，各一次提交），包含首任务缺候选后的同任务恢复及重启后一条普通教师 QA 修正。灯泡灰/黄变化、延后解释、一次 Undo/Redo、保存重开、同原生会话真实接续和离线导出通过；解释裁切消除，但字号警告保留。实际三起点点击表明“进入实验记录”的 step.next 只在观察后状态进入 Flow，初始/闭合状态失败。详见[接续验收记录](reviews/2026-09-16-r19-050-circuit-continuation.md)。无内部协议提示、人工候选修改或本轮产品源码变化；同因付费重复已停止，050/060 与 Owner accepted 保持未完成。下列旧失败与证据不覆盖、不重算。

**当前普通教师代表链未通过。** output/r19-current-teacher-luna/20260915-current-unified保留软件内自然语言自动生成及修复。首轮五阶段驱动57.4分钟，未满足该例30分钟目标；revision19虽有Slide/Flow/Spatial，真实机制失败。随后一次实际Luna high Fast任务于21:49:03–21:51:33运行，正式committed19→20并保存、同profile重开，但任务仍为partial-after-observation-host-unavailable，不能称完整终态。

实际保存重开后的QA仍失败：Slide正确预测后操作按钮不解锁、未完成解释即可跳Flow；Flow缺记录输入且仍旧单灯机制、按钮白字白底；“进入无限画布”操作未证实进入Spatial。证据为high-repair-2026-09-15T13-48-45-124Z/qa/saved-reopened-behavior.json（相对上述teacher目录）。首次high的EPERM预启动创建零native task，publisher修复后才创建这一个high task，不混算模型次数。

第二次high先混用v1/v2被拒，自修格式后又因Flow实例未挂载被dynamic-host拒绝；最终只提交Slide并正常结束、保存重开至revision21。实际behavior-check仍exit1：生成section未挂入ctx.dom.root，固定frame使空框通过准入，预测/操作根本无法开始；Flow/Spatial未修。证据为同teacher目录high-repair-2026-09-15T14-10-25-802Z/saved-outcome.json、saved-reopened.json及qa/behavior-result.json。该Luna profile已关闭。空白准入已修：dynamicInstanceContent保守复用PNG，只接入full-admission Component；空白拒绝诊断dynamic-component-empty-content明确ctx.dom.root，工程/资源/History零写入，text/background/border/pseudo/canvas通过。9项unit及真实六分支1项19.8秒通过（output/r19-empty-component-admission/e2e-final.log，证据目录2026-09-15T14-45-44-836Z）；ROOT已看pseudo/canvas截图。前两次仅setup/listener失败日志保留，main/renderer/capabilities构建及E2E类型检查通过。此为准入修复，不代表rev21空白课例已修。app-server交付说明已修正helper v1与手写v2边界，33项通过（output/r19-candidate-format-guidance-tests.log），不把尚未加载该main说明的本次高任务当消费证据。

跨页真实观察已闭合：r19CrossPageObservation.spec.ts同一命名用例1项21.7秒通过（output/r19-cross-page-observation/e2e-after-teardown.log，成功目录2026-09-15T15-00-06-256Z），真实三Surface原子revision1→2、History0→1，原Slide保持活动并取得current观察PNG。此前90秒timeout发生于app.close的未保存副本原生对话框，captureNext及全部断言此前已通过；仅修测试finally销毁本app窗口，不是产品capture/Main挂起。

Claude失败的只读诊断已确认反馈staging生命周期缺陷：新root e51b15cf不存在，prompt/env却宣告可读；事件1354拒绝后，1357/1360/1374指向不存在root，不能归因为manifest/schema宿主误拒。根因是create已完成后persist→active登记窗口被list清理；harness.ts现保护起始及当前active/launching root，原prepared/pending语义不扩大。确定性race反例修前ENOENT、修后通过，同native外部session/期限保持、材料与capabilities实际read、idleStop仍清根；6项命名生命周期检查与main tsc通过（原会话工具报告），ROOT review及main build通过（output/r19-feedback-staging-electron-build.log）。第二次同Claude session复测已证明反馈root与材料可读；整个任务仍deadline失败，详见下述分项证据，原失败保留。

第二次DeepSeek复测（claude-deepseek-repair-2026-09-15T15-13-31-269Z）复用external session 0bf…，task7e87…于23:34:07 deadline failed、0commit，driver21.2分钟1failed，正式保存重开仍同project revision21空白。首候选17a7…共13步，对component layout-d16误用native.content被正式拒绝；当前能力已有正确工具，这是模型误选。反馈配置后约7.5分钟无native输出，单列为模型等待；末13步helper prechecked未赶上第二提交。

反馈root race已真实闭合：新root2e88…持续存活，native seq740/741于23:27:47实际read+parse request（aliases56）及component.configure卡成功，证据first-feedback-native-request-read.json。原auto探针从lesson索引镜像scope取root形成假阴性，保留原记录及first-feedback-root-corrected.json，不称产品缺文件。修复输入复用已实现并经ROOT review：generationRepairInputs.ts仅接纳匹配current task/epoch/observation/request/candidate的accepted parsed proposal中component.package patch/revise源码，作为新request resourceFiles与索引，明确未提交且须fresh targets/base重新构建。旧request正常清理不再迫使此范围源码返工；不新增Store/持久格式/自动重放或放宽守卫。既有12MiB/1000资源数及160KB最终prompt预算超限时省略可选复用，不阻合法续轮。4项命名检查于23:49:33通过（5.23秒），含真实native.open子进程读新root/request/index/source、full-resources、80KB context+852源码的prompt预算、原staging并发保护及身份/Stop/期限/跨task不复用。main build通过（output/r19-component-repair-inputs-electron-build.log）；初diffcheck的harness CRLF失败保留，恢复LF后output/r19-component-repair-inputs-final-diff-check.log通过。第三次DeepSeek已运行并提交，详见下述事实；本轮未自然rejected，repair-inputs只记工程验证，不人为制造失败或作为独立付费复测要求，也不据此宣称整体提速。

第三轮Claude DeepSeek（claude-deepseek-repair-2026-09-15T15-51-10-360Z，record ffd5998c-0eb2-49a3-8443-93088dbd60b5）使用deepseek-flash[1M] high普通速度，复用native session 0bf3c922…。首候选13步已正式committed revision21→22、覆盖三Surface，afterCommit observe且receipt delivered。后续request5757c887…正式observation revision22，原Slide location仍在，capturedAt1789487909577（2026-09-15 23:58:29.577 CST）；native已实际读取宿主PNG。该任务现已terminal completed，共两次commit21→22→23，正式同project保存、正常关闭重开，命名用例1项19.5分钟通过（output/r19-teacher-deepseek-repair-inputs-run.log）。实际Slide/Flow的预测、操作、断点灯状态、错误解释及记录门禁已通过，但Slide→Flow与Flow→Spatial两个学生按钮失败：生成源码把非Slide location传给goToScene，正式nextScene已有跨Surface支持。Spatial默认视角出画，下游机制未执行；持久化camera home/frame 0/0/1未对准world完整bbox约x80..1200、y40..660，宿主正确应用camera，并非宿主投影缺陷。全部旧失败与耗时保留。

rev23真实GUI导出成功（output/r19-teacher-final-export/export-result.json），离线三Surface挂载及Slide操作通过、0error/0external；Spatial同样出画，因此只证明导出carrier，未证明课例整体质量。导出QA的no-match/manifest绑定、首页无打开按钮、折叠sidebar及误把button choices当select等假设失败保留，最终复用已成功HTML继续检查，没有重复导出。

第四目录claude-deepseek-repair-2026-09-15T16-34-36-660Z仅prelaunch44.8秒失败，0新record、0模型，不能记第四次付费task或配置成功。第二次prelaunch又26.9秒失败、0模型。同原profile实测工程9.730秒可见，CLI会话51.733秒才可见，确认为历史加载等待，不是partial或入口丢失。14records约24MB、54分页每次全量list导致重复读取；repo/harness/service定向read修复9项命名检查与2套TS通过，Terra独立审查无阻断，ROOT main构建output/r19-history-read-electron-build.log成功，同原profile实机复测通过：工程9.355秒、会话13.365秒（工程后4.01秒），对比旧9.730/51.733秒；同project revision23未配置/发送，profile已关闭，证据history-loading-after-targeted-read/summary.json。该加载改善不能解释或抵消随后模型创作超时。最新capabilities/typecheck通过（output/r19-candidate-final-capabilities-check.log、r19-candidate-final-typecheck.log）；免费完整Vitest228.03秒仍红：415文件407通过/8失败，4081项4066通过/14失败/1跳过，失败为timeout/EBUSY/ENOTEMPTY，无业务断言失败。14条单worker聚焦定位13项通过，仅Builder Vite cache Windows ENOTEMPTY清理复现；courseware-builder-v2-host.ts在既有路径校验下为fs rm增加bounded maxRetries8/retryDelay100，资产reader命名集成1项30.31秒（test27.75秒）及scripts tsc通过。证据为output/r19-candidate-focused-gate/vitest-focused-summary.txt、asset-reader-reverification.log、scripts-tscheck.log和output/r19-candidate-after-builder-diff-check.log。原完整单测不能称全绿；保留此前完整红轮，不裸跑verify或付费矩阵。

第四次实际DeepSeek（claude-deepseek-repair-2026-09-15T16-55-37-913Z，record adbe5762-be04-4d28-b671-b7708c3bf2a3，task d6089d77-f82e-417f-8a32-965fd9dad16c）同external session、high普通速度，20分钟deadline failed、0commit，driver20.8分钟failed，正式保存/关闭/重开仍同project revision23。首5步候选01:11:38.820 prechecked，01:12:46.989实际输出result；ROOT运行中发现Spatial错误预测验收原先镜像实现、不符合四稿，正式GUI补充seq233于01:05:14.413 queued，seq1101于01:12:47.033 consumed。同task/epoch0/原deadline的既有pending-input语义删除旧candidate.json并要求按当前输入重新交付，draft/source当时仍在，不是宿主丢候选。随后两次Spatial Edit，末次01:15:47.098，无二次precheck/交付，seq1199于01:16:02.878超时。成本同时包括模型首回合准备与ROOT验收要求晚对齐后的接续返工，不能只归责DeepSeek或平台。run-assessment.json保留精确时序；retention/bounded-review-summary.json及inventory.json确认终态root/draft/两个源码目录已清理，仅有原始工具事件，不手拼代码。没有新revision，不重复已知不变的整套QA；导航/Spatial缺陷仍在，未自动开始新付费任务。

### 历史归因与已授权的产品改进

[2026-09-16失败归因报告](reviews/2026-09-16-r19-ai-failure-attribution.md)及output/r19-cross-run-log-audit/REPORT.md、findings.json已完成六轮有界原始日志审计。三轮有commit、三轮提交后实际QA仍失败；这不是模型胜率或公平性能对照。以下归因记录保留，讨论暂停后的实施以[产品可用性完成记录](reviews/2026-09-16-r19-product-usability.md)及[最终组合验证](reviews/2026-09-16-r19-final-closeout.md)为准。

- **同源静态校验：**D1 seq312错误manifest options→548 prechecked→host prepare拒绝；D2 seq161 native.content误用Component目标→164 prechecked→host prepare拒绝。静态可知错误反馈偏晚，但deferred=[]不表示全验证，不属于预检承诺违规。当前已复用正式schema和冻结目标描述前移这两类检查，没有复制live resolver/Store。
- **导航消歧与真实host目的地验证：**D2 seq137、D3 seq88自测把goToScene无条件返回true，只能覆盖局部调用，不能证明真实跨Surface导航；不指控故意造假。优先明确Slide sceneId与Flow/Spatial locationId及已有顺序推进能力的边界，用正式host验证目的地。
- **Spatial正式取景已实施：**复用现有fit Owner，经 `spatial.structure fit-world-content` 唯一事务更新持久化home/进入镜头，已验证world可见范围、保存重开及真实宿主，不自动改布局。旧revision23仍保留失败状态。
- **验收与生命周期边界：**独立教学行为QA继续放在既有2.0范围，模型内容失败保留。已按Owner授权实施可选预算/显式延长、独立停滞检测和原生即时纠正；没有跨task自动重放或自动开启新付费任务。050/060只按最终实际组合证据裁定，不由工程检查自动晋升。

050 §3/4/6既有证据的实际范围如下，不因缺少逐项索引重跑：

| 属性 | 当前证据与限制 |
|---|---|
| 串行补充输入 | 原manual真实OpenCode记录3255747e-accb-4a56-918b-38a8facaeb6a.json中同一task两轮completed，输入d44c0897…从queued转consumed；r19-manual-native-supplement-result.json为正式Electron lesson-input IPC回执。证明原生同任务排队消费，未声称键盘发送或多个独立任务并行队列。 |
| CLI故障后人工可用 | 原mechanism的live-record.json记录native failed、host committed52→53；同目录same-window-postcommit.json与saved-reopened.json证明随后人工Undo/Redo、保存重开成功。此为真实任务失败/停止后的人工可用，不等于独立断网或CLI卸载测试。 |
| 局部/主聊天同能力 | LessonConversationChat复用CourseChatPanel，selection/page引用共享controller；courseChatPanel与generationSelectionActions有目标冻结/选区单测。新增真实GUI零模型1项25秒通过：selection/page冻结目标与相同Luna配置，捕获正式generate请求；证据output/r19-chat-scope-qa/2026-09-15T14-32-35-925Z/frozen-formal-generate-requests.json。此为GUI到正式请求接线，不是原生模型执行。 |
| 三CLI本版差异 | Codex与OpenCode已有本版真实Luna链；三份2026-09-15T08-52-48-144Z/native-directory为原生目录实读，Claude无Luna的历史事实保留。用户仅授权Claude+DeepSeek，其他通道仍Luna。Claude本版第三轮已以deepseek-flash[1M] high普通速度completed，19.5分钟、两次commit21→22→23并同工程保存重开（r19-teacher-deepseek-repair-inputs-run.log及15-51-10-360Z/engineering-result.json）；Slide/Flow部分机制通过，两个学生导航与Spatial默认视角失败，不能称三CLI全部验收完成。前两DeepSeek deadline失败/0commit及旧Claude1.8基线均明确为历史证据；两次prelaunch为历史零模型失败；第四实际DeepSeek20分钟deadline failed/0commit，driver20.8分钟，同工程仍rev23；模型准备与ROOT晚补验收造成的接续返工共同计入成本。 |

完整路径、事件范围及证据层次见coverage.currentAcceptance.lifecycleEvidenceAudit；未新增测试或付费矩阵。

[050](roadmap/1.9/r19-050-internal-dogfood.md)允许真实QA修复，但不接受隐瞒失败/速度、重写已提交内容或提示内部协议才完成。当前实际模型内容与版本验收缺口保留；目标已转为产品归因，不能因停止修样例自动收口，因此**050未完成，060不能宣称engineering candidate已完成**。

产品可用性方案6.4开测条件后的三通道独立自然任务已完成，原始结果冻结于[自然任务记录](reviews/2026-09-16-r19-refg-first-route.md#自然任务结果)；随后真实 Native 点击反馈等修正及 199.721 秒 Luna 任务见[前批收口记录](reviews/2026-09-16-r19-native-interaction-closeout.md)。原电路目标的导航失败随后通过当前事实反馈修正，并经普通视觉 QA 完成该例三处修改，结果见本节最新记录；完整普通教师代表链仍未通过。首次正确、自动修复、人工干预和最终结果继续分列；新增尝试须先说明能够改变该失败的相关实现变化或可证伪新假设，不再因同一已知原因付费重复。这些窄任务不替代050完整教师目标，后续仅补真实剩余缺口，不扩为CLI×格式×流程全矩阵，不改写旧失败、未执行或人工介入。

[060](roadmap/1.9/r19-060-release.md)要求050/051和所有必选结果、当前候选验证与源码一致，并明确CLI范围及2.0未验项。package verify隐含历史三CLI付费矩阵，不能裸跑突破Luna约束；已有效全集及聚焦证据按变化复用，未匹配日志不自动等于失败或重跑要求。逐case范围见output/r19-candidate-case-coverage.json；原枚举175项/66文件仅说明可发现，不等于175项全通过。候选源码标签仍需发布授权；本轮未提交、未建标签、未签accepted。**2.0尚未启动。**

## 5. 限制设计与调研成本

1. **下一步必须改变实现或结论。** 只读目标合同、直接producer/consumer及对应测试；足以决定边界就实现，不重复通盘调研或另写一份执行方案。
2. **接口随真实接入收敛。** 046保存/AI端口是候选窄接口，047/049消费时可调整内部参数和错误表达并同步直接consumer；不围绕类型建设通用服务框架、第二Store/History或适配平台。既定保存语义保持。
3. **复用当前有效实现。** 上批Tiptap无扩展默认解析的探查不能证明定制接口不可用，也不为补选型论证重做库比较。实际编辑接入发现当前codec存在保真或维护障碍时，才用既有完整样例比较有望解决问题的方案；不长期保留两套正式codec。
4. **只交付已定范围。** 不新增旧格式兼容、复杂PPTX时间线、通用OS沙箱、性能平台或长期路线任务；不削减三格式材料、四阶段文件、数学、三Surface和适用导出。
5. **文档只保留必要事实。** 本方案维护批次安排与进度摘要，节点规格维护结果和独立验收，路线/总纲链接入口，实施记录保留证据；不上新看板、评分表或重复进度台账。只有新证据要求改变产品能力、保存语义或质量取舍时才交Owner决定。

## 6. 最小充分验证与证据复用

遵循[工作协议](WORKING_PROTOCOL.md#4-验证选择)：最小指足以发现可信失败的最少成本，不按命令数或测试条数机械压缩。局部默认1–3条针对性检查，选择已有命名用例和必要新反例；未执行、跳过、零匹配不算通过。

### 6.1 在能证明结果的层次验证

| 变化/归属 | 最少应取得的证据 | 复用与扩大条件 |
|---|---|---|
| 046纯合同、codec、数学 | 复用67项原范围检查和九类Word编辑证据 | 只改到对应模块、依赖或失败定义时重跑相关用例；后续节点不重复完整跑046 |
| 040/042记录、身份、首存 | 两个同名不同目录课例的隔离/首存/取消/另存/移动/重启链；损坏、写失败、迟到候选在对应Owner层验证 | 共用真实目录/工程夹具；049未接入时不要求先完成文件共编才能交付身份底座 |
| 047输入、选区、撤销 | 一份含中文IME、行内公式、列表/表头/单元格的真实UI样例，操作选区、分段合并、源文切换与撤销；针对性检查身份/资源复制 | 同一混合样例承载多个动作；真实文件/Flow的保存连通分别归049/048 |
| 045三格式材料 | PDF、DOCX、PPTX各一个覆盖目标正文/必要图示/出处的代表输入，证明课例材料独立保存；可信失败在提取Owner层验证 | 同批或050首次用真实流程消费这些材料并回链为045完成证据，不另做格式×流程×CLI全组合 |
| 049文件共编 | 真实文件编辑→外部同处修改→AI改稿→后续手改→部分撤回→重开；文件Owner层覆盖写失败、附件与恢复 | 确定性I/O/合并先做无模型验证；实际AI接线可与044/050共用一次有效课例链 |
| 048正式Flow切换 | 同一新模型混合样例的编辑/撤销/保存重开、两种预览、Player/HTML、真实Flow导出Word混排及结构修改；必要构建证明根切换可运行 | 复用九类数学转换证据，新增Flow到Word出口；数学writer/转换受改动才扩大到受影响类别。打印中间层、对象和资源不能遗漏 |
| 051 PPTX媒体/效果 | 真实样例的播放/暂停/跨页、编辑保存重开和离线HTML；支持与不支持边界明确 | 复用有效PPTX保全证据，只补新增媒体/效果及受影响范围 |
| 044/043/050/060组合 | 至少两份课例覆盖自动/手动、三材料消费、文档/Flow、改稿失效和重启/切CLI接续；按正式范围补三CLI真实差异 | 同一成功链可供多个节点引用。050补组合缺口，不重做逐模块检查；060不重跑同候选已通过的相同套件 |

共用证据须指向同一实际实现和结果，不能以mock、旧模型或局部接口通过代替尚未发生的真实接线。记录端口、身份端口、材料提取、编辑核心先按各自独立验收交付；最终文件/流程consumer组合在049/044/050记录并回链，不把下游最终验收反加成上游开工前置。

### 6.2 明确减少的工作

- 每次小改只运行受影响的聚焦反馈；相关修改收敛、公共类型变动或集成时统一类型检查，不默认每个补丁都跑主TypeScript全检查。
- 构建、fixture与能力生成物按实际变化由集成人为同一候选准备一次；纯文档修改不运行产品build/E2E，确定性生成已完成的检查不紧接同义检查。
- 060规定的版本完整verify保留：当前候选尚无有效完整结果时执行一次，不由各叶子提前轮流执行；同一候选已有完整通过结果则直接复用。最小验证不取消版本保全门。
- Word是本次数学出口验收载体，不把LibreOffice第二渲染器作为发布门。已有Word转换/视觉证据复用，新的实际Flow导出仍须验证。
- 不默认做Hash/字节比对，正文往返看解析后语义。文件并发和当前稿确认确需内容版本时保留版本校验，不误删防止覆盖的机制。
- 真实模型仅用于模型/原生CLI/组合行为，沿现有Luna与Fast授权；不在每个叶子重跑三CLI，不因Fast、付费或必要重跑重复请示。最终三CLI差异仍须有证据，不能用一个通道代替全部。
- 当前证据已证明目标及可信失败路径就停止追加；只因相关变化、新失败、结果含混或正式集成门扩大。换审查者、上下文压缩、无关文档更新不使旧证据失效。

## 7. 执行与完成边界

继续产品执行时核对当前共同基线、协调写域及第4.2节的有效证据，沿第4节推进剩余组合和修复。总纲已记录Owner允许1.8 S3通过，不从历史待验描述恢复阻塞或重做1.8整批验收；具体依赖事实仍按已有证据核对。已授权实现、排障、修复与批次接续不逐节点暂停等批准，工作协议规定的真实产品取舍、权限或发布决定才升级。

当前处于040–051独立叶子的持续集成与050真实consumer收口，已有通过范围见第4.2节。独立叶子、真实组合、教师视觉/互动复核与Owner accepted分别记录；实际运行中或失败后修复中的Luna链不记完成，不因本次文档更新新增完成节点、提交或发布。
