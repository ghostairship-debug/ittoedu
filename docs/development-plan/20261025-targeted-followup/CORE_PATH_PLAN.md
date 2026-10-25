# 选中、拖动、关闭与保稿：定位及修复方案

2026-10-25。**状态：仅定位与方案；本项不实施产品或测试修改，不commit／push／发布。** 输入依据是[上轮综合结果](../20261024-regression-boundary-repair/RESULT.md)、[剩余告警](../20261024-regression-boundary-repair/REMAINING_RESULT.md)及下列原始报告。页面卡片布局、AI外观和另外两项未决由其他工作包处理，不在此扩面。

## 1. 结论与顺序

这些是核心编辑路径，不能因“旧红例”统称边缘。当前证据也不支持“14个Slide产品故障＋4个Shell产品故障”：旧测试混有已批准手势迁移、浏览器paint前置、过时API夹具及尚未到达的正确行为断言。

本次只做了一次单用例mounted协议探针，取得一个需要优先修的具体候选：**Slide的Source字段手势等待旧输入ACK时，如果用户已从Nodes改选另一个对象，旧ACK返回后仍发出原字段的选中回调。** DOM手势已核选择身份，realm pointer分支只核页面／会话上下文，漏掉新选择。探针没有证明发生正式内容错写、丢稿或真实浏览器操作必然命中；不能扩大到所有选中或所有慢ACK都坏。

建议接续顺序：

1. 先在真实Bridge装配确认上述“慢ACK＋Nodes改选”路径，并修当前realm手势owner的过时延续；保留同目标正常ACK续接。这是**核心路径修复候选，P1排查／修复优先级**，当前已证实到过时选中请求，没有P0数据损坏证据。
2. 同批核“冲突时关闭被阻止、保稿不覆盖磁盘、取消后仍可编辑、恢复稿重开”这条真实Shell／Main组合路径。它是**核心数据保护待验证项**；现有4条历史失败尚未证明产品丢稿，不能直接定为已发生P0／P1事故，也不能说已验收。
3. 其余Slide按实际paint与手势入口归并验证；新建／菜单／PPT补正确前置后再看是否暴露产品问题。前置缺口属**测试维护维度P2**，发现误选、错改、无法完成编辑或丢稿时按实际用户结果提升，不用红例数量升级。

## 2. 一次新诊断：旧ACK发出过时选中请求

只在ignored `output/test-runs/targeted-core-path/`新建定向诊断与配置，复用原`slideContentFirst20261022`的mounted `SlideLocationWorkspace`及可控ports；没有改`src/`、`tests/`、正式配置或正确断言。只运行一次、一个worker、一个用例。

步骤：Source `custom/field`发合法`component-author-pointer`（phase=start，明确authorKey）；已有输入的`commitTextEdit`等待；将view改为Nodes选择`text`且新的编辑器也属于`text`；释放旧ACK。期望旧手势不再发出选择。

实际记录：

```text
新选择：objects ['text']；新编辑器：text
旧ACK后 selectAuthorSpot：custom / field，1次
beginSpotEdit：0；整工程 capture：0；report：0
“selectAuthorSpot不得调用”断言失败
```

证据：[事实](../../../output/test-runs/targeted-core-path/slide-late-realm-facts.json)、[报告](../../../output/test-runs/targeted-core-path/slide-late-realm-report.json)、[诊断源码](../../../output/test-runs/targeted-core-path/slide-late-realm.test.tsx)。该probe的selection port是spy，因此只签“生产事件处理器在此时序发出了过时选中回调”，不签Main／Bridge实际改错模型。它也不是原14条旧红例被修复或重新归因的证据。

源码落点：[SlideLocationWorkspace.tsx](../../../src/renderer/ui/workspaces/SlideLocationWorkspace.tsx)：

- `pointerContext`（约165行）包括文档、epoch、根、编辑容器、页面、state、模式、group，不包括selection。
- DOM路径`captureInputIntent/sameInputContext`（约505—513、946—960行）在paint及ACK返回后同时核意图与选择；双击路径也复用该保护。
- realm `authorPointer`（约596—691行）的`next/begin`在旧`commitTextEdit().then(begin)`后只核`realmPointer`对象和`pointerContext`，同页Nodes改选不会使这些条件失效。

