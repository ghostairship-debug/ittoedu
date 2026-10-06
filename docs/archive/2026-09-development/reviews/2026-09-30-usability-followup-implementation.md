> 历史原文：仅对应当时范围；不表示当前任务、授权或实现状态。当前读[CURRENT_STATUS](../../../development-plan/CURRENT_STATUS.md)。

# 果铃：后续可用性修复第一批实施记录

日期：2026-09-30。依据：[后续修复方案 v1.1](2026-09-30-usability-followup-repair-plan.md)。状态：第一批核心增量已实现并完成定向工程验证；UF-01—UF-14 并未全部完成，不能据本记录宣称 2.0 已获 Owner 接受。

> 后续进度：第二批接续实现与当前剩余项见[第二批实施记录](2026-09-30-usability-followup-batch2-implementation.md)。下表是第一批结束时的历史状态，不用于判断当前剩余比例。

## 1. 基线与真实范围

本轮开始时 HEAD 为 `c4d412983f6b7066e53ef0b6e5d8ed33241271cf`，已有 131 个修改／未跟踪项。本轮在该工作树继续，没有 reset/clean，没有 Git 提交，没有撤掉前轮配额和可靠初稿修改。

测试使用临时资料、假凭据、确定性模型端口、本机 HTTP/SSE 服务和隔离 Electron profile。没有调用收费模型、真实登录、生图或付费 CLI；没有修改桌面真实课件、生产 run/journal 或真实账号配置。生成速度和教学质量尚无新的真实模型对照，不能报告提速比例或教师验收通过。

## 2. 已实现增量

### UF-01：真实操作归属与局部撤销

DocumentSession 在正式事务完成持久化后发布宿主内部提交事件；元素卡只认领与本请求 runId 完全相符的 agent 操作，不再用整个运行时间段的前后快照差异认领人工修改。零 AI 写入不会显示“AI 已修改”。

`ElementChangeTracker` 复用原 DocumentSession，卡片只持有可派生的局部逆操作。原生对象按真实修改字段回退；源文按真实 splice 和后续正式变化推进位置，Flow 富文本按内容片段处理。修改范围被人工覆盖、删除或无法确认时不去全文寻找另一处同文。逆操作仍是一条正式事务，保留 redo 和正常文档历史。组件／Runtime 尚未具备的字段级撤销保持原来的明确边界，不伪称全量支持。

入口：`src/core/documents/DocumentSession.ts`；`src/main/workbench/execution/ElementChangeTracker.ts`、`CardTextEdits.ts`；`ExecutionDesktopService.ts`。

### UF-02：草稿、关闭、发送与排队

未发送草稿移到既有卡片 owner，收起弹层不会清稿；提交时记录的文本与正在输入的新稿分开。捕获选区、读取配置、创建会话与发送 ACK 都受同一取消生命周期控制。关闭准备中的卡片不再继续发任务；发送已调用但 ACK 不明时保留原 submissionId 和控制入口，可通过“核对并继续原发送”查询／复用原幂等请求，不另发新 ID。

“立即执行”直接推进已接受的排队记录，保留其 submissionId，不再删除队列项再通过输入框重新发送，不覆盖另一份人工草稿。停止按钮区分当前运行、发送准备与排队取消。

Runtime 页面文字仅在 applied/unchanged 时清除对应已确认输入；blocked/unknown/failed/conflict 保留可见草稿与原操作，不再返回假成功。

入口：`elementCardController.ts`、`ElementAiCard.tsx`、`ExecutionAssistant.tsx`、`ExecutionDesktopService.ts`、`runtimeLightEditCommands.ts` 及相应 shared/preload 接线。

本包尚未扩展所有窗口关闭、卡片草稿跨进程恢复和“停止并暂停后续”组合，不能替代 UF-04 的全局关闭出口修复。

### UF-03：未保存与显式续接结算

同类 documentResult 回执统一识别 file.write/file.patch 等文件修改；新文件只修改到恢复态且未保存时，不再漏掉其版本。

新增窄的 `taskContinuedFrom`，区分显式恢复原任务与仅复用会话上下文。结算沿显式任务链读取仍有效的原操作，不把旧工具列表复制进新 run。未知写入不能因无操作续接而显示 completed，普通独立消息不被旧任务义务永久拖成 partial。旧未调用项不是未知副作用；前一轮纯读取 ACK 丢失后，同正式文档范围的后续真实读回可以消解该读取诊断，已调用的未知写入仍不能通过另发 ID 消解。

入口：`ExecutionEngine.ts`、`executionOutcome.ts`、`ExecutionSubmissionStore.ts`、`src/shared/workbench/execution.ts`。

尚未完成：保存前确定拒绝与写后 unknown 的持久化阶段分类、lookup 消解、同任务跨 run 导出覆盖归属，以及按具体交付目标区分所有可选诊断。

### UF-04 / UF-07：实际引用范围同步与材料按需输入

