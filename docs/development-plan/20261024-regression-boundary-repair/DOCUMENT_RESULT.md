# R2-B / R3 文档修复结果

2026-10-25，候选工作树 `C:\Users\74755\.codex\worktrees\regression-boundary-repair\果铃工作台`。未提交、推送或发布；本文仅记录本叶子，组合 typecheck、浏览器验收、终点基线及独审由主执行者汇总。

## 产品结果与授权边界

- 按 U-R02 / U-R06 恢复普通文档原呈现：固定栏保留原粗体、斜体、下划线、字号、字体、颜色、高亮、链接、公式及更多；选区条恢复原“当前选区”五项，并保留原链接、公式、段落及更多入口，选区字号／字体仍在更多内。没有给普通文档套入组件条新增的步进按钮或范围标签。组件内文档／表格复用相同内容命令，普通文件保留正常光标输入。
- 按 U-R03 / U-R04，Flow 固定文档区域显示正文／源码、既有插入表格、宿主正文互动及需要时的草稿操作；无选区也可达。当前目标格式仍仅在一个选区条内，不重新建立固定目标格式栏。
- 按 U-R05，Flow 段落类型按 PM 正式块身份及父 schema 的替换能力判断，不按“输入位置”等标签判断，光标／代码块可转换，并显示当前正文或标题级别。引用等 compound 的受保护转换继续使用既有段落操作菜单，不增加原不支持的 slot 直接转换；带出处引用的“不能直接转换”保护保留。
- 快捷条链接现在复用旧固定栏的 `openLink`：展开光标所在链接的原范围，并用现有 `trackSelection` 随周边编辑映射。避免把链接地址插入光标处、或弹层打开后误改后来选中的文字。未增加第二 writer、History 或选择 store。

## 原告警逐项定性（本包 19 条）

“夹具迁移”仅指已批准的 Flow 进入输入后再进行输入／剪贴板／IME，或唯一格式条中的等价动作。原数据、范围、正式 ACK、Undo、保存及导出断言保留；原 fullName 均未改名。

