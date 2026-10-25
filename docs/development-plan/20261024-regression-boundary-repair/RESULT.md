# 架构与统一选中边界回归修复结果

日期：2026-10-25。执行依据：[PLAN.md](PLAN.md)。本轮产品修复、必要验证、独审与诊断已交付根目录；**全量未通过：冻结终点样本新增稳定观察14条，其中12条已在样本后完成补正和定点验证，另2条保留未决；Worker根目录稳定超时、全量unhandled及同名对应限制仍保留。不能宣称“无新增稳定失败”或全仓通过。**

本轮按 Owner 确认恢复入口、实施图片简易面板和 Flow 定位／更多布局，保留单击选择、主体拖动、双击编辑。没有把测试通过或独审当作新的产品授权。未 commit、push、打 Portable、发布或部署；不修改用户作品、AGENTS 或真实用户数据。

**10月25日后续纠正与补证：** 见[定向后续结果](../20261025-targeted-followup/RESULT.md)。自动／逐步前置选择早已取消，不能把repair18离线协议夹具当成当前常用UI入口；本次撤回该产品判断，不恢复选择器。offscreen晚订阅夹具在保留真实初始事件与状态断言后完整4/4；Worker仍未决。页面卡片按Owner明确标注调整；AI格式、Source旧ACK及关闭保稿仅定位和方案，未实施。下文“2条未决”及14条分类保留为本轮冻结样本的历史观察，不回写原raw或用新证据宣称全仓通过。

## 1. 产品结果

| 范围 | 实际结果与保留边界 | 有效证据 |
|---|---|---|
| R1 空程序根插入 | GUI 合法空程序根不再被共享 planner 的 `childIds` 存在性检查误拒。Gateway 整对象句柄接受范围的检查回到其适配处；不扩大公开目标、不批量填充 childIds，不新增 writer。正确第二根、正式 History、Undo／Redo及相关锁定／插入关系由完整文件验证 | `glxRendererConsumers20261020` 10/10，`auditGatewayInsertionLayout20261023` 8/8，见[插入报告](../../../output/test-runs/boundary-focused-first.json)；该组合报告另有中途失败，不能称整份全绿 |
| R1 Flow 试运行 | 点击捕获仅在编辑态执行；实际宿主 DOM 业务按钮在编辑态只选中、拖动结束不触发，试运行恰一次业务点击，回编辑仍可选；原 builtin 教师展开按钮可用。未改教师默认配置、Runtime或导航体系 | [FLOW_RESULT.md](FLOW_RESULT.md)：同一真实 Main／Store／Bridge／Flow 装配的修前0次和修后1次对照、教师按钮、拖动一次 revision／Undo |
| U-R01 HTML 名称 | 顶部恢复“编辑／完成编辑”；保留整体模式 ACK、运行隔离、内部选择／实际输入分离，不引入“创作”大模式 | HTML 原7条及新增图片保护，H；真实 IME 见第4节 |
| U-R02 普通文档快捷动作 | 普通 Markdown／文档原选区五项及既有链接、公式、段落、更多入口恢复；普通文件直接输入，不套用 Flow 选择态。手动格式仍是一条 History，可 Undo／Redo、保存及重开 | D：普通文档与表格4/4；文档10文件有效证据共88例 |
| U-R03 Flow 文档动作 | 正文／源码、既有插入表格、宿主正文互动、需要时的保稿／丢弃与诊断回稳定文档区域，不依赖当前选区条 | D：无选区 mounted 断言；预览用例7/7保留源码切换；真实 Flow 截图可见独立文档区域 |
| U-R04 唯一目标格式条 | Flow 固定文档区域没有第二套目标格式按钮；光标、文字、段落／对象、单元格沿原准确范围命令；图片面板打开时挂起对应选区条 | D、F、I：唯一条及面板互斥、准确范围断言 |
| U-R05 原段落能力 | 光标／代码块不再因“输入位置”等标签失去段落类型入口；按正式块身份和父 schema 判断，显示当前正文／标题级别。引用继续走原段落操作菜单，带出处等禁止丢数据的转换保护保留；不扩大 slot 转换能力 | D：代码转换两例、真实标题光标／一次提交／正式 Undo、引用禁止转换新保护 |
| U-R06 普通文档保留原呈现 | 固定栏恢复原字号／字体／颜色／高亮等呈现；选区条原“当前选区”五项，选区字号／字体仍在更多。只有既有外置host的专业字段使用获批共用控件；普通文件与属性面板单元格不接受组件改版。内容命令及History继续共用 | [DOCUMENT_RESULT.md](DOCUMENT_RESULT.md) 与独审对照 `2376311b3`；原“当前选区斜体”及普通cell“粗体”查询保留；专业范围弹层另有专项证据 |
| D01 图片简易面板 | 双击打开靠近图片的小面板，不自动裁剪或唤起选图；提供原生图替换、裁剪、左右90°、翻转、完整／填充／拉伸、亮度／对比度／饱和度／透明度及展开圆角等原属性。完成／Esc保选，替换保留显示框与布局。HTML／Source内部图片只显示真实字段支持子集，精确写回、不改父对象 | I、F、H及[图片单元报告22/22](../../../output/test-runs/image-panel-unit-final.json)；实际GUI覆盖与未覆盖载体见第4节 |
| D02 Flow 定位与更多 | 唯一对象条直接显示当前纸面／随段落／视口定位；上下文字层、转正文进原“更多操作”，删除复用原菜单。不新增移动条，不折叠内容本身 | F：真实 select 切换、更多菜单及截图；保留原布局 owner |
| R4 取消提示 | 非 owner 仍 `job-not-authorized`、拒绝零取消调用；提示同时适用于只读与接续访问，不再假定所有来访者都是接续任务 | E：ni02 7/7、服务发现6/6及 Engine 原有用例 |
| R4 OAuth 覆盖 | 保留原整轮归档用例；新增离线 `chatgpt-responses` 实际序列化预算压缩，检查真实 compacted、旧 native round 不复活、原 Run 文本保留、call／output 完整配对与预算 | E：新增例最终1/1；未改生产压缩算法、未用真实收费模型 |
| R5 只读 owner 调查 | 确认两项 `object.update.appearance` 与 GUI 的有效外观差异；只报告，不借本轮迁移或改变产品语义 | [OWNERSHIP_INVESTIGATION.md](OWNERSHIP_INVESTIGATION.md)，见第6节 |