发送前经 Main 解析实际固定文档；前端只同步这些文档，不再先 drain 全部标签。窗口退出仍保留原全量保全路径，没有把发送的范围收窄误用于关闭。新增 prepare-documents 是目标解析入口，不是另一套写权限。

PDF、Office、图片所属会话不再一律走可编辑文本打开。Main 先核实 home 真实路径／授权，再复用原附件接收服务；可编辑 home 保留正式文档快照，材料 home 进入不可变材料引用，不伪造 documentId。

附件引用区分 source 与 inline。资料默认向模型发送来源目录、版本、覆盖和读取状态，正文／页图随后通过 material 工具读取；显式直接图片仍送真实像素。UI 可选择将提取表示直接发送到本轮。编译 source 引用通过元数据核对而不读取大 blob，不把“已登记”表述成“模型已读全文”。

入口：`PayloadCompiler.ts`、`AttachmentService.ts`、`AttachmentComposer.tsx`、`ExecutionDesktopService.ts`、`ExecutionAssistant.tsx`、文档 tabs 与 CourseDocumentBridge 的限定范围 drain 及 shared/preload。

新 fixture 证明：大源文首轮只发索引，随后确实读回末尾四字并携带来源；PDF/PPTX/PNG home 注册与发送成功。PDF/PPTX home 夹具只证明入口和来源注册，不将签名样本冒充完整格式提取测试。前轮实际 Office 提取证据继续独立保留。

尚未完成：坏历史／未决文件移动的局部故障隔离、关闭失败出口、初始 inline 图片的后续工作集细化和所有页范围选择交互。

### UF-09：混合 HTML 精确编辑与横向弹层边界

源码定位复用仓库已有 parse5 的浏览器兼容树和 source locations，保留隐式 wrapper 与真实子元素索引。SVG、template、select、MathML 等旁侧子树不再使普通标题整体不可编辑；来源不明、脚本生成或文本位置歧义仍明确拒绝。

快捷条弹层按自身实际宽度作水平夹持，并响应尺寸／滚动变化，不只保证快捷条自身在屏内；卡片操作行可换行，保持输入与发送可达。

本包未实现任意后台 HTML JS 的无损暂停，也未重写预览失败恢复状态。

### UF-12：正常数组、对象和非资源样式

资源证明与提取遍历同时区分普通数据容器、已知不加载 URL 的样式和真实资源入口。正常 answers[i]、state[key] 赋值及计算 opacity/transform 不再被视为资源 URL；DOM／style 别名逃逸、动态方法、真正动态资源和未知指向仍受原边界约束。没有删除整个校验或将 error 一律降为 warning。

真实六页 fixture 的 HTML 中包含答题数组、计算样式、SVG 和按钮；完成候选准备、正式保存、从 archive 重开并实际点击六页反馈。范围是上述实际例子和既有闭包反例，不承诺任意 JavaScript 静态证明已完成。

### UF-13：OAuth 保存与单一刷新 owner

原样保存幂等，不生成空凭据版本。仅元数据变化的新连接版本，通过内部 `oauthSourceRef` 引用同一真实 OAuth 登录 owner，而不是复制一份会独立轮转的 refresh token。读取投影、共享刷新锁、CAS、撤权和迟到响应均遵守原账号／endpoint 身份。

测试不止断言 hasCredential：新旧配置均经实际 ChatGPTOAuthClient.resolveCredential 读取假凭据；新旧版本的并发刷新只操作同一 owner，撤权后不能复活。不同账号或 endpoint 不继承凭据。未触碰真实账号文件，没有声称完成真实供应商登录测试。

## 3. 验证与证据

### 单元／集成

22 个不同文件、311 项定向测试通过。按最终有效结果去重，未把重跑次数或未选中的用例算入总数。

| 证据日志（相对仓库） | 覆盖 |
|---|---|
| `output/g20/usability-followup-20260930/focused-final.log` | 13 文件 95 项；卡片、材料、OAuth、终态、Runtime 文本及源码定位 |
| `output/g20/usability-followup-20260930/attribution-last.log` | 最后补充后的文本映射 5 项＋元素卡集成 9 项；替代上行对应结果，不重复计数 |
| `output/g20/usability-followup-20260930/closure-final.log` | 2 文件 133 项；正常逻辑、真实资源和别名反例 |
| `output/g20/usability-followup-20260930/core-and-lineage-fixed.log` | 3 文件 35 项；持久提交事件、历史与跨续接 |
| `output/g20/usability-followup-20260930/engine-boundaries.log` | 4 文件 47 项；执行器、实际子进程崩溃恢复、材料来源、文档投影 |

### 真实本地载体