| 文件与原用例 | 定性与处理 | 结果 |
|---|---|---|
| auditAllTextEditing — CA091 code conversion to paragraph removes code-only attributes | 原唯一条入口恢复 + 夹具点击当前段落菜单；仍检查 code / language 被正确移除 | 通过 |
| auditAllTextEditing — CA091 code conversion to 2 removes code-only attributes | 同上，转换标题 2；未删除字段保护 | 通过 |
| auditAllTextEditing — CA360 applying an existing link at its caret only changes the mark | 链接真实 owner 问题：快捷条未展开／捕获既有链接范围；共用 openLink 修复，保留原文字不变断言 | 通过 |
| auditAllTextEditing — CA096 edits the original formula after text is inserted before its dialog target | 已批准 Flow 入口迁移至当前选区公式；实际原公式身份和前置插入映射保留。jsdom 异常是旧查询失败后角色诊断触发；没有全局 mock 样式 | 通过 |
| auditAllTextEditing — CA267 Slash menu Escape restores the original paragraph focus and selection | 夹具先进入 Flow 正文输入，再按 /；仍断言菜单、Escape 后原焦点与完全相同选区 | 通过 |
| auditAllTextEditing — CA014 changing LaTeX preserves the current 40px red style and link in data and view | 迁移等价公式入口；数据和实际 DOM 样式／链接断言全部保留；无样式 mock | 通过 |
| auditAllTextEditing — CA347 table cell defaults appear pressed and the first toolbar click sets bold false | 已批准 Flow 条查询名称／输入前置；仍检查有效默认粗体、首次切换 false 与准确 cell slot | 通过 |
| g20M21DocumentObjectClick — keeps a rendered image field owner on its click and lets ordinary text reclaim the same PM caret | 在已进入输入阶段检查原不抢图字段 owner 的 click；保持 state 同一对象、无内容写入 | 通过 |
| g20M21DocumentObjectClick — publishes the current same caret on native click without a document or selection transaction | 显式进入 Flow 输入，仍检查原 caret 恰好发布一次、无事务与内容写入 | 通过 |
| g20M21DocumentObjectClick — refreshes the existing editor read-only state without replacing its document, selection or retained draft | 先明确进入输入再检查 readOnly 往返，保留草稿、PM host、选区与无额外提交断言 | 通过 |
| g20EditPreviewProjection — paints a flow-block widget, preserves the live editor/caret, guards overlapping input and copies presented text | 文档级正文／源码入口恢复后原用例直接通过；未改本文件断言 | 通过 |
| g20EditPreviewProjection — paints a flow-range widget, preserves the live editor/caret, guards overlapping input and copies presented text | 同上，仍保护预览只读、复制呈现、正式内容及撤销取消边界 | 通过 |
| contextualDocumentEditor — manual formatting is one owner history step and survives save and reopen | 普通文档选区格式真实入口恢复，原“当前选区斜体”查询保留；History / Undo / Redo / 保存重开断言保留 | 通过 |
| documentSectionPresentation — opens a collapsed playback chapter in the real author NodeView and retains editable title/body without an author write | 夹具先明确进入 Flow 输入；保留作者章节展开、标题／正文可编辑及零写入断言 | 通过 |
| f0DocumentDraftAck — identifies new and split paragraphs before composition view consumers and waits for its end ACK before undo | Flow 明确进入输入后模拟 IME；唯一目标格式条查询迁移，保留新身份、IME、最终 ACK 才 Undo、存储 marks 与提交次数 | 通过 |
| flowTextEditor — uses actual editor copy/cut/paste events for a partial range and inline atom with formal source context | Flow 明确进入正文输入后进行真实剪贴板事件；原局部范围、资源端口、inline 原子、注释与跨段归属断言全部保留 | 通过 |
| k0FlowProjectionMutation — keeps Flow hosts through projection paint while pending DOM input reaches formal ACK and undo | 输入前置迁移；仍检查宿主保留、DOM 输入到正式 ACK、Undo、IME 及零重挂载 | 通过 |
| tableRichEditing — edits an ordinary plain cell with the real rich editor, promotes marks and saves actual rich DOCX content | 普通组件文档固定栏原“粗体”入口恢复；测试文件未改，仍验证正式一条 History、序列化重开与 DOCX 富文本 | 通过 |
| timedR1ParagraphSelector — projects the actual heading caret into the paragraph selector, commits body once and restores the heading through formal undo | 唯一目标条入口迁移，保留实际光标、标题级别、一次提交／History、Undo 与邻段不变；额外修 fixture 清理前正式关闭 DocumentHost，避免后台 journal 写入造成 ENOTEMPTY | 通过 |

## 额外发现与保护

- `auditAllTextEditing` 的 CA232 / CA281 旧夹具查询“插入段落”按钮；`2376311b3` 和当前真实句柄都叫“段落操作”。只修查询并明确进入输入，保留插入后立即输入和 section 正文断言。
- `contextualDocumentEditor` 另一条断言旧 AI 提示“这里的 AI 只改选中的文字”；`2376311b3` 已经是“仅修改此选区”可选范围能力。产品 AI 界面与权限未改；测试核现存范围控件，原精准 Markdown target、卡片关闭及来源变化断言保留，不能将其算作本轮产品回归修复。
- 新增两个聚焦保护：链接弹层打开后前文插入且当前选区改变，仍仅给原文字加链接；引用段落转换菜单继续可达且带出处时禁止转换，文字／出处和提交次数不变。
- 普通 Markdown 的 mounted 测试补核其直接可输入；正式标题用例补核 Flow 无选区文档动作、进入输入后格式按钮只有一个。

## 最小充分证据

10 个文件合计 88 个用例（原 86 + 上述 2 个保护），有效文件范围观察均通过；不是同一次全量结果，不代表全仓通过。

