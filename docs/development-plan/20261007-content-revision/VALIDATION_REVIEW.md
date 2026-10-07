# 独立测试与分阶段review

全部命令planned，未运行。T Sol/high未参与对应产品实现；E Luna/max机械执行；独立R非I/A/实现者。依据来自原合同、样本、失败和直接consumer，不从新实现反推成功标准。

## 独立流水

T唯一写分配的测试全文：新增优先 tests/{unit,integration,e2e}/productFollowup/<T族>/ 和对应fixture；既有文件若扩展或修预期，也在实际卡中明确移交该T族整文件并暂停其他writer。当前Vitest include只有unit/integration，Playwright为e2e。实现者交保留行为和建议，不改T断言。共享fixture一个writer。E固定cut/隔离worktree执行，不能同时改它读的源/产物；并行代码在别worktree继续。构建按相关变化一次E单writer，多族引用结果，已绿闭包未变不重跑。

最低成本起：近层反例→对应文件副本保存/撤回/冷开→实际视觉/互动→真实汇合属性。每叶按属性选1–3条，多个包引用一个相同行为，不机械每主张一测试。simple文案/包装不写镜像测试。skip/exclude/零匹配不算通过，普通失败交原作者，不提高retry/放宽断言。

当前全仓类型和旧V9有红债。记录本轮活动闭包基线、承担新增和目标诊断；A09修已列维护，不能每叶全仓清零。旧V9 g20/projectFiles用例不证明V10，新输入须实际V10。更改/删原断言须给原错误/已批准变化/等效覆盖，R核对。

## 命令与收费边界

优先 .\\node_modules\\.bin\\vitest.cmd run <准确文件或T族> -t <真实case>；GUI用实际Playwright专用spec/载体。T/E运行前核hook/include/filter至少一个真实匹配。npm test/test:e2e/build/verify含额外准备和矩阵，不作每叶默认最低命令。

先零模型真实SDK/软件；必须证明模型能用简化内容请求才调用已有授权API代表样本。AGENTS授权TeamoRouter DeepSeek主、DeepSeek官方第二，实时目录钉模型/计费/能力；已授权GPT OAuth登录/图像不重复账号选择，不新图片API。确需外部CLI的授权用例只Codex/OpenCode Luna或Claude既有DeepSeek，核真实配置路由。Gemini经验不授新收费测试；不隐含全三路/全CLI矩阵。无相关变化/新假设不重跑付费，网络/协议/工具/模型分别记录，不换高价模型掩软件bug。

计算/其他环境未配置先免费事实检查，已有可用才小样实际跑；不新装WSL/Podman/管理员环境，不新媒体/云。mock只证该层，不冒真实供应商通过；条件只阻相关验收，无关继续。

## 族与关联包

| 族 | 属性 | 包 | 首ready |
|---|---|---|---|
| T01 | 内容请求→软件应用→真实回执 | K02, K03, K04, A01 | 内容请求窄port稳定<br>对应caller叶候选可读 |
| T02 | 统一能力与场景自动披露/Skill | K01, K06, TE07, S05, S07, S08, S10 | 共享目录和scenario port合同冻结<br>相关能力叶候选就绪 |
| T03 | 当前输入自然生效、保存草稿与正常退出 | TE01, TE02, TE03, TE05, TE08, TE09 | GUI draft collector及正式writer port稳定<br>源码/JSON/属性/图表叶候选 |
| T04 | MCP长效自连与跨会话生命周期 | S01, S02 | 产品bootstrap/连接事实port稳定<br>连接叶候选可读 |
| T05 | 网页已授权任务、外部操作及人工接续 | S03, S04 | browser动作/授权/viewport接线候选<br>必要consumer已稳定 |
| T06 | Office当前结果、撤回、保存与课件输出 | TE04, S05, S09 | Office结果owner及公共能力port冻结<br>output候选就绪 |
| T07 | 当前source、HTML/PPTX导入和身份资源 | A01, A02, A03, S09, TE10 | current-source/导入公共port及叶候选稳定 |
| T08 | 真实装配绘制、Player资源、长导出/maxHTML | A02, A03, A04, A05, S09 | 装配/runtime/output相关叶候选固定cut<br>该cut build一次就绪 |
| T09 | 资料→计算/图片→独立成果交付 | S06, S07, TE06, TE08 | 材料、compute/media/artifact公共port及对应叶候选<br>现环境已配置 |
| T10 | History、恢复结算、资源成本和辅助记录 | K05, K07, A06, A07, A08, OPT01 | Session/recovery/outcome相关候选<br>当前数据合同稳定 |
| T11 | 当前格式工具与资料/类型债诊断 | A09, OPT02 | 对应工具consumer或文档叶候选<br>无需等待产品全局集成 |