链接快捷条另修一个真实范围问题：复用旧固定栏 `openLink` 展开光标所在既有链接，用现有 `trackSelection` 随周边编辑映射；弹层打开后不会改后来选中的文字或在光标重复插入 URL。没有建立第二选择 store 或命令层。

## 2. 原30条告警逐项结论

以下用例原 fullName 未改。表内文件名省略 `tests/unit/` 与扩展名；英文条目或 CA 编号在该文件内唯一可查。**“通过”仅代表该具体行为获得有效观察，不把30条等同30个产品缺陷，也不替代全量比较。** 夹具迁移只对应已批准的显式进入 Flow 输入、唯一格式条及主体拖动，原数据、范围、IME、ACK、Undo、保存和导出断言保留。

证据索引：

- **H**：[HTML_RESULT.md](HTML_RESULT.md)，[HTML文件最终9/9](../../../output/test-runs/html-repair-verified.json)。
- **D**：[DOCUMENT_RESULT.md](DOCUMENT_RESULT.md)。[audit 58/58](../../../output/test-runs/document-audit-final.json)、[普通文档／表格4/4](../../../output/test-runs/document-original-ui-final.json)、[标题文件1/1](../../../output/test-runs/document-final3.json)；后者报告另有一次新增断言失败，按该文件取证。[其余6文件25/25](../../../output/test-runs/document-pass2.json)，该报告标题文件当次清理失败，已单独闭合。
- **S / W / J**：[REMAINING_RESULT.md](REMAINING_RESULT.md)，[Slide 3过／14失败](../../../output/test-runs/regression-boundary-repair/slide-after-mock.json)、[Worker／journal原始聚焦](../../../output/test-runs/regression-boundary-repair/remaining-before.json)。