**若真实Bridge定向复现相同结果，修复就在此现有owner完成**：为realm start冻结当前输入意图和选择身份，等待ACK／决定开始手势前重核；新选择、新输入、取消或上下文变化让旧延续退出。不要用额外selection store、全局暂停、第二writer或“总以当前Nodes为准”的重命中补丁。开始手势后由其已冻结对象和原几何owner管理update/end，不能把自身合法选中误当外部改选而取消。右键／双击沿各自现有授权入口，发现同一失效条件实际可达才补，不机械重写所有事件。

## 3. Slide其余14条：逐条保留正确属性，先修到达条件

原始报告：[3过／14失败](../../../output/test-runs/regression-boundary-repair/slide-after-mock.json)。已补的`nativeText.resolveSelection`只修了原3条遮蔽；此处14条不回滚那项修复，也不把它们统一判成产品故障。

共同前置证据：旧fixture只提供统一`getBoundingClientRect`、PointerEvent与capture，没有`adoptedStyleSheets`、`replaceSync`、`elementsFromPoint`及真实paint；生产[componentPaintStack](../../../src/components/web/paintHit.ts)明确需要这些能力，上轮终点raw也记录了该文件的`adoptedStyleSheets` unhandled。实际paint返回Promise，原部分断言仍在pointer事件后同步要求出现RAF／回调；不能以零调用直接判拖动owner不执行。不得给产品加jsdom兜底或全局mock样式来掩盖。

| 原用例（`slideContentFirst20261022.test.tsx`行号，名称可在原报告唯一查） | 已观察失败与分类 | 仍要保护的用户行为 |
|---|---|---|
| 78：object preview／actual up point | 同步期待pending RAF=1，实为0；异步paint及环境前置未建立 | 对象主体拖动使用实际up点，只提交一次；不能把移动写给当前坐标下的邻对象 |
| 101：drag click suppression | commit=0；同一前置阻断，未到click suppression有效验收 | 拖完释放后的click不打开字段编辑、不抢另一个目标 |
| 138：HUD preview／actual up | 同步RAF=0；HUD已改从真实可见命中后仲裁，旧入口不能证明实际HUD不能拖 | 原教师台位置／缩放换算正确，纯点击零History |
| 205：hover coalescing | hit requests=0；paint请求尚未建立 | hover只提供反馈、不写内容；旧响应不能覆盖新位置／新选择 |
| 233：older hover／new native content click | 期待单击`native.capture`立即进入输入；该默认动作已被批准撤换 | 迁移为“新的对象选择或已显式进入的输入”后，旧hover仍不得抢回选择 |
| 244：single-click native text | 直接期待单击开输入，与已批准“单击选择、双击编辑”冲突 | 改查单击只选中、双击才输入，原零内容写入／准确对象断言保留；不恢复旧产品动作 |
| 256：capture field before flush／resume ACK | 仍经旧单击输入路径，commitTextEdit未被调用 | 沿双击或正式字段编辑入口冻结精确目标；ACK后不重新按旧屏幕坐标命中邻对象 |
| 275：realm field／bounded UTF16 caret | pointer即要求beginSpotEdit；当前pointer只选择，double-click才编辑 | 精确authorKey／mount generation不退化为父实例；有界UTF16 caret在真正编辑入口验证 |
| 289：later Nodes during ACK | 旧单击路径尚未进入ACK前置 | 新Nodes选择及新输入不得被旧延续抢回；本节2的独立probe已暴露realm start分支的具体缺口 |
| 307：exact field menu identity | request identity为undefined；paint／字段请求前置未到 | 右键菜单必须绑定原字段，换选后旧菜单callback无效，不能修改父对象 |
| 330：Source non-field body drag | `resolveHit is not a function`，说明尚无可释放的异步命中回调 | Source不暴露字段的可见区域仍能拖原对象；延迟响应后不能重新命中移动过来的邻对象 |
| 350：Source non-field context menu | 同上，未到原对象菜单断言 | 菜单仍针对按下时的原对象；不顺带改变父／子选择规则 |
| 369：old pointer paint after Nodes | 同上，未到等待后防抢焦／防flush断言 | 旧pointer结果不得提交／关闭新编辑器，不把前置失败当边缘问题 |
| 369：old double-click paint after Nodes | 同上；DOM双击已有sameInputContext保护，尚不能据旧callback未建立说它失效 | 双击意图在新选择后失效；正常同目标慢ACK仍能继续，不能过度取消合法输入 |