| 文件范围 | 数量 | 有效报告 |
|---|---:|---|
| auditAllTextEditing | 58 | [document-audit-final.json](../../../output/test-runs/document-audit-final.json) |
| contextualDocumentEditor / tableRichEditing | 4 | [document-original-ui-final.json](../../../output/test-runs/document-original-ui-final.json) |
| timedR1ParagraphSelector | 1 | [document-final3.json](../../../output/test-runs/document-final3.json) 中该文件通过 |
| g20M21DocumentObjectClick / g20EditPreviewProjection / documentSectionPresentation / f0DocumentDraftAck / flowTextEditor / k0FlowProjectionMutation | 25 | [document-pass2.json](../../../output/test-runs/document-pass2.json) 中这些文件全部通过 |

`document-pass2` 唯一未通过项是 timed fixture 清理 ENOTEMPTY，后续正式关闭 host 后该完整文件通过。`document-final3` 唯一未通过项是新增引用保护断言使用了 native disabled 查询，而现存 CommandMenu 使用 `aria-disabled`；按实际控件语义核对后，最终 audit 完整 58 条通过。日志内 jsdom `scrollBy` 未实现提示未改变断言结果。

本叶子未执行整仓 typecheck、构建或浏览器；组合候选由主执行者统一完成，避免重复测试。

## 终点额外告警：专业外置字段工具条边界增量

Root同次终点首轮后在候选单独核对，未修改冻结中的Root。经producer核查、Root许可和独审边界确认，修正本轮恢复范围过宽的一处真实产品回退：`ProfessionalContentEditor(floatingToolbar) → TextComponentEditor → SharedDocumentEditor(contentScope="inline-text", toolbarHost)` 是作品内专业字段，不是普通文档。此前用`!flowObjectSelection`统一套旧格式呈现，误使该外置工具条的“高亮”及统一控件丢失。

增量仅在 **`!documentScope && Boolean(props.toolbarHost)`** 恢复原`TextFormatControls`的scope、step、颜色／高亮；链接、公式、清除格式继续原命令，不新增props、mode、store或History。普通完整文档即使有host仍保原呈现；`TableComponentEditor`／属性面板普通cell没有host，保留原“粗体”，没有把tableRichEditing迁成“加粗”。`useSlideNativeTextEditor`的外置cell专业编辑已有host＋scope，使用统一控件。Flow全文不命中此增量。

等价测试迁移：两个完整普通文档用例明确`target="file"`，恢复“粗体”查询，原mixed marks、字体目录、点击光标、输入marks、owner Undo断言保留；inline-text外置工具条的“加粗”断言未改。Flow原“所有toolbar只能1个”改为实际能力断言：稳定正文／源码／插入区不带加粗，唯一选区格式条且整个DOM仅一个加粗，格式条不带源码；不机械把数量改成2，原手势、范围、写入和连续输入断言不变。

只用ignored配置精确include、`globalSetup: []`，各相关完整文件一次：

| 报告 | 实际文件／case统计 | 结论 |
|---|---|---|
| [document-boundary-external-field.json](../../../output/test-runs/document-boundary-external-field.json) | 3文件、24例：23 passed、1 failed、0 pending；exit1。原JSON的`numTotalTestSuites=4 / passed=2 / failed=2`包含describe层，不能当4文件 | 两个UI边界与普通table保护已通过；整个组合未通过 |
| 同报告：sharedDocumentEditor | 21例：20 passed、1 failed | 原3个格式告警均过；额外stale paste断言失败，见下表 |
| 同报告：unifiedSelectionToolbarPopover20261024 | 2/2 | 真实专业外置PM工具条颜色／高亮与范围保护通过 |
| 同报告：tableRichEditing | 1/1 | 原粗体入口／正式History／序列化重开／DOCX断言全部保留并过 |
| [document-boundary-flow-remaining.json](../../../output/test-runs/document-boundary-flow-remaining.json) | Flow完整文件11/11 | U-R03／04等价能力断言通过；后续产品条件不命中Flow，复用该有效证据，不重跑 |