| # | 文件／原可查用例 | 实际失败点、授权／分类及处理 | 最终证据 |
|---:|---|---|---|
| 1 | htmlPreviewRecoveryUi20261023 — commits the final IME input only once when blur requested completion before compositionend | 真实 IME 回退：blur完成请求晚于compositionend登记，最终中文未提交；修原 CanvasPlainTextEditor owner，在composition期间同步登记、结束读取最终DOM且仅一次 | H，通过；原事件及一次提交断言未改 |
| 2 | 同文件 — ends mode failure waiting and leaves the source editor available without faking an edit-mode ACK | 未确认改名造成“编辑”入口失配；U-R01恢复名称，保留模式失败后源码可用、不伪造ACK | H，通过 |
| 3 | 同文件 — finishes editing after a rejected field while retaining its input, and keeps business interaction blocked until the mode ACK | 名称恢复＋已批准选中／输入分离；夹具明确 `intent: edit`，完成查询限原顶部栏；保留拒绝草稿与ACK前禁业务交互 | H，通过 |
| 4 | 同文件 — keeps the move action in the existing toolbar for 'a left-aligned full-width paragraph' without overlaying the document | 原名含旧按钮路径；按已批准主体拖动迁移，不恢复额外移动条；同一field仅提交一次(30,12)并可读原文字 | H，通过 |
| 5 | 同文件 — keeps the move action in the existing toolbar for 'a split heading run beside other text' without overlaying the document | 同上，独立split-run几何；保留相邻文字与准确handle，未放宽为整父对象移动 | H，通过 |
| 6 | 同文件 — patches an exact selected text change despite an unrelated malformed tail, without reloading the preview | 夹具明确进入已批准编辑；保留精确局改、malformed尾部与预览仅打开一次 | H，通过 |
| 7 | 同文件 — prepares source typed during the recovery ACK instead of returning the captured old source | 夹具明确编辑；保留ACK期间最新源文、未应用字段草稿，不返回旧捕获值 | H，通过 |
| 8 | auditAllTextEditing — CA091 code conversion to paragraph removes code-only attributes | U-R05恢复实际能力入口＋唯一条查询迁移；仍检查code／language移除，未删字段保护 | D，通过 |
| 9 | 同文件 — CA091 code conversion to 2 removes code-only attributes | 同上，转换标题2而非只改显示标签 | D，通过 |
| 10 | 同文件 — CA360 applying an existing link at its caret only changes the mark | 快捷链接未展开／捕获原链接范围；共用openLink修复，保留原文字不变及标记断言 | D，通过 |
| 11 | 同文件 — CA096 edits the original formula after text is inserted before its dialog target | 等价公式入口迁移；旧查询失败后的角色诊断触发jsdom样式异常，不是靠全局mock解决；仍验证公式身份和前文插入后的映射 | D，通过 |
| 12 | 同文件 — CA267 Slash menu Escape restores the original paragraph focus and selection | 夹具先进入Flow输入再按/；纯选择态不承担文字键入。原菜单、Escape焦点、同一选区断言保留 | D，通过 |
| 13 | 同文件 — CA014 changing LaTeX preserves the current 40px red style and link in data and view | 等价公式入口迁移；原数据、40px／红色实际DOM及链接保留；未mock样式或清除正确断言 | D，通过 |
| 14 | 同文件 — CA347 table cell defaults appear pressed and the first toolbar click sets bold false | 已批准Flow输入前置／条名称迁移；保留默认有效粗体、首次切false与准确cell slot | D，通过 |
| 15 | g20M21DocumentObjectClick — keeps a rendered image field owner on its click and lets ordinary text reclaim the same PM caret | 明确处于Flow输入阶段再测caret；仍不抢内部图片field owner、同一state、无内容写入 | D，通过 |
| 16 | 同文件 — publishes the current same caret on native click without a document or selection transaction | 输入阶段夹具前置；仍仅发布同一caret一次，不新增事务／内容修改 | D，通过 |
| 17 | 同文件 — refreshes the existing editor read-only state without replacing its document, selection or retained draft | 输入前置后测readOnly往返，原PM host、选区、保留草稿及提交次数不变 | D，通过 |
| 18 | slideContentFirst20261022 — cancels queued object preview on pointer cancel and context change without a late commit | mock缺`nativeText.resolveSelection`；核全部生产hook消费者及唯一返回后只补夹具，返回null；保留取消／上下文变化无晚提交 | S，通过；文件其余14条仍失败 |
| 19 | 同文件 — updates the hidden-object count from live instance visibility even when project identity stays the same | 同一缺端口遮蔽；只补mock，保留同工程对象身份下实时隐藏计数 | S，通过；未称全文件绿 |
| 20 | 同文件 — uses the final pan delta after a frame and discards a cancelled pan before further move events | 同一缺端口遮蔽；保留最终pan量、取消后不继续移动／提交 | S，通过；未改生产兜底 |
| 21 | g20EditPreviewProjection — paints a flow-block widget, preserves the live editor/caret, guards overlapping input and copies presented text | U-R03稳定文档／源码入口恢复后原测试直接通过；本文件未改断言 | D，通过 |
| 22 | 同文件 — paints a flow-range widget, preserves the live editor/caret, guards overlapping input and copies presented text | 同上；预览只读、复制呈现、正式内容与撤销取消保护保留 | D，通过 |
| 23 | auditAllExportsDevCompute — CA246: the actual Vite module Worker runs local Python through the backend dev request policy | 候选聚焦实际Chromium module Worker／Python42及策略1/1通过；根目录起点、终点各两次均60s超时，起点retry129另有fork终止超时。阶段探针及仅关闭watcher的单次对照均卡在Vite页面脚本加载、尚未启动Worker／Python，不支持据watcher假设修夹具；不能称无法复现或归因选中UX | W聚焦通过；根目录稳定失败与Vite根因未决保留；未改正式产品／测试／配置或timeout |
| 24 | contextualDocumentEditor — manual formatting is one owner history step and survives save and reopen | U-R02／06普通文档选区格式真实入口恢复；保留原“当前选区斜体”查询及一次History、Undo／Redo、保存重开 | D，通过 |
| 25 | documentSectionPresentation — opens a collapsed playback chapter in the real author NodeView and retains editable title/body without an author write | 明确进入已批准Flow输入；保留作者章节展开、标题／正文可编辑、零写入 | D，通过 |
| 26 | f0DocumentDraftAck — identifies new and split paragraphs before composition view consumers and waits for its end ACK before undo | 输入前置及唯一条等价查询；原新段落身份、IME、终态ACK才Undo、stored marks和提交次数不变 | D，通过 |
| 27 | flowTextEditor — uses actual editor copy/cut/paste events for a partial range and inline atom with formal source context | 输入前置；保留真实剪贴板事件、局部范围、资源端口、inline atom、注释、跨段归属所有断言 | D，通过 |
| 28 | k0FlowProjectionMutation — keeps Flow hosts through projection paint while pending DOM input reaches formal ACK and undo | 输入前置；保留宿主稳定、真实DOM输入正式ACK／Undo、IME及零重挂载 | D，通过 |
| 29 | tableRichEditing — edits an ordinary plain cell with the real rich editor, promotes marks and saves actual rich DOCX content | U-R06恢复普通组件文档原“粗体”入口；测试文件未改，保留正式History、序列化重开与DOCX富文本 | D，通过 |
| 30 | timedR1ParagraphSelector — projects the actual heading caret into the paragraph selector, commits body once and restores the heading through formal undo | U-R05唯一条入口迁移，保留真实光标／标题级别、一次提交／History、Undo、邻段不变。fixture删临时目录ENOTEMPTY由清理前正式关闭DocumentHost解决，非延时重试 | D，通过；另补无选区文档动作／唯一格式条 |

