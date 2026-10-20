# 创作边界修复实施结果

2026-10-20。已实施 A—F 软件修复，并完成隔离小工程的实际编辑、保存、新进程／新 profile UI 冷开、公共导出和离线运行闭环。公开生产回执尺寸、模型交付预算、动作与观察事实、混合装配、资源身份、局部布局及成果承接均有直接消费者证据。**首次收口遗留的16×5MB内存问题，随后已按Owner授权定位到生产HTML投影并修复；默认堆最大协调器及真实Gateway同尺寸验证通过，原失败保留。** 详见下节。本轮没有启动完整作者、制作参考库或验证创作质量／提速。

本轮证据统一位于 `output/creation-boundary-implementation-20261020/`，下文证据路径相对此目录。研究基线 `output/repair-plan-deepening-20261020/`、原作品及历史失败均保留。下一轮实际可用入口见 [CAPABILITY_HANDOFF.md](CAPABILITY_HANDOFF.md)。

<a id="batch-memory-followup"></a>
## 后续：大批量写入内存根因修复

Owner 随后明确授权继续定位、修复内存，窄屏内容取舍不动。此节新证据统一在 `output/creation-batch-memory-20261020/`，不覆盖下文首次实施证据。

**责任在生产投影，不是测试夹具自造4GB载荷。** 正式提交后的 ACK 会重建工程文件投影：整页 `projectHtmlProjection` 同时持有多个对象的 parse5 解析树，摘要随后又完整解析整页。当前 parse5 8.0.1 的长文本 token 按字符拼接，默认树直接持有这条字符串链。安全小反例中64/128/256KiB连续文本保留约32—34倍堆；4×128KiB默认树保留16.91MB，同一默认adapter入口复制文本精确值后为0.57MB。16×5MiB的80MiB逻辑正文因而可先变成约2.5GiB文本树，再叠模型、命令和投影。它是本次规模形状的分配／保留放大，不宣称已证明无限增长的内存泄漏。

原fixture是真实coordinator／Driver／Session／最终ACK的切片；固定planner、共享current快照、忽略逐项candidate ACK，省略实际磁盘持久化。它总体偏轻。相同body引用与Vitest成功断言没有独立的4GB乘数；`structuredClone`在多个字段出现同一primitive string时仍可能展开逻辑全文，不能把真实成本只算成5MB。两位独立叶子的原始核查分别在 `production-audit.md`、`fixture-audit.md`。

实际产品修改仅 `src/core/projectFiles/componentPlatform/projection.ts`：沿parse5现有TreeAdapter的 `insertText`／`insertTextBefore`，将文本精确复制后交回默认实现，解除逐字符字符串链的保留；body投影与摘要共用该入口。摘要保原解析规则与隐藏内容规则，最多收集180字，避免先join整页正文。正式源文、整页组装、子对象sourcePath、事务／History／CAS／ACK均沿原owner，未截断正文或改小输入。中间曾试源扫描摘要，独审找到省略head结束和双escaped script的语义差异，已撤回并保留候选；没有另造HTML解析器。

有效验证：

- 16×1MiB普通Node阶段采样：修前观察到约1.394GB堆，最终约0.396GB；热点集中在ACK的HTML投影和摘要。数据见 `measurements.json`、对应JSONL。是分段采样，不是精确进程峰值、金额或真实作者速度；修前还启用了1MiB间隔分配采样，不以此签严格下降百分比。
- 原封不动的手动16×5MiB脚本在中间候选默认堆完成，见 `largest-original-shape-after.log`；最终候选由新增常规回归 `publicWriteReceipt20261020` 最大点验证：**1 passed，25.96秒**，9项未选不计通过。16项正文完整、一次事务／一个Undo、公开回执有界，实际Undo恢复全部旧文、Redo恢复全部大正文，见 `largest-final-undo-redo.json`。最大点已回到默认测试收集，不再依赖手动probe。
- 最终真实 `DocumentToolGateway` 同尺寸80MiB批次：**16次plan、逐项candidate／ACK、正式Session写入、共同回执及实际Undo通过**。默认heap limit=4,496,293,888B，公开结果5,329B；耗时176.34秒、进程peak RSS约4.29GB（RSS不等于V8堆）。见 `gateway-probe.ts`、`gateway-largest-final.log`。此测试仍固定data.set planner、使用内存persistence，未跑Renderer／真实HTML测量／磁盘80MiB保存；不能冒称完整UI性能已改善。该额外生产成本如实记录，未继续扩大到无关性能重构。
- 新增摘要／嵌套投影7项全部通过，保实体、合法省略head、双escaped script、template、textarea、foster-parent文本顺序、raw script/style和子对象路径。独审另核10种adapter语义树与12种摘要边界，最终无新增阻断；源码与独审均确认没有改coordinator或Session。
- 相邻a08文件7项通过、3项失败；仅将projection恢复本轮前内容的定向反事实仍在同三行报同错，均为上一轮公开Source／unknown.input旧断言，未修改旧测试洗绿。见 `semantics-and-receipts.json`、`receipt-counterfactual.md`。错误反事实配置的首次额外收集已停止并排除，旧日志留存。
- 现行公开回执的共同批次与Source／人工并发CAS两个相关用例2/2通过，见 `batch-source-cas-final.json`；其余8项按标题未选，不混入新增通过数。
- 三套类型及必要Main构建通过：`typecheck-final.log`、`build-main-final.log`。无Renderer调用此投影，未重跑未变Player／Renderer、整课作者或窄屏试点。