### T01 内容请求→软件应用→真实回执

**独立写域：**

tests/integration/productFollowup/T01/
tests/unit/productFollowup/T01/
tests/e2e/productFollowup/T01/

**既有可复用（静态路径已核，当前输入再核）：**

tests/integration/g20BoundContentOutput.test.ts（Markdown真正正文绑定、伪provider、一次History、停止/人工重叠）
tests/integration/g20MarkdownFidelityGateway.test.ts（普通MD选择/未选CRLF保全）
tests/integration/componentPlatformSession.test.ts（真实V10 Session、独立字段rebasing、ACK去重、保存重开）

**反例建议（按实际改动合并等效）：**

新文件boundContentScenarios.test.ts：Markdown/Flow/专业富文本/任意JSON/局部源码共用结果合同；模型只返内容和真实语义，不抄run/epoch/revision/内部ID；正文、算法、几何仍可表达
新文件humanInterleave.test.ts：续页后人工改同一范围拒绝；改不相关字段允许；未给AI看过的续页不得自动记observed
新文件receiptMeaning.test.ts：not_committed/unusable/unknown不能被read外壳或timeline称completed；修复成功更新当前结论，保旧错误记录；no-op不新History

**目标断言：**

冻结同一文档/选区，未选文字、链接、混合样式、布局、资源和互动保留；选内格式按实际语义更新并明确不能等价映射
逐流片段不逐次正式commit；最终一次History；当前正式回执和新观察同一revision；恢复不重放已结算动作

**必要实际动作：**

GUI黄金链：打开教师副本→选一个混合格式段落并说改写→看到默认生效→撤回/重做一次→Ctrl+S→正常关闭→新进程冷开→确认文字、链接、邻接互动可继续编辑；记录提示次数，教师无编号/Apply手续

**条件范围：**

伪provider只证明工程正确性；真实模型质量另在明确授权代表样本中验证，不能用伪provider冒充供应商成功

**计划命令（不全部默认运行）：**

command: npx --no-install vitest run tests/integration/g20BoundContentOutput.test.ts tests/integration/g20MarkdownFidelityGateway.test.ts tests/integration/componentPlatformSession.test.ts
status: planned_not_run
expected_matching: 至少1个实际执行且通过；任何skip/零匹配均不证明该属性
command: npx --no-install vitest run tests/integration/productFollowup/T01/
status: planned_not_run
expected_matching: 至少1个实际执行且通过；任何skip/零匹配均不证明该属性


### T02 统一能力与场景自动披露/Skill

**独立写域：**

tests/integration/productFollowup/T02/
tests/unit/productFollowup/T02/
tests/e2e/productFollowup/T02/

**既有可复用（静态路径已核，当前输入再核）：**

tests/integration/g20ScopedToolCatalog.test.ts（仅Markdown标题可复用；其V9标题仅历史参考）
tests/integration/g20ToolFamilyDescription.test.ts（V9，仅历史反例与原断言依据）
tests/integration/g20ScopedSkills.test.ts（V9部分不作V10证明）
tests/integration/g20SkillTools.test.ts
tests/unit/g20BundledSkillService.test.ts

**反例建议（按实际改动合并等效）：**

scenarioCatalog.test.ts：人工、内置、resident外部以同能力provider验证同结果；按当前文档/来源/权限/服务可用性自动给相关能力；普通Agent无需tools.load簿记
methodReadContinuity.test.ts：读教学/研究/数据/Office方法不撤read/save/inspect，不改权限；中文本地方法可发现，说明改动不误废未变参考页
capabilityConsumers.test.ts：所有已配置能力均有producer→catalog→execute真实consumer；无配置族诚实unavailable，不需要新平台或全工具同屏
assetAndStateParity.test.ts：多选根提炼、库包导入/版本更新/删除、Slide展示状态增删复制/设初始、页面改序与13个教师导航按钮均经现有正式owner；分别核目标和撤回结果，不建设替代库平台。

**目标断言：**

方法只提供内容策略，授权不扩张；隐藏名称不能越权；不同UI/名称允许，目标和结果语义一致
全能力清单按现服务逐项归属T01/T03–T10；外部客户端自己的shell/搜索不计宿主缺失或通过

**计划命令（不全部默认运行）：**