文档附带的两个旧夹具问题另记，不冒充本批产品回退：CA232／CA281查找“插入段落”按钮，而`2376311b3`实际句柄已叫“段落操作”；另一AI卡提示断言在该旧版本已失配，产品AI能力／范围选项未改，只核现存控件并保留精准target断言。新增链接原范围、引用出处保护、图片面板和异步精确替换等用例用于保护本轮实际失败模式，没有删原fullName或把缺失／skip算通过。

## 3. 原5条未归因告警

历史比较只在当前仍失败且能改变结论时执行。当前与`2376311b3`的三个Shell相关完整文件均为5过／4失败，四条在同一点失败；不是凭缺失旧fullName猜测历史归因。

| # | 文件／原fullName | 实际失败点、分类与处理 | 最终证据／限制 |
|---:|---|---|---|
| 1 | g20DocumentJournal — G20 durable document journal reads legacy active journals and upgrades the next Session write without changing document content | 当前不能复现；完整文件检查旧active journal读取、下次Session写升级及内容不变，未修改 | J，18/18通过 |
| 2 | LessonWorkspaceShell — 2.0 workspace shell shows an unavailable unified assistant without a CLI fallback and still creates a real untitled document | 两版都在旧“Markdown 文档名”查询失败，尚未到新建文档／菜单断言；既有夹具问题，本轮不为它新增UI | 当前／历史同点失败；后续按当前正式入口迁移夹具，保留数据／能力断言 |
| 3 | LessonWorkspaceShell — 2.0 workspace shell blocks close on a disk conflict and preserves the canonical draft and mounted editor without saving over the file | 两版都找不到“此处保留当前稿”，未执行close／preserve／不覆盖磁盘断言；既有失败，不能据此前置判数据丢失，也不能宣称保稿已验证 | 当前／历史同点失败；保留原断言，后续核实际冲突恢复路径 |
| 4 | g20M21TabMenu — M21 gives each file tab one right-click menu whose unavailable items say why | 两版在前置旧“Markdown 文档名”查询失败，尚未到右键菜单断言；既有失败，不改产品路径洗绿 | 当前／历史同点失败；后续沿正式创建入口继续原菜单检查 |
| 5 | g20M21PptxEntries — imports PPT through the empty content import menu, preserving actual parsing and the existing course callback | 两版回调均已收到正确{name,bytes}，因已有AbortSignal／foreground参数而精确参数断言失败；既有签名夹具失配，未证明解析丢失 | 当前／历史同点失败；后续补正确生命周期参数语义并继续原解析断言 |

原始证据：[当前Shell](../../../output/test-runs/regression-boundary-repair/shell-current.json)、[历史2376311b3](../../../output/test-runs/regression-boundary-repair/shell-historical-2376311b3.json)、[详细剩余结果](REMAINING_RESULT.md)。隔离工作树的共享node_modules Junction曾使Vite拒绝pdf worker；仅ignored临时配置允许其真实依赖路径后取得上述可比结果，未修改正式权限／配置或断言。

## 4. 实际GUI、输入和保存证据