三文件24条逐条状态（原fullName未改）：

| 文件 | 可查fullName／条目 | 状态 |
|---|---|---|
| sharedDocumentEditor | discards only the local file draft while retaining original unsupported source verbatim | passed |
| 同文件 | uses one full toolbar for inline range and caret formatting while retaining Flow selection tools | passed；专业外置字段真实UI修复，未改加粗断言 |
| 同文件 | retains Flow presentation views through resource refresh without changing document content | passed |
| 同文件 | shows the full formal font catalog, mixed selection and stored input style, then refreshes after owner Undo | passed；明确普通完整文档，保留原marks／Undo |
| 同文件 | captures a clicked DOM caret before toolbar focus changes and preserves subsequent stored marks | passed；保留DOM光标同步、随后marks及范围外文字 |
| 同文件 | does not commit source merely because StrictMode remounts its view | passed |
| 同文件 | does not publish a queued composition after the owner unmounts | passed |
| 同文件 | prepares cross-owner resource paste and discards when editor changed: false | passed |
| 同文件 | prepares cross-owner resource paste and discards when editor changed: true | **failed**：末尾`diagnostic.not.toHaveBeenCalled`失败；实际收到“粘贴目标已改变，素材未应用；请在需要的位置重新粘贴。”，并非格式用例失败。未改paste／资源逻辑或该断言，交Root全量对比归因 |
| 同文件 | round trips mixed body slots and maps Unicode plus math atoms | passed |
| 同文件 | preserves DOM during composition and publishes one completed edit | passed |
| 同文件 | splits with a fresh right identity, joins, and delegates undo to the owner | passed |
| 同文件 | uses a shared input group until selection moves | passed |
| 同文件 | copies complete list/table/math identities and keeps source identities intact | passed |
| 同文件 | deletes a cross-paragraph range containing a math atom in one transaction | passed |
| 同文件 | retains the current field owner through a late revision and lets the same PM selection 2:2 reclaim ownership | passed |
| 同文件 | retains the current field owner through a late revision and lets the same PM selection 1:3 reclaim ownership | passed |
| 同文件 | keeps an external owner only for blurred DOM selection reconstruction: external | passed |
| 同文件 | keeps an external owner only for blurred DOM selection reconstruction: focused | passed |
| 同文件 | keeps an external owner only for blurred DOM selection reconstruction: content | passed |
| 同文件 | keeps an external owner only for blurred DOM selection reconstruction: explicit | passed |
| unifiedSelectionToolbarPopover20261024 | Escape on a whole formula applies through its owner and keeps its draft while the ACK is pending or rejected | passed |
| 同文件 | a PM toolbar portaled into the current quick bar opens its palette and formats only its real text range | passed；仅Alpha变红、palette关闭、同一条高亮打开／Esc关闭、无commit |
| tableRichEditing | edits an ordinary plain cell with the real rich editor, promotes marks and saves actual rich DOCX content | passed；测试未改 |

增量未处理paste／资源路径，也没有把该一次报告洗成24/24。此处是终点之外的候选专项，不覆盖Root冻结同次全量观察；整合与最终分类由Root按实际结果决定。原88例有效证据按未命中的实现继续复用，不把上表交叠文件重复累加成总通过数。


## Root整合记录（2026-10-25）

终点全量及304个失败文件复跑已全部结束，本文所述已审补正随后同步根目录。原冻结样本及其失败未改写；后续定点证据、未决和最终状态统一见[综合结果第7节](RESULT.md#7-全量比较样本后补正与交付边界)。图片唯一另存的本次facts在Root另存于`output/test-runs/image-panel-browser/unique-save/facts.json`，旧facts及GLX保留。