command: npx --no-install vitest run tests/unit/g20BundledSkillService.test.ts tests/integration/g20SkillTools.test.ts
status: planned_not_run
expected_matching: 至少1个实际执行且通过；任何skip/零匹配均不证明该属性
command: npx --no-install vitest run tests/integration/productFollowup/T02/
status: planned_not_run
expected_matching: 至少1个实际执行且通过；任何skip/零匹配均不证明该属性


### T03 当前输入自然生效、保存草稿与正常退出

**独立写域：**

tests/integration/productFollowup/T03/
tests/unit/productFollowup/T03/
tests/e2e/productFollowup/T03/

**既有可复用（静态路径已核，当前输入再核）：**

tests/unit/f0DocumentDraftAck.test.tsx（IME、真实ACK、拒绝保draft）
tests/unit/componentSourceQ0.test.tsx（共享/私有source、真实V10 Bridge、草稿及ACK）
tests/unit/timedR1SourceCloseDraft.test.tsx（原关闭保源文反例；旧要求显式discard非新自然保存终态）
tests/unit/timedR2DocumentSaveStatus.test.tsx（V10真实保存状态）

**反例建议（按实际改动合并等效）：**

visibleDraftSave.test.tsx：同时有源码/Developer JSON/图表/属性/Flow可见输入，GUI保存与工具保存都drain当前有效输入并真实落盘；不多按钮逐面板Apply
incompleteDraftRecovery.test.tsx：非法JSON、半写数值、语法未完source、未完IME保原文可恢复，不清空/转0/假allSaved；恢复后不自动执行未完成副作用
lateSaveAck.test.ts：保存r时r+1继续dirty；切文档后ACK只确认发起文档；写失败读最新状态
O05：外部磁盘版本改变后，内置/外部Agent经共同observe/reconcile owner采用磁盘/保当前并在同任务继续真实save；至少无GUI headless公开consumer。已有GUI恢复成功不能替代缺口，也非一般save/CAS绿case。

**目标断言：**

默认生效且可撤回；普通save不凭旧正式快照冒称眼前内容已保存
正常关闭能保未完成输入到恢复稿，旧语法不能运行时清楚诊断；Source语法保存和运行成功分别证明

**必要实际动作：**

GUI：源码改一处可运行标签，不点保存实现；Developer改一处data；Ctrl+S一次→关闭→冷开验证两处；再输入半截JSON和数值“-”→关闭保稿→新进程恢复原字符且无动作重放

**计划命令（不全部默认运行）：**

command: npx --no-install vitest run tests/unit/f0DocumentDraftAck.test.tsx tests/unit/componentSourceQ0.test.tsx tests/unit/timedR2DocumentSaveStatus.test.tsx
status: planned_not_run
expected_matching: 至少1个实际执行且通过；任何skip/零匹配均不证明该属性
command: npx --no-install vitest run tests/integration/productFollowup/T03/ tests/unit/productFollowup/T03/
status: planned_not_run
expected_matching: 至少1个实际执行且通过；任何skip/零匹配均不证明该属性


### T04 MCP长效自连与跨会话生命周期

**独立写域：**

tests/integration/productFollowup/T04/
tests/unit/productFollowup/T04/
tests/e2e/productFollowup/T04/

**既有可复用（静态路径已核，当前输入再核）：**

tests/unit/mcpServerLaunch.test.ts
tests/unit/mcpSdkClient.test.ts
tests/integration/g20ResidentMcpServer.test.ts（真实loopback server/长效设置，不是外部Agent自动发现）
tests/integration/g20ExternalMcpService.test.ts（inspect fixture代际；需要T的新V10测试证明当前消费者）
docs/development-plan/20261006-required-fixes-result.md §R6及原有效连接证据

**反例建议（按实际改动合并等效）：**

bootstrapLifecycle.test.ts：同profile GUI→attach、后台→GUI继续编辑、detach保owner、明确结束释放session；客户端退出不靠老师停再开
reconnectNoReplay.test.ts：普通断网原session接续、新session重新观察、已应用未送达ACK查询而非重放；两文档关一份不误伤另一份
longLivedFacts.test.ts：不加idle TTL；同值设置/空间切换不使正常会话无谓失效；真实token/端口改变软件更新事实，不把旧文档句柄当永久

**目标断言：**

只给外部Agent一句明确作品指令，软件/Agent自发现已装果铃并消费实际workspace/profile/permission/owned-attached，不让教师抄Token/技术ID
目标歧义问作品位置，真实越权保边界；日志不输出token/secret

**必要实际动作：**

冷开人工代表链：果铃未运行→已授权客户端一句改副本的标题并保存→自动找到/连到产品→真实V10回执；退出客户端→教师开果铃看到修改继续编辑；重启后同配置再连
GUI已经运行时第二客户端attach同owner并改另一文档；关闭第一文档仍可继续第二文档