证据代号：**F**=[FLOW_RESULT.md](FLOW_RESULT.md)，**I**=[IMAGE_GUI_RESULT.md](IMAGE_GUI_RESULT.md)，**E**=[ENGINE_RESULT.md](ENGINE_RESULT.md)。以下分开说明真实浏览器、正式模型和未覆盖属性，不能由代表性样本推及所有载体。

| 场景 | 实际执行与结果 | 可回查证据／边界 |
|---|---|---|
| Slide原生图片 | Chromium149实际Main／Bridge／Store／Runtime／Slide装配；身体双击无选图／无History，旋转一次History／Undo／Redo，水平翻转、cover、亮度125、不同尺寸图片替换保frame／flowLayout／fit等；完成与Esc保选，完成后身体拖动真实改frame | I；[功能报告](../../../output/test-runs/image-panel-browser/vitest-review.json)、[事实](../../../output/test-runs/image-panel-browser/facts.json)。OS选图以固定文件fixture替代，替换仍走正式资源路径；pageerror为空 |
| 图片面板位置 | agent-browser实际查看与截图；展开后使用右侧空位，与图片raster rect交叠面积0，未改已通过功能链断言 | [布局事实](../../../output/test-runs/image-panel-browser/layout-facts.json)、[截图](../../../output/test-runs/image-panel-browser/agent-browser-adjustments-fixed.png)。仅1280×900 CSS viewport |
| Slide图片保存／冷开 | 正式GLX保存后由全新DocumentHostService冷开，图片data／frame及新素材长度保留，dirty=false | I；实际到新Host模型冷开，没有声称另一浏览器页重渲染冷开结果 |
| Spatial裁剪 | 150% camera下实际身体双击→面板→原ImageCropOverlay；320×200→280×200，translation保持，crop.right=.125；一次History、Undo整实例恢复并保选 | [Spatial事实](../../../output/test-runs/image-panel-browser/spatial-crop/facts.json)、[报告](../../../output/test-runs/image-panel-browser/spatial-crop/vitest.json)、[裁后截图](../../../output/test-runs/image-panel-browser/spatial-crop/spatial-cropped.png)；非零旋转沿原禁用理由，不扩成矩阵全覆盖 |
| Flow业务／教师／定位 | 同一真实Flow壳层修前失败、候选通过；编辑／运行往返、恰一次业务、默认教师按钮、拖动revision／Undo、定位与更多实际截图 | F；[事实](../../../output/test-runs/flow-floating-boundary-20261024/facts.json)、[最终浏览器报告](../../../output/test-runs/flow-floating-boundary-20261024/final-browser-report.json)、[截图](../../../output/test-runs/flow-floating-boundary-20261024/flow-locator-and-more.png)。针对宿主DOM，未称所有iframe原先失效 |
| Flow正文图／浮层裁剪 | 正文图真实双击面板、0条重复快捷条、Esc仍选中picture；段落锚定浮层图面板→原FlowMediaCropEditor，crop.left=.2，一次History，frame／anchor不变，Undo；再裁剪立即Esc零写入并保选 | F；[增量crop事实](../../../output/test-runs/flow-floating-boundary-20261024-crop/facts.json)、[报告](../../../output/test-runs/flow-floating-boundary-20261024-crop/test-report.json)。全局图同回调接线为静态核对，未另称全局GUI裁剪 |
| HTML图片字段 | 替换／已有尺寸属性，面板保持至完成／Esc，原图保选；选图等待期间捕获原精确handle，不因后来选择另一图而改错目标 | H的9/9含新增两例；HTML／Source只显示真实字段写入支持子集，不冒称有原生全部图像参数 |
| HTML输入／IME | 实际CanvasPlainTextEditor Chromium装配：blur后0次，compositionend与再次blur仅最终中文1次；IME移至格式控件0次完成；CDP逐键输入`actual typing`后外部完成仅一次同文提交 | [IME时序](../../../output/test-runs/html-ime-boundary/composition-case.json)、[格式焦点](../../../output/test-runs/html-ime-boundary/toolbar-case.json)、[逐键输入](../../../output/test-runs/html-ime-boundary/ordinary-typing.json)。composition由脚本派发，不是物理中文IME／整Electron全路径 |
| 文档／表格 | mounted实际普通MD选区格式→一条History→Undo／Redo→保存／重开；正式Session表格富文本→序列化重开→实际DOCX XML；Flow新身份、IME、ACK、投影和剪贴板保护 | D；这些是模型／mounted证据，不假称已跑所有原生文件对话框、Office GUI或所有格式 |

Program图片入口属于静态接线核对；没有把Slide、Flow和Spatial代表性证据扩写成Program全GUI验收。图片具体参数代表性检查与unit22例不等于所有格式、旋转／嵌套、物理触屏或全出口矩阵。