迁移方式应优先复用[unifiedSelectionSlide现有装配](../../../tests/unit/unifiedSelectionSlide20261024.test.tsx)及原真浏览器harness；该fixture已明确提供局部paint能力、正式Bridge／Session／History，已有主体验证不能因本批计划重复跑全文件。单个输入／手势前置调整时保留原frame、邻对象、准确字段、一次History和取消断言；真正paint属性用Chromium，不用人为伪造绘制结果来签视觉／命中正确。

## 4. Shell的4条历史同点失败与当前owner

证据：[当前报告](../../../output/test-runs/regression-boundary-repair/shell-current.json)、[2376311b3历史报告](../../../output/test-runs/regression-boundary-repair/shell-historical-2376311b3.json)。两版均5过／4失败，只能证明这些失败先于本批，不足以证明其后续用户路径已通过。

| 原失败 | 新核对出的具体原因／证据 | 修复方案边界 |
|---|---|---|
| LessonWorkspaceShell：untitled document创建 | 旧`Markdown 文档名／创建文档`不再存在。当前[WorkspaceDocumentTabs](../../../src/renderer/lessonWorkspace/view/WorkspaceDocumentTabs.tsx)已有“新建标签页→文档名→新建MD文档”，[createSource](../../../src/renderer/lessonWorkspace/controller/useDocumentTabsController.ts)仍正式`api.create`并创建untitled绑定 | 先沿现有入口继续真实创建，核空source、唯一Session、无CLI fallback；不为旧query恢复旧UI |
| LessonWorkspaceShell：conflict close／preserve | 旧fixture [markdownRendererHost](../../../tests/helpers/markdownRendererHost.ts)::observeFile仅返回disk model/version，遗漏真实Main [DocumentHostService::observeDisk](../../../src/main/workbench/DocumentHostService.ts)提供的`baseSource=session.readSavedSource()`。dirty session重挂后，[DocumentFileSession::open/observe](../../../src/renderer/documentFiles/documentFileSession.ts)因没有保存基线，走整稿比较／`conflictHunks=[]`；UI因此没有逐hunk的“此处保留当前稿”。它没有静默把磁盘当基线 | 用真实Main临时文件装配核逐处冲突和无基线诊断两条既有语义；保留close=false、原editor、canonical draft、History、不覆盖磁盘全部断言。不得只替换按钮query并报保稿通过 |
| g20M21TabMenu：菜单能力 | 同一旧新建前置阻断，尚未执行右键／禁用原因。当前菜单仍来自[documentTabCommands](../../../src/renderer/lessonWorkspace/view/documentTabCommands.ts)，重命名等现存动作应按当前实际授权能力核，不能截掉新增项凑原数组 | 前置采用当前正式创建入口；随后验证单一菜单、未保存路径动作禁用理由、当前关闭目标；发现额外能力变化先查既有决定，不借夹具迁移改产品 |
| g20M21PptxEntries：PPT导入 | 原raw已证明回调收到正确name/bytes，差异是已存在的AbortSignal和foreground函数；[controller](../../../src/renderer/lessonWorkspace/controller/useLessonWorkspaceController.ts)约249—261行明确传三参。后续旧断言还使用已废弃`project.surfaces`，单改回调断言并不足够 | 生命周期参数按现有语义验证；实际课件改按正式rootIds/instances/container检查一页Slide及原内容，继续保留真实解析、取消与不抢后来工作区断言。不新增兼容surfaces writer |

关闭不是一个按钮统一负责：

- 单标签X／菜单关闭：`useDocumentTabsController.closeTab → LessonDocumentEditor.close → DocumentFileSession.close`，先确认输入；冲突时拒绝并保留标签。
- `closeAll()`（Shell handle）先`flushAll`，遇未解决冲突返回false，不等价于应用级“保全输入后交Main选保存／放弃”。
- 应用／Main请求：`App.tsx::preserveBeforeClose → LessonWorkspaceHost.preserveAll → tabs.preserveAll → editor.preserveDraft`，只保全后由原`documentCloseDialog/documentCloseFlow`决定保存／放弃／取消、停止屏障及最终CAS。
- `DocumentFileSession.preserveDraft`不要求覆盖磁盘；冲突raw走原辅助恢复存储，正式已确认稿仍由DocumentSession负责。关闭取消应resume同一输入owner；不得用强制save、强制discard或清空冲突来“修”关闭。

## 5. 最少真实路径复现与实施落点

以下是接续时的最小核查包，**不是本轮已跑清单**。前一条已提供充分证据就停止；只有发现真实断点才修对应owner并增加相应直接消费者，不启动旧红全清零或全仓矩阵。