**条件范围：**

先以零模型SDK/真实bootstrap证明生命周期；仅S12-T01/M12-T05确需真实CLI时用既有授权Codex/OpenCode Luna或Claude DeepSeek；不得先跑整CLI文件
产品自连须已安装/已分发入口消费，源码repo的tsx launcher成功不能替代产品自发现；本轮不安装环境、不打包发布

**计划命令（不全部默认运行）：**

command: npx --no-install vitest run tests/unit/mcpServerLaunch.test.ts tests/unit/mcpSdkClient.test.ts tests/integration/g20ResidentMcpServer.test.ts
status: planned_not_run
expected_matching: 至少1个实际执行且通过；任何skip/零匹配均不证明该属性
command: npx --no-install vitest run tests/integration/productFollowup/T04/
status: planned_not_run
expected_matching: 至少1个实际执行且通过；任何skip/零匹配均不证明该属性


### T05 网页已授权任务、外部操作及人工接续

**独立写域：**

tests/integration/productFollowup/T05/
tests/unit/productFollowup/T05/
tests/e2e/productFollowup/T05/

**既有可复用（静态路径已核，当前输入再核）：**

tests/integration/g20BrowserActionApprovals.test.ts（原one-use有效边界，不保留逐动作确认产品偏差）
tests/integration/g20ManagedBrowserTakeoverWait.test.ts
tests/integration/g20HtmlActionsTools.test.ts（只语义、不手填内部身份）
tests/integration/g20HtmlActions.test.ts（当前HTML行动服务）

**反例建议（按实际改动合并等效）：**

authorizedTaskBrowser.test.ts：已授权低风险同页连续click/type不逐项问；内置与external同grant消费；新不明确结果只问明确选项
takeoverRepair.test.ts：隐藏/显示保同页DOM；snapshot失败后真实human控制仍可操作；resume废旧观察、unknown写不重放
browserFileHandoff.test.ts：已授权公开PDF下载→材料提取；读取不误被包装edit要求写审批；上传在真实授权root内闭合

**目标断言：**

目的授权与具体页面动作对应，仍不扩为任意外部写入；后台确需人工时尽早清楚接续，不ready后才失败
当前HTML源码的观察/点击/输入/错误服务同时服务内置及外部

**必要实际动作：**

本地受控网页：一句已授权填写搜索字段并展示结果→两次动作→人接管改值→回Agent读取新值；外部同样执行；中途注入snapshot失败后人仍可键盘输入

**条件范围：**

用本地固定页证明，不联网采购、不新浏览器账号；实际登录站点只有本任务明确需要且授权时跑一个代表样本

**计划命令（不全部默认运行）：**

command: npx --no-install vitest run tests/integration/g20ManagedBrowserTakeoverWait.test.ts tests/integration/g20HtmlActionsTools.test.ts tests/integration/g20HtmlActions.test.ts
status: planned_not_run
expected_matching: 至少1个实际执行且通过；任何skip/零匹配均不证明该属性
command: npx --no-install vitest run tests/integration/productFollowup/T05/
status: planned_not_run
expected_matching: 至少1个实际执行且通过；任何skip/零匹配均不证明该属性


### T06 Office当前结果、撤回、保存与课件输出

**独立写域：**

tests/integration/productFollowup/T06/
tests/unit/productFollowup/T06/
tests/e2e/productFollowup/T06/

**既有可复用（静态路径已核，当前输入再核）：**

tests/integration/unifiedOfficeFileService.test.ts（真实OOXML/file owner、版本/stop）
tests/integration/unifiedOfficeAgentFiles.test.ts（真实授权与observed binding）
tests/integration/unifiedOfficeFiles.test.ts（原格式语义；整文件含环境条件，需选native Office content operations）
tests/unit/componentPlatformX2Pptx.test.ts
tests/unit/componentPlatformRichTableDocx.test.ts
tests/unit/componentPlatformDocxSemantics.test.ts
tests/unit/x1MixedDelivery.test.tsx

**反例建议（按实际改动合并等效）：**

officeResultParity.test.ts：内置/external同一原格式inspect→内容编辑默认可见→可靠撤回→save当前结果；失败/unknown不谎报saved，不覆盖后来外部人工修改
courseOfficeDelivery.test.ts：同V10当前混合快照PDF/PPTX/DOCX向两AI同能力公开；生成/应用/写盘分别表达；DOCX仅Flow、PPTX现范围如实报告局部差异
格式样本各一个：DOCX混合runs/表格/无关图片，XLSX公式及依赖单元格，PPTX标题/备注/无关shape；不扩完整Office编辑器