起点全部复跑结束后，Root集成了审查通过的38个产品／测试文件，并在根目录实际执行新增的两个完整浏览器文件，**4/4通过**（33.91s），覆盖Slide图片编辑／替换／保存新Host冷开、Spatial裁剪、Flow业务／教师／定位及Flow浮层裁剪／Undo／立即Esc；见[Root集成报告](../../../output/test-runs/boundary-root-browser.json)。没有用跨工作树的候选通过替代这次已知环境差异下的集成观察。

## 5. R0 / R4 / 类型检查及独审

R0已把两份geometry和image derivative测试输出从已跟踪历史目录改到ignored `output/test-runs/`，不再按“每次跑后git checkout覆盖证据”执行。历史证据不删除。轻量脚本仍直接采用原`test:product`两个exclude，默认3 workers，失败文件一次独立进程复跑；不接入build／CI，不自动批准基线。文件加载错误、被遮蔽／缺失／skip用例、重复名称、未完成报告均保留未决；首过复跑失败也不丢掉，原偶发变稳定算新增稳定。脚本源码语义已由集中独审核对；实际运行统计见第7节。

R4的非owner提示修复保留原归属／只读权限与调用顺序。有效证据为Engine原有57例和服务发现6例通过，新增OAuth例最终1例通过，ni02完整7例通过。首轮组合71例69过：新增OAuth夹具误把provider call id当宿主facts call id已只修该新增断言；ni02材料背景例观察一次约5秒失败、单worker完整文件通过。后者只记偶发，不把并发／超时推测写成已修根因；未延长timeout、skip或删保存／冷开断言。报告均在[E详细结果](ENGINE_RESULT.md)链接，不能把过滤后未运行的57例再计通过。

主执行者在裁剪增量完成后已通过原三段TypeScript检查（main／electron／e2e），exit0，见[最终类型检查日志](../../../output/test-runs/boundary-typecheck-final.log)；未因文档收口重跑。必要浏览器产物按实际准备，生成源码因Junction带入绝对依赖路径的17文件噪音已在确认启动清白、无本轮runtime变更后恢复，未作为产品修改交付。

Root完成集成和浏览器路径检查后，三段类型检查同样exit0，见[Root类型检查日志](../../../output/test-runs/boundary-root-typecheck.log)。两处记录不加总成额外能力覆盖。

[REVIEW.md](REVIEW.md)已完成集中及必要增量独审。终点发现普通文档恢复误及画布专业输入后，仅按既有`!documentScope && toolbarHost`恢复专业共用控件；普通文件及无外置host的属性单元格保原控件，未靠更改正确的“高亮／加粗”断言掩盖回退。增量3个完整文件24例23过，唯一失败为起点同点稳定的stale-paste诊断断言；Flow11/11有效证据复用。该补正后三段类型检查exit0，见[补正类型日志](../../../output/test-runs/boundary-supplement-typecheck.log)。Root在终点305份raw落盘后同步同份已审源码，未因复制、文档或审查者变化重跑有效检查。审查不替Owner批准新产品取舍，也不把全量未决变成通过。

## 6. 保留失败、未决和后续只读发现

- Slide完整文件仍14条失败；原3条端口遮蔽告警已恢复，不将14条统称本轮新增或本轮修复。四条Shell／菜单／PPT历史同点失败见第3节，它们后续被夹具挡住的行为尚未验证。
- 终点初轮的8个unhandled中，4个仍关联起点已见文件，另4个在补齐`resolveSelection`后的Slide旧失败中展开：3次jsdom缺`adoptedStyleSheets`，1次旧fixture拒绝整工程capture；分别落在精确字段菜单、晚到pointer与contextmenu／doubleclick路径。它们属于此前端口失败后未到达的观察，不因旧文件已红而自动豁免，也不凭此断定4个新产品回退；原日志及未决保留，未修改这14条行为或给全局样式mock洗绿。
- Worker／Python的候选聚焦通过与根目录起点稳定超时分开记录，见第2节第23条；原始60s用例没有阶段快照，不能凭外层timeout断定停在Python或归因并发，也没有延长timeout取得通过。
- 额外`g20HtmlEditingUsability`当前3/5通过：两条为旧按钮文本报告及缺`edit-targets`自动扫描报告，起点与终点均两次失败，保留既有稳定观察；未通过改扫描行为或改断言洗绿。HTML完整文件曾出现一次初始ACK未就绪观察，后续9/9；IME直接消费者6/6。中途文档fixture清理和新增aria-disabled断言失配已分项记录，最终按实际文件有效证据取值，不把中途报告伪称全绿。
- [只读owner调查](OWNERSHIP_INVESTIGATION.md)确认：已有`formula.style`遮蔽Gateway默认appearance修改；已有文字inline同字段格式也会遮蔽Gateway整对象appearance，而GUI会改实际有效字段。真实planner／operation／renderer纯内存演算可复核，但未证明由本批首次引入，也没有实施迁移。建议后续先明确外观意图并统一专业外观owner，保留范围外样式／链接／身份；`text.format`、`text.replace`、`object.layout`未发现足以启动迁移的同意图结果差异，不据相似代码继续重构。
- 未做物理中文输入法、所有图片／视口矩阵、完整Electron／OS文件对话框／Office GUI或全部导出验收。没有本轮Owner视觉签收声明。