| 包 | 真实用户路径及成功标准 | 若失败的修复落点／保留能力 | 最小充分验证 |
|---|---|---|---|
| S1：旧ACK与新选择（先做） | Source字段已在编辑；让该次正式提交ACK可控等待；按下另字段／区域后从Nodes选B并进入B输入；释放A ACK。仍选B、B输入不被flush/关闭，A仅原合法提交一次；不抢焦、不写B以外目标 | `SlideLocationWorkspace.authorPointer`的既有意图／选择失效检查。沿现有DocumentSession、精确authorField和CAS；不能退回几何重命中、父对象移动或全局取消 | 一个真实Bridge mounted时序用例，保留A/B内容和History断言；真实Source realm Chromium只跑该操作链，确认协议确实走同分支。另用既有同目标慢ACK例证明合法续接未被取消；当前已有效证据未受修改时不重跑 |
| S2：主体拖动／菜单 | 两个相邻对象（一个Source），单击选择；在Source可见非字段区拖动，下／上发生在paint回复前；延迟期间另一对象移到旧位置。最终只改原目标一次；拖后不打开字段；旧hover/menu回调不抢新选择 | `resolveVisibleAt`后的冻结id、`sameInputContext`、原workspaceSlideAuthoring／FreeTransformGesture；HUD仍原视口几何owner。仅证实错误时修，不为旧同步RAF断言改产品调度 | 复用同一Chromium小工程记录目标id、frame、一次History及Undo；只有几何／scope实际受改才加该分支。已有正常native拖动和图片拖动证据继续有效 |
| C1：真实磁盘冲突＋保稿（与S1并列核心） | 临时MD由Main打开、正式教师改A，磁盘同处改B，再挂Shell；看到冲突。点标签关闭／调用Shell closeAll均保留标签及原editor，不覆盖B；调用原preserveAll成功保全A与手工冲突raw，再经新Host恢复能看见；取消关闭后继续输入、一次Undo正常 | `DocumentFileSession.open/observe/confirmInput/preserveDraft/close`、`LessonDocumentEditor.activeDraft`、tabs注册／快照遍历。若是fixture漏baseSource，只修fixture正式协议供给；若原稿／raw丢失，修原恢复／输入owner，不建第二稿库。Main关闭屏障／CAS继续保留 | 一个真实Main+临时磁盘的mounted Shell组合链，核disk B、canonical A／raw、History、mounted host及恢复；以现有documentFileSession／g20DocumentClose相关有效证据作下层支撑，只有受改直接case才增跑。不要求物理OS全矩阵 |
| C2：创建／菜单／PPT前置 | 当前新建菜单创建untitled；未保存菜单禁用理由准确；PPT回调三参、正式根容器和内容正确，取消不抢后来的工作区 | 先修原测试前置与协议断言，保留全部数据及目标保护。发现实际创建／解析断点才到原tabs/controller/PPT owner | 每个实际阻断共用前置一次；不因三个旧query失败做三套创建UI。PPT原通过解析部分复用，不能把未到达的后续assert算通过 |

已有[DocumentFileSession正式文件fixture](../../../tests/unit/documentFileSession.test.ts)具体覆盖外部冲突、保留带素材恢复稿、新Host重开、close取消、IME和未知ACK；[Main关闭等待例](../../../tests/unit/documentCloseWaiting20261022.test.ts)覆盖等待对话框出现后即便renderer已ready仍尊重取消。这些源码指出可复用的最小夹具，不能单看用例存在就写成当前已执行通过，也不替代C1缺失的Shell组合证据。

## 6. 产品决定与交付边界

目前建议不需要新增产品能力取舍：继续已确认的单击选择、主体拖动、双击编辑、字段精准目标、同目标ACK续接、冲突显式处理、保稿不强制覆盖磁盘、关闭取消后继续编辑。其技术修复不应重新申请“是否允许不丢稿／不误选”。本文件仅给方案，仍遵守Owner本次“暂不实施”。

若复现结果迫使改变以下任何可见行为，先向Owner说明前后差异并确认，再落实：关闭遇冲突的默认动作／按钮路径，自动保存或自动取舍哪份稿；单击／双击／拖动的默认含义；Source精确字段与父对象的优先级；已存在菜单项或编辑能力的移除。不能把测试、独审或旧计划当成这些新产品选择的授权。

本次没有修改产品、正式测试或历史raw，没有把失败加入白名单；只新增本方案及ignored一次诊断。未宣称14条均修复、Shell保稿已完整验收或全仓通过。