**目标断言：**

Office编辑是原格式内容而非把文本伪装文件；回退拒绝覆盖后来人工作品
支持局部制品和诊断，不用一个不支持对象拒整份有效输出；静态输出不称互动保全

**必要实际动作：**

已装关联Office打开DOCX/XLSX/PPTX各一份，核指定文字/公式显示/备注与无关图片；没有关联环境记blocked，不安装替代品
同一V10混合样本保存后输出PDF/PPTX/Flow DOCX，真实重开或渲染看首个代表页、表格和数学；只操作现有受支持格式

**条件范围：**

unifiedOfficeFiles整文件可能启动已有Windows Office/LibreOffice分支；命令必须先审核匹配标题及环境，默认只选纯OOXML描述组；真实Office人工动作另记

**计划命令（不全部默认运行）：**

command: npx --no-install vitest run tests/integration/unifiedOfficeFileService.test.ts tests/integration/unifiedOfficeAgentFiles.test.ts tests/unit/x1MixedDelivery.test.tsx
status: planned_not_run
expected_matching: 至少1个实际执行且通过；任何skip/零匹配均不证明该属性
command: npx --no-install vitest run tests/integration/unifiedOfficeFiles.test.ts -t "native Office content operations"
status: planned_not_run
expected_matching: 至少1个实际执行且通过；任何skip/零匹配均不证明该属性
command: npx --no-install vitest run tests/integration/productFollowup/T06/ tests/unit/productFollowup/T06/
status: planned_not_run
expected_matching: 至少1个实际执行且通过；任何skip/零匹配均不证明该属性


### T07 当前source、HTML/PPTX导入和身份资源

**独立写域：**

tests/integration/productFollowup/T07/
tests/unit/productFollowup/T07/
tests/e2e/productFollowup/T07/

**既有可复用（静态路径已核，当前输入再核）：**

tests/integration/q2ProjectFileSources.test.ts（当前V10 source/body/missing-media、真实Main save/new Host冷开）
tests/unit/timedR1CopyReferences.test.ts
tests/unit/timedR1DefinitionCollision.test.ts
tests/unit/g20M21PptxCourse.test.ts（现createCourseFromPptx/archive，需记录真实V10assert而非名字推断）
tests/fixtures/pptxImport.ts
tests/fixtures/pptxMedia.ts
tests/fixtures/html-source-edit/two-column.html
tests/integration/unifiedHtmlSourceDeepEdit.test.ts
tests/e2e/unifiedHtmlSourceDeepEdit.spec.ts（当前独立HTML文档真实host，不等于V10课件导入）

**反例建议（按实际改动合并等效）：**

importCurrentSource.test.ts：软件准备目标内容，普通HTML/PPTX经同导入器进真实V10，AI不写marker/身份登记；局部资源缺失保可用页与可恢复原件
currentSourceIsolation.test.ts：共享/私有源码owner、复制trigger/visibility/Flow paragraph anchor重绑定；布局/数据/未改模块保留
ordinaryLinkInput.test.ts：电话、普通相对链接可保存；软件自产长路径可读可续改，不被任意500字符门拒

**目标断言：**

真实CourseV10Driver+active Gateway consumer，未使用course-v9作为当前fixture；不静态化原创程序
改字不重测/重装整页，互动状态与frame不变；保存新进程重开无需staging/聊天目录

**必要实际动作：**

已有PPTX样本→一句导入可编辑课件→改一个字→Undo/Redo→保存→冷开，选中文字和媒体仍可编辑，原PPT保留
第三方HTML含按钮和局部script→导入当前工程→改局部文本→实际点按钮看state变化→冷开后再次可点

**计划命令（不全部默认运行）：**

command: npx --no-install vitest run tests/integration/q2ProjectFileSources.test.ts tests/unit/timedR1CopyReferences.test.ts tests/unit/timedR1DefinitionCollision.test.ts
status: planned_not_run
expected_matching: 至少1个实际执行且通过；任何skip/零匹配均不证明该属性
command: npx --no-install vitest run tests/unit/g20M21PptxCourse.test.ts tests/integration/unifiedHtmlSourceDeepEdit.test.ts
status: planned_not_run
expected_matching: 至少1个实际执行且通过；任何skip/零匹配均不证明该属性
command: npx --no-install vitest run tests/integration/productFollowup/T07/
status: planned_not_run
expected_matching: 至少1个实际执行且通过；任何skip/零匹配均不证明该属性


### T08 真实装配绘制、Player资源、长导出/maxHTML

**独立写域：**