## 7. 全量比较、样本后补正与交付边界

**本轮产品修复与诊断已交付；全量测试及比较没有闭合为通过。** 起点与冻结终点均完成约定的全范围初轮、每个失败文件各一次独立进程复跑。最后7个产品／测试补正在终点全部结束后才集成；下表保留补正前的真实观察，后续定点证据另列，没有改写JSON或重开全仓record。

| 属性 | 起点 | 冻结终点样本 |
|---|---:|---:|
| 发现／执行文件数 | 1495 | 1497（新增2个浏览器文件） |
| 初轮具体用例 | 8430：7849过／571失败／10skip | 8439：7879过／550失败／10skip |
| 初轮失败文件，各一次独立进程复跑 | 308 | 304 |
| 全部观察后的具体用例分类 | 7843过／561稳定失败／16偶发／10skip | 7874过／541稳定失败／14偶发／10skip |
| 文件级稳定错误（不混作case） | 7 | 7 |
| 完整性与退出 | `reportComplete=false` | `reportComplete=false`，exit2 |
| 本地时间（Asia/Shanghai） | 10月24日23:57:58—25日01:08:28 | 10月25日01:20:02—02:44:37 |

两份HEAD均为`e77963756840adfe84b156b9f38f8bfaab14fda5`，Node24.14.0／Vitest4.1.10，直接采用原`test:product`两个exclude，workers3。起点含已声明R0输出／脚本／文档dirty，产品源码保持原HEAD；终点在已审主要修复集成后冻结源码及测试直至全部复跑结束。相关dirty及每次运行耗时在各自metadata中，不冒称干净HEAD样本。

原始入口：[起点JSON](../../../output/test-baseline/start-e77963756.json)、[同次终点及比较](../test-baseline/known-failures.json)、[基线README及前20文件](../test-baseline/README.md)。raw目录分别为`output/test-baseline/2026-10-24T15-57-58-625Z/`（309份）与`output/test-baseline/2026-10-24T17-20-02-350Z/`（305份）。两轮没有实际pending或JSON生成时仍在运行的警告，明细数与报告计数一致；这不消除下列真实限制。

- 起点initial及retry-69／75／162／226有运行器／全局错误。初轮4个unhandled关联g20SkillTools、g20S07ToolIncrementDelivery、glxContainerEditing和componentPlatformW0SpatialPointer，不能在终点自动豁免。
- 终点initial及retry-70／77／164／221／268有运行器／全局错误。初轮8个unhandled中，4个关联原4类，另4个在补齐端口后的Slide旧失败路径展开，见第6节；不能把8个都称起点同样错误。
- 比较输出：新增稳定14、旧稳定本次明确通过34、转偶发0、被遮蔽展开0；同名对应未决36条比较记录，实际18个唯一键、6组重名，不能说36个不同用例。34是诊断中的`fixed`标签，不单凭统计将每条都归因本轮代码。起点自身证据不完整，比较不能签“无新增”。

### 7.1 新增14条稳定观察的逐项处理

完整fullName、两次状态及失败摘要保留在上述JSON。这里按唯一对应条目列处理，不从已知失败中删除原观察。