| 用例／日志 | 结果及准确范围 |
|---|---|
| `g20RealUsageRepairs.spec.ts`；`electron-carriers.log` | 通过。非默认 Runtime 命中、右侧小视口的两类 AI 卡可达性、独立 HTML 预览、含正常动态逻辑的六页保存重开与实际按钮反馈；证据 `output/g20/repairs-20260929/run-0STXCP` |
| `g20M15ElementCards.spec.ts`；`electron-final.log` | 通过。Slide/Flow/Spatial 对象卡、正文范围卡、并行请求、提问／批准、局部 Undo/Redo、保存关闭和重开；模型为本机确定性 HTTP/SSE 服务，无付费调用 |
| `g20M23HtmlLightEdit.spec.ts`；`electron-final.log` | 通过。新增 SVG/template/select/MathML 旁侧内容，文字／图片源文精确修改、原生历史键、多标签目标隔离、保存及文件重开 |

三套 TypeScript 检查分别见 `types-close-0.log`、`types-close-1.log`、`types-close-2.log`。最终主进程与 renderer 构建通过，见 `build-close-main.log`、`build-close-renderer.log`；既有 Player 未受本批变更，不以重复构建充当验证。正式能力生成器生成 73 项制品，见 `capabilities.log`。Vite 仍提示较大 bundle，未把提示隐藏或当成本轮已优化。

### 失败记录没有被抹掉

- file.write 未保存漏报曾红，修复后通过。
- 最初的数据容器放宽触及既有别名逃逸反例，已在同一资源 owner 补回约束，最终 133 项闭包检查通过。
- 两项旧 remote-media 断言与当前已批准的被动远程媒体保留规则不一致。对本轮前后的真实源码均运行同例，结果同为 remote-media-preserved warning；测试改为验证准确 URL／资源类别／保留内容与 warning，未放宽动态未知资源。对照见 `closure-baseline-comparison-2.log` 和 `closure-before.json`。
- 既有 1 MiB 首轮超限断言已落后于前轮 8 MiB 范围，测试改用真正超过现行范围的源文／PNG；原草稿保全断言保留。初始图片只在当前显式请求进入模型，历史来源不隐式重复发送像素。
- 跨续接最初把旧 pending 项和纯读 ACK 失败一律算永久缺口，回归暴露后修正；真正未知写入和无操作续接仍保持 partial，独立新任务不继承旧义务。
- 原长 HTML 轻编辑 UI 首次两次停在第一个原生 Undo；加入 Main/renderer 按键路由记录后确认正确路由时成功。夹具改为先等待真实 focusedFrame，再只发送一次原生按键，不增加重试按键、不绕过文档历史。最终正式用例通过；早期日志与 trace 留存，不能把这里描述成已修复一个尚未定位的产品 iframe 崩溃。

## 4. 未完成工作与下次接续

| 工作包 | 本轮状态 | 下次重点 |
|---|---|---|
| UF-01 | 核心归属与局部撤销已验证 | 后续共享历史变化命中时保全；不扩 Runtime 字段级能力 |
| UF-02 | 第一批关键链已验证，未全包签收 | 窗口级未发送输入保全、停止并暂停后续组合 |
| UF-03 | file.write 与显式续接结算已验证，部分完成 | 持久化阶段与 unknown 查询；跨 run 导出权；具体目标与可选诊断 |
| UF-04 | 发送同步范围已收窄，其余待做 | 坏历史和未决绑定局部隔离、关闭选择出口 |
| UF-05 | 待实施 | 正常扩写／Flow／改名后的任务续接与换行容错；不能拿卡片跟随替代该验收 |
| UF-06 | 待实施 | 无硬链接文件系统可靠发布；实盘条件单列 |
| UF-07 | 材料 home 与按需目录已验证，部分完成 | 初始 inline 工作集、完整页范围／提取进度 UI |
| UF-08 | 待实施 | 动态准入排队、累计帧额度、原任务冷却与错误分类 |
| UF-09 | 混合源码定位和横向弹层已验证，部分完成 | 后台预览生命周期、失败恢复；不承诺通用 JS 无损暂停 |
| UF-10 | 待实施 | PPT 损失详情、日常启动、文件参数、小屏 |
| UF-11 | 待量测 | 本地历史／序列化真正热点，不做无依据重构 |
| UF-12 | 本批正常逻辑与原闭包反例已验证 | 特殊脚本按真实 consumer 定向处理，不扩大为万能证明器 |
| UF-13 | 本地凭据、刷新和配置链已验证 | 真实供应商连接只在授权使用场景单列，不改用户真实数据 |
| UF-14 | 待实施 | 实际受管会话登录接管、暂停 Agent、返回后重新观察 |

下一次从 UF-03 的 unknown 查证、UF-04 的故障隔离／关闭出口继续，独立的 UF-06/08 可按明确路径分工。当前只有一个共享树 writer；不回滚这批已验证变化，也不将其当成全方案完成。

## 5. 使用说明

源码、生成制品与运行构建保留在工作树，尚未提交 Git；没有重启用户的果铃窗口。用户先保存正在编辑的内容，完全退出后从当前仓库重开，才会加载新的主进程与 renderer。不需要删除真实课件、聊天记录、恢复日志或重新登录来启用本批修复。