tests/integration/productFollowup/T08/
tests/unit/productFollowup/T08/
tests/e2e/productFollowup/T08/

**既有可复用（静态路径已核，当前输入再核）：**

tests/unit/htmlMeasuredStacking.test.ts
tests/unit/htmlModuleClosure.test.ts
tests/unit/TeacherControllerMatureUiV10.test.ts
tests/unit/x1MixedDelivery.test.tsx
tests/fixtures/componentPlatformMixedDeliveryFixture.ts
docs/archive/local/evidence/20261006-required-evidence/r1/probe-summary.json（原revision32/268实例样本、0模型观察，原范围复用）

**反例建议（按实际改动合并等效）：**

paintRepresentation.test.ts：pseudo、relative z:auto、非context父、group opacity/filter/backdrop、Flow root背景分别用最小源样本→真实片段表示，必要像素case合为一页
runtimeDependencyScope.test.ts：已识别remote refs传实际img/media/font/style消费者；未用或后页坏素材不挡首屏；坏图输入保存范围真实；measurement失败尝试现可用整段program carrier
longExportCancel.test.ts：fake clock超过旧120秒但仍有进度能成功；真实取消销相关owner，晚结果不应用；无响应检测仍保留
maxHtml.test.ts：复用已有大单HTML/当前大课件副本，不生成虚假“最大上限”；跨原50MiB提示边界仍可继续可用输出，产物真实打开并点击一个核心互动
teacherNavigationExistingCount.test.ts：已可运行13按钮在当前人工/AI编辑入口可改，正式保存/冷开保导航；不机械逐按钮截图。

**目标断言：**

结构检查仅定位paint/root表示，视觉必须实际render；同一最小页并置源与工程结果，无固定4px之类凭空门
maxHTML表示最大已选代表样本/现已支持大输入，记录实测尺寸与时间，不承诺无界容量
导出不因累计任务时间/人为字节预算失败；局部diagnostic按是否影响用户目标分类

**必要实际动作：**

真实窗口打开组合最小页：看pseudo、透明组、背景、叠层；点一个互动、下一页与教师控制台；输出同快照HTML并打开点同互动
复用rev32大样本的已有效观察不重跑；只有相关render/resource/export变更才再对同一副本观测一次。若已有maxHTML来源不可读，先记blocked并找已授权可用大样本，不新造整课

**条件范围：**

旧componentCatalogV8Matrix不是V10通过；无需整component catalog/所有截图；运行时源码与build cut要明确一致

**计划命令（不全部默认运行）：**

command: npx --no-install vitest run tests/unit/htmlMeasuredStacking.test.ts tests/unit/htmlModuleClosure.test.ts tests/unit/TeacherControllerMatureUiV10.test.ts
status: planned_not_run
expected_matching: 至少1个实际执行且通过；任何skip/零匹配均不证明该属性
command: npx --no-install vitest run tests/integration/productFollowup/T08/ tests/unit/productFollowup/T08/
status: planned_not_run
expected_matching: 至少1个实际执行且通过；任何skip/零匹配均不证明该属性


### T09 资料→计算/图片→独立成果交付

**独立写域：**

tests/integration/productFollowup/T09/
tests/unit/productFollowup/T09/
tests/e2e/productFollowup/T09/

**既有可复用（静态路径已核，当前输入再核）：**

tests/integration/g20MaterialFind.test.ts（隔离extractor fixture、真实格式locator）
tests/integration/g20ComputeJobRecovery.test.ts（确定性job/stop/unknown）
tests/integration/g20HostArtifactDelivery.test.ts（真实FileArtifact边界；默认不运行80MiB compute case）
tests/integration/g20ComputeToolChain.test.ts（真实Podman case依赖G20_TEST_PODMAN_IMAGE，skip非通过）
tests/integration/g20TwoImageExecution.test.ts（须核provider为fixture后使用）

**反例建议（按实际改动合并等效）：**

selectedMaterialInput.test.ts：人工勾选课例/采用片段进入同一次AI请求；PDF真页/PPTX页/DOCX无假页码；课例与聊天附件来源不串
computeInputOutput.test.ts：用户CSV软件桥接沙箱→可用CSV/图表回收→成果文件交付；坏辅助文件不拖掉有效成果，输出目录契约一致
imageCurrentTarget.test.ts：真实结果卡消费当前V10目标；图片生成/参考修图→资源应用→保存冷开；未配置语音/视频/音乐/搜索诚实不可用

**目标断言：**

环境和provider已有配置才真实执行；fixture不能证明容器/供应商/参考图实际送达
独立成果和课件资源不同owner；产物ready不是已写盘；未知外部结果先查证不重放