| # | 文件／对应条目 | 定性、处理与最终证据 |
|---:|---|---|
| 1 | executionRepair20261012 — repair18 automatic首模式选择 | **保留未决**。起点passed/passed，终点两次同点answer拒绝。存在测试先等executing、后于此才注册question的真实窗口；同参数族stepwise在起点曾同点偶发，但不能抵消automatic本次新增稳定。无本次时序trace，不判唯一原因，也未证明实际GUI问题已展示后无法回答。详见[E只读归因](ENGINE_RESULT.md)。未改模式、answer边界、timeout或测试 |
| 2 | g20M23HtmlLightEdit — no-src placeholder／unbound动态文字 | D01已确认按钮名称的等价locator：选择图片→替换图片。原Source AI card、target及禁用断言保留；目标过，完整文件17/18，另一旧ACK夹具仍失败；[报告](../../../output/test-runs/html-lightedit-direct-verified.json) |
| 3 | imagePanelBrowser — 原生图片编辑、替换、保存冷开 | 本轮新增fixture固定另存名重复，被正式保存保护正确拒绝。仅为文件名加UUID，不删旧GLX、不改保存保护；原数据／frame／History／新Host冷开保留，目标1/1过，Spatial未重跑；[报告](../../../output/test-runs/image-panel-browser/vitest-unique-save.json)、[本次独立保存事实](../../../output/test-runs/image-panel-browser/unique-save/facts.json) |
| 4 | htmlAuthoringRecords — 实际pointer stream／一次History | U-R01名称等价查询：进入创作→编辑。全部矩阵、数据及History断言不动；完整文件10/10，与下列HTML文件同次[17/17报告](../../../output/test-runs/html-direct-consumers-verified.json) |
| 5 | offscreenSandbox — activity snapshots／uncooperative timers | **保留未决**。起点failed/passed，终点failed/failed；250行作者40ms回调保存的`paused.late`为undefined，前一行当前活动快照及只读断言已通过。宿主固定等待70ms，现有证据不能区分回调未执行或在activity到达前读取。直接runtime owner链未命中本轮UI修改，未找到直接因果证据，但不以旧偶发抵消新增稳定。未改调度、等待或断言；详见[只读归因](REMAINING_RESULT.md) |
| 6 | sharedDocumentEditor — inline range／caret／Flow工具 | **真实产品回退修正**。普通文档恢复误及外置专业字段，仅按既有documentScope+toolbarHost载体区分，恢复原共用控件；原“加粗”及准确范围／stored marks断言不改，目标过 |
| 7 | 同文件 — full font catalog／mixed／owner Undo | 明确这是普通完整文件target=file，按U-R06恢复粗体查询；原字体目录、mixed、输入样式及owner Undo全部保留，目标过 |
| 8 | 同文件 — clicked DOM caret／stored marks | 同上；原DOM光标同步、后续marks、范围外内容保护保留，目标过 |
| 9 | unifiedSelectionFlow — 单击选择／双击输入／Esc同段 | 按U-R03／04区分稳定文档操作与唯一目标格式条；不将所有toolbar数量直接改为2。明确稳定区无格式按钮、全DOM只有一个加粗、格式条无源码；原手势与零写入断言保留，目标过 |
| 10 | 同文件 — 不进入输入即格式化所选块全文 | 同一唯一格式条保护及正式写入范围保留；完整文件11/11，[报告](../../../output/test-runs/document-boundary-flow-remaining.json) |
| 11 | unifiedSelectionHtml — select／explicit edit／Esc目标 | U-R01名称等价查询，其余输入／目标／frame断言保留，目标过 |
| 12 | 同文件 — body pointer phases／最终坐标提交一次 | 同上，保留准确geometry及一次正式提交，目标过 |
| 13 | 同文件 — changed text target／不搬邻居 | 同上，保留原目标保选与不搬他人；完整文件7/7，与第4条同次17/17报告 |
| 14 | unifiedSelectionToolbarPopover — portaled PM palette／准确range | 与第6条同一真实产品修正，未把正确“高亮”断言改成旧名称。实际颜色仅改Alpha、同一条高亮打开／Esc、无commit均过；完整Popover2/2 |

第6—8与14条同次3个完整文件报告为[24例23过1失败](../../../output/test-runs/document-boundary-external-field.json)：sharedDocumentEditor20/21、Popover2/2、普通tableRichEditing1/1。保留的stale-paste true在起点已两次同点失败：准确discard后给出“粘贴目标已改变”诊断，而旧断言要求零diagnostic；本轮不改其逻辑或断言。普通cell继续保护原“粗体”入口、一次History及真实DOCX。各报告有交叠，不累加成一个虚构通过总数。

### 7.2 最终工作区与接续

上述12条已审补正在冻结终点全部结束后，以1个产品文件、6个测试文件同步根目录；补正后三段类型exit0及直接消费者证据见第5节和表中链接。它们是原始全量样本之后的补充证据，**不是另一份全量结果**；`known-failures.json`保留原比较，只供开发诊断，不作为当前全部修复已过的准入／已批准失败清单。没有在CI/build中增加门，也没有新建平台、放大exclude／skip或修改全仓timeout。

本轮已更新README／CURRENT_STATUS、旧统一选中RESULT的纠正说明及架构方案当前入口。根目录原提示词保留原件和调查用途；因Worker、两条新增观察及全量证据仍有未决，未将原提示词归档或宣布其旧任务全部完成。各叶子报告是证据细节，本文件为唯一综合结果入口。

仅移除本任务协调卡并按当前卡重新生成任务板；其他创作／queued任务不清理、不接管。两处本轮隔离工作树保留，没有调用会生成Git快照的归档。用户作品、恢复稿、原未提交成果及历史证据保全；本轮没有commit、push、打Portable、发布或部署，也没有Owner整体接受声明。

诊断早期另有一次仅JSON reporter的不完整初跑，因无法发现unhandled而停止，日志保留于`output/test-baseline/2026-10-24T15-32-31-602Z/`；未作为有效起点或比较，也没有用后一次record替换本次终点。