原作、窄屏表达、历史OOM与既有未提交成果保留。没有提高heap、删History／恢复值、换模型、调用收费服务、提交、推送或发行。本节修复关闭原16×5MiB OOM，未承诺任意更大规模，也不改此前整课质量／提速未达事实。

## 基线、范围与保全

- 开工与收口 HEAD 均为 `a8882691eefd1f24853571296d5a3a90d45f90b5`；开工 232 个 tracked differences 是既有成果，不归成本轮。`baseline.json`、`baseline-status.txt`、`final-status.txt` 保留工作区身份与路径。
- Root 统一写 coordinator、Gateway、modelToolResult、ExecutionEngine、共享契约、Skill 根及生成物。动作／查询／内容资源／布局／状态与清理使用独立叶子，交叉实体顺序移交，未建立第二 writer、History、状态平台或资源 owner。
- `protection.json` 确认 AGENTS 与开工字节身份相同、HEAD 未变。未 reset、clean、stash、commit、push、打 Portable、部署或发行，未迁移真实恢复数据；试点仅使用新工程或副本。
- 没有新模型作者或付费创作／素材请求。三个隔离 built app 进程的实际 `runs.list()` 均为 0 runs／0 authorRequests；见 F03 原始事实。供应商配置、凭据和真实用户 profile 未改。

## 首次 A—F 实施与消费者（后续内存修复见上节）