**必要实际动作：**

已有计算环境只做一份用户CSV→一个统计值与图表→外部同能力保存文件；无WSL/Podman镜像记blocked，不安装
仅任务确需图片时，已授权GPT OAuth同一次代表链生图并参考修改，应用当前工程，真实冷开能显示；记录真实执行者/模型/费用，不换独立API

**计划命令（不全部默认运行）：**

command: npx --no-install vitest run tests/integration/g20MaterialFind.test.ts tests/integration/g20ComputeJobRecovery.test.ts
status: planned_not_run
expected_matching: 至少1个实际执行且通过；任何skip/零匹配均不证明该属性
command: npx --no-install vitest run tests/integration/g20HostArtifactDelivery.test.ts -t "atomically creates|obeys stop before commit|keeps an unknown result queryable|uses a definite publication rejection"
status: planned_not_run
expected_matching: 至少1个实际执行且通过；任何skip/零匹配均不证明该属性
command: npx --no-install vitest run tests/integration/productFollowup/T09/
status: planned_not_run
expected_matching: 至少1个实际执行且通过；任何skip/零匹配均不证明该属性


### T10 History、恢复结算、资源成本和辅助记录

**独立写域：**

tests/integration/productFollowup/T10/
tests/unit/productFollowup/T10/
tests/e2e/productFollowup/T10/

**既有可复用（静态路径已核，当前输入再核）：**

tests/integration/componentPlatformSession.test.ts（T01通过同cut即可复用不重复）
tests/integration/timedR1SourceHistoryContinuation.test.ts（源范围跨恢复/撤回trace）
tests/integration/g20ChangeReview.test.ts（真实文件回退与后来人工编辑保护）
tests/integration/g20S06StopSnapshotReplay.test.tsx（伪provider、Markdown停止/重复delta）
tests/unit/recoveryWriteCoordinator.test.ts

**反例建议（按实际改动合并等效）：**

recoveryScope.test.ts：坏一份journal保原件和其他文档；断ACK查询当前结果；恢复不自动重放外部写/已结算修改
auxiliaryFailure.test.ts：进度/笔记/出处辅助写失败不能吞已完成业务回执；正式document持久化失败仍不得commit
historyResourceOwnership.test.ts：小文字编辑History不重复携带未改资源，同时undo/redo/冷开保资源；用实际引用/所有权和一个代表采样验证，不Hash性能门
outcomeClassification.test.ts：failed查询不是新动作失败；warning与目标差异区分；修复后当前结算可恢复，未解决unknown仍诚实
C22/ASTRA-F15：不可读日志没有documentId/path且无可用binding index，非readOnly assertAvailable和无关文件save仍可用并保原日志；readOnly open或已知binding A/B例不足。

**目标断言：**

无wrong-target/停止后写入/重复正式提交；History唯一owner；恢复范围以真实失败文档限定
性能只在直接变更history/resource时测一代表样本，不声称已证OOM/8倍提速；单调时钟分prepare/model/apply/render/save
真实未知写后副作用不盲重放，定位到特定损坏文档仍保原必要边界；不把未知归属一条日志变为全局保存禁令。

**必要实际动作：**

两文档副本：A一处未保存，B已保存→仅A恢复记录损坏→B仍可打开继续；恢复A原输入后不产生新的模型/网络/文件副作用

**计划命令（不全部默认运行）：**

command: npx --no-install vitest run tests/integration/timedR1SourceHistoryContinuation.test.ts tests/integration/g20ChangeReview.test.ts tests/unit/recoveryWriteCoordinator.test.ts
status: planned_not_run
expected_matching: 至少1个实际执行且通过；任何skip/零匹配均不证明该属性
command: npx --no-install vitest run tests/integration/productFollowup/T10/
status: planned_not_run
expected_matching: 至少1个实际执行且通过；任何skip/零匹配均不证明该属性


### T11 当前格式工具与资料/类型债诊断

**独立写域：**

tests/integration/productFollowup/T11/
tests/unit/productFollowup/T11/
tests/e2e/productFollowup/T11/

**既有可复用（静态路径已核，当前输入再核）：**

scripts/validate-project.ts（先核实际当前格式入口，不运行旧V9 validator当V10证明）
docs/development-plan/CURRENT_STATUS.md:27
docs/development-plan/20261006-required-fixes-result.md:56-58（原App窄30诊断：3ambient/27源码；旧全仓4030是历史，不重跑）
tests/unit/g20DocumentSession.test.ts（混有V9；Session通用标题可用，不能替代当前V10）