| 包 | 实际修改的 owner／行为 | 已验证与证据 |
|---|---|---|
| A1 公开回执 | 新 `publicWriteReceipt` 显式选择提交、身份、版本和路径事实；coordinator 不展开 input，普通／错误／建页首稿／Source／enhance 共用公开结果；共同批次 receipt 仅顶层，子项保局部结果和 operationIndex。Gateway execute／lookup 同形，内部 Session 仍留完整值。短软件入口有 complete 标记，已写正文不回显；人工并发不自动变已读。 | A1 的 8 个有效测试覆盖 1/4/16 项、精确 1KB/1MB/5MB 的公开生产尺寸；内部原值、Undo、真实 Gateway 重复身份查证、2MB 错误、短 Source 与人工 ACK/CAS。较小真实协调器批次通过；最大完整压力点单列失败。见 `A1/RESULT.md`。 |
| A2 查询／最终请求 | 共用 UTF-8 JSON 交付预算，PTC 字符串／对象／大单项默认有界，内部原值与可信脚本完整计算保留。context/read 与 job/delegate 等最终结果走同一出口，最新轮及明确宿主数据消息也受预算；原始消息仍在 journal。真实适配器序列化后计窗口，并在本地进一步缩减可缩结果，保持原生参数、签名和调用配对。MCP 大查询复用既有 operation owner，凭票据选择字段／范围读同源，拒绝跨会话／空间。 | A2 35 个有效用例，含实际 PTC Chromium、四种协议 wire、本轮 32k 小窗口多结果与可信 Engine 内部完整读取。Root 追加真实 MCP transport 1/1，文本与 structured 同值、冻结尾段、原读只执行一次。`A2/RESULT.md`、`delivery-settlement-skills-final.json`、`MCP-final.json`。 |
| B 动作／取消／结算 | 原动作回执区分 dispatch／application／goal／observation，已应用不因后续取证失败倒退；navigate 保原操作身份。共享只读等待原语支持 Abort、局部期限、代际和晚结果收尾；未启动 PTC 项及时取消，已开始写保 unknown／原身份，不重放。同范围未决写进入现 scoped guard；旧运行纯读退役与必要验收缺口分开，保存／导出独立。 | 动作／Scheduler 27 项；Runner 追加挂起写后排队读与晚回执快照反例。真实 Engine 原 guard probe 修后只进入一次写，第二次同范围为 unresolved-prior-tool；settlement 反例保原记录与 rev13 保存／导出事实。见 `B/RESULT.md`、`root-recovery-fixed/result.json`、`settlement-focused.json`。 |
| C1 混合装配 | 测量／装配保最小 stage Web 语义组，外围图文仍独立；head/body 惰性 JSON 不再丢失。普通 content 保既有程序身份／frame，明确 redo 才重组；可靠记录沿原 reconciliation 保留，不可靠映射保原程序并说明原因。 | 真实 Electron 的 11 个小 fixture：普通图文＋正式 Next、相对 iframe、srcdoc、同批 operations、合法跨块全局程序、JSON、form/CSS、作者记录；实际点击、局改／Undo、保存及新宿主冷开。见 `C/RESULT.md` 和其中原始 facts／GLX。 |
| C2 资源 | 继续用同目录闭包、source、工程绑定及短 URL／lease，不让模型搬 WAV Base64。补 redo 的资源记录／人工换图保持、旧 wrapper 不覆盖人工值；同字节不同作者资产保身份；动态 JS 分析未覆盖只给 warning，不执行任意 JS 猜资源。 | 新记录／资源反例、既有闭包 85/85、Source 媒体直接回归有效。最终小工程采用相对 32,044 字节 WAV，GLX 冷开与离线实际播放到 ended；共享 buffer 有效字节／租约已有证据保留。见 C 与 F03。 |
| D 局部空间 | 同一薄 helper 沿 ComponentLayoutPort／真实 content box 接 Web、owned document、Published、compiled、离线；嵌套 srcdoc 编译入口也已补接。stage 仅许可局部 wide/compact 与有界间距，保人工样式／frame，不缩字、隐藏正文或写 History。裁切、重叠、隐藏动作、字号和不足均有具体派生事实；动态资源／反馈与旧代际清理贯通。 | 1040×570/590、620×570，最长反馈、辅助滚动、字体图片迟到、CSS 更新、locked／人工 padding、四组合不足；C 实际装配声明进入所有代表 consumer。独审及 nested stage 4/4；F03 最终离线实际 compact、issues[]、动作可达。冻结第08页真实源副本在1040×570/590通过，620×570正文溢出38px如实诊断，见 D/08/RESULT.md。 |
| E 成果承接 | 复用 scope.state JSON 与现 bindings；采访原输入、对象与核对状态由下一页首值／订阅实际消费。单一业务 data 供显示和判断，普通 DOM 文案覆盖的能力边界不扩大。修 World reset 后残留 synced 阻止隐藏 Source 重挂。 | Published／compiled 真交互、返回、复制隔离、reset、正式 data.set→GLX 保存→冷读后显示／判断同源，3/3。显示／判定重复 bug 未在受测正式入口复现，没有冒称修复任意外来 JS。见 `E-F/state-handoff/README.md`。 |
| F 诊断／生命周期／交付 | typed warning 不再压成课件加载 fatal；falsey fatal 也保真实错误。初始化 throw 与 dispose reject 仍逐项清理资源／剩余实例，保首错。EditSession 从已证明的 canonical owner 取得内部完整值，公开精简形态不再触发流式编辑 receipt-conflict。 | F 源消费者与故障注入有效 8 项；最终 dist-player 直接故障消费者 5/5；EditSession 9/9；F03 代表产品闭环。见 `E-F/F-RESULT.md`、`dist-fault-consumers-final.json`、`edit-receipt-consumer.json`、`F03/README.md`。 |

`project.read full:true` 现在表示请求完整来源，超本轮容量明确返回 complete:false／nextOffset。续页固定原 epoch/revision，源文变化后仍可续原页，并可显式 refresh。完整工程／编辑器／导出能力未删除。

第08页试点与技术 fixture 分开：从冻结 YOU & ME 原件提取一页源文与资源，仅在副本声明 body／feedback／actions 和作者允许的 compact CSS。基线下一步 bottom=641.53，超出570视口且不可达；副本初态、原脚本错误反馈及 Mia 正确反馈／完整 model 在570高时 bottom=550，590高时 bottom=570，正文、字号、frame 保持。620宽时四组合后正文仍超38px，needsContentDecision=true；80px compact 图区沿原 cover 裁剪人物更多，保留为视觉取舍，未签整作接受。图片已按正式资源投影实际加载；先前探针准备错误和原失败均保留。

## 实际产品闭环与构建

F03 使用正式 built app singleton Gateway 的 project.apply/from 装配普通标题、图片、局部 iframe stage、相对音频及正式 Next。局部 .data.json 修改保 frame／邻居，普通 Undo／Redo 后另存 rev6 GLX。PID 5160 关闭后，以新 PID 55372／新 profile 从同一文件真 UI 冷开，图片 decode、鼠标双击原生文字编辑器、局部真实反馈、音频 ended 与正式 Next 成立。

第一次公共 document.export 的离线 HTML 暴露嵌套子文档漏挂 helper，长反馈使动作超出 480px 局部视口；修前 HTML／矩形／PNG 均保留。修复并统一重构建后，只复用冻结 GLX 重导出：PID 42608／新 profile 真 UI 打开，经公共 export 写新文件；file:///＋offline Chromium 中 Reveal／Play 为真实鼠标，WAV duration/currentTime=1s 且 ended，compact issues[]／动作可达、图片与正式 Next 均通过，HTTP 请求为空。没有为补该叶子再创作或覆盖原失败文件。

- 最终工程：`F03/run-wZOO6C/workspace/mixed-saved.glx`。
- 最终离线制品：`F03/run-wZOO6C/final-u7y88h/mixed-offline.html`，事实 `facts-final.json`，画面 `offline-running.png`／`offline-formal-next.png`。
- Root 用 agent-browser 再开最终本地 HTML，实际揭示反馈、音频显示 Audio ended，正式 Next 到 Formal Next arrived，并复看真实 PNG。根目录 `root-offline-*.png` 为补充证据；跨 iframe 的一次 CLI 文本等待报传输错误，不被当成作品失败或成功依据。
- 最终 Player／Renderer／Main 构建均成功；`build-player-final.log`、`build-renderer-final.log`、`build-main-delivery-final.log`。三套类型检查 `typecheck-complete.log` 成功。
- 收口补齐几何轻量读取的 global viewport 与有效展示状态语义，保状态已删除的原诊断；新增聚焦用例1/1（其余8项未重跑），独立复核关闭，最终三套类型与 Main 再构建成功，见 `A1/geometry-receipt-final.json`、`typecheck-geometry-final.log`、`build-main-geometry-final.log`。未改变 Player／Renderer 行为，前述产品闭环证据继续有效。
- 运行既有生成器产出 146 个能力文件并同步 bundled skills／artifacts，安装脚本实际更新用户域 orchestrate-courseware／workbench-usage，其他五项已是当前；原用户域这两项预先备份。真实 skills.read Gateway 分发检查通过；未手改生成文件。Windows 正常 CRLF 语义的 diff --check 成功。

## 独立复核与首次收口的失败记录

`core-review.md` 初审发现的五项均已修正并增量复核：内部 EditSession 回执冲突、最新多结果合计超窗、PTC 未决写同范围重入、排队纯读挂在写屏障、晚结果改已交付父回执。C／D／E-F 的重要结构亦完成针对性独审，没有以作者自审替代。原报告保留初审与修正证据。

首次收口的限制及当前去向：

1. **首次收口时16×5MB协调器压力未通过，现已由上节后续修复关闭。** 当时独立worker约72秒触默认4GB堆上限，未加heap、未定位；原失败源码与手动probe继续留A1。后续定位、修复和默认收集恢复有独立证据，不覆盖或追改这次失败为成功。
2. 首次宽文件回归 141 项中 15 红保留于 core-integration-tests.json。逐项审计见 failure-audit.md：13 项既存 fixture／错误码／标签错位；1 项 full 全文旧断言已按分页合同改成固定版本完整续读；1 项可选压缩元数据旧假设，而实际 wire 不复活旧 native 的核心断言已通过。没有宣称整文件或全仓测试全绿。
3. D 相邻旧 nestedDocumentAuthoring 的图片 rawText 断言在完全禁用布局的 counterfactual 下仍同因失败，保留未扩大修复。C 两条旧“整个 script 必须拒绝任何局部资源化”断言已改为实际有权静态替换和未分析 statement 保留，独审核对，不删除合法动态程序能力。
4. 技术 fixture、08 副本和代表动态状态不等于新整课作者实际采用、几分钟首版、稳定提速、精品参考质量、全设备／全浏览器或 Owner 整体签收。下一轮由用户另启参考创作；发行继续暂停。

没有建立任意 JS 拆解器、全页避让平台、全局缩字／隐藏溢出门、新状态库或新收费路径。软件结果与旧作品质量／耗时保持各自生命周期。