**反例建议（按实际改动合并等效）：**

currentFormatValidation.test.ts：当前保存的V10文件经真正对外validator能读；旧格式保原件明确不兼容，不造converter
maintenanceSourceCheck：只读确认文档/Skill能力引用真实已交付consumer，报告C45卫生复用历史收敛，不当产品缺陷或再建门
O18逐个已有carrier判定：裸域URL、discovery enum/版本/limit/ID、Flow fit-content/auto；反证/不支持可据当前证据关闭，非每项一律新增测试。

**目标断言：**

baseline红按原有效diagnostics和当前相关diff归因；存量类型/旧测试债单列维护维度，不冒充当前可用性P1
新增改动导致的目标行为失败必须修，禁止any/放宽断言/过滤隐藏；类型债若落在当前改动真实consumer闭包并妨碍正确运行，则本包承担，否则明确保留

**条件范围：**

不得默认npm run typecheck/verify/test:product/test:e2e全矩阵；需要类型证据时T在专属测试写域给受影响真实import闭包的窄tsconfig，E只运行该明确npx --no-install tsc -p <已存在文件> --noEmit命令；配置不能删consumer或弱化类型选项

**计划命令（不全部默认运行）：**

command: npx --no-install vitest run tests/integration/productFollowup/T11/
status: planned_not_run
expected_matching: 至少1个实际执行且通过；任何skip/零匹配均不证明该属性

## 分阶段独立review

### R0

id: R0
depends: 窄接口/结果合同及本包直接范围草案
reviewer: R-A0 Astra xhigh，与A/I架构实现分离
scope: 尚未批准的重要owner/核心入口迁移：读当前基线、直接consumer、局部修/复用替代和保留行为；已批准路线不重复审批
blocks: 仅相应未定结构选择
test_groups: T01
T02
T03
T04
T06

### R1

id: R1
depends: 各内容/能力/草稿候选实际diff与该组聚焦结果
reviewer: R-A1 Astra xhigh审正式writer/History/保存迁移；R-S1 Sol high审普通caller/局部修复
scope: 原样例、现diff、binding/draft/current-save消费者；AI承担的机械字段是否真正退出；新增检查门是否保护当前错写/数据损坏/不能运行
blocks: 仅被审候选合入；无重叠已就绪叶继续
test_groups: T01
T02
T03

### R2

id: R2
depends: 各MCP/网页/作业候选固定cut及对应本地反例
reviewer: R-A2 Astra xhigh审跨进程/异步owner/停止迁移；R-S2 Sol high审普通入口
scope: 真实bootstrap/长效接续、文档隔离、网页grant/接管、unknown不重放及配置诚实；不以paid未配置阻塞无关能力
blocks: 仅相关候选
test_groups: T04
T05
T09
T10

### R3

id: R3
depends: 各装配/source/Office/output候选diff、原样本和最近层结果
reviewer: R-A3 Astra xhigh审成熟算法/资源/保存/核心output迁移；R-S3 Sol high审局部接线
scope: 原专业算法、source共享/私有owner、paint表示/真实视觉、局部导入和当前结果保存；逐项核删除/放宽断言与新静态门的必要性
blocks: 仅相关候选
test_groups: T06
T07
T08

### R4

id: R4
depends: 拟汇合cut实际diff；所有实际改动族的有效证据；一次必要build；代表GUI/冷开链
reviewer: R-A4 Astra xhigh审重要集成候选（不得参与I接线）；R-S4 Sol high审ordinary整合与T11
scope: 集成消费者和原始结果，50+131覆盖表逐项标记covered/reused/blocked/not-applicable及理由；只对跨族真实交互补一次最少链，不机械重跑此前绿色
blocks: 仅当前汇合候选/未证明能力的完成声明，不阻断就绪独立任务
test_groups: T01
T03
T04
T06
T07
T08
T11

阶段是滚动里程碑，不是全部叶开工墙。R只阻本批相应重要选择/待合候选，独立ready继续。R0–4读基线/diff/直接consumer/原样本，新门用README四问审；既绿证据不因审查者/阶段变作废。少量真实黄金链跨族共享：教师改写+属性/源码/JSON→自然生效→一次撤回重做→保存→正常关→新进程冷开；本机产品自连→同作品应用保存→GUI接续→正常结束；资料/已有计算/生成素材→节点新增/转换→真实格式交付；一个必要CSS与互动真样例。环境缺则如实范围，不全矩阵。

结果记实际cut/命令/匹配数/样本/载体/输出/未测，不新证据平台。自动化最多engineering candidate，真实画面/互动和Owneraccepted不同，发行暂停。
