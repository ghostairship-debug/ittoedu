# HTML与共用编辑快捷键修复（2026-10-25）

当前已证实并修复的断口是：HTML单击选中后没有键盘／剪贴板owner；共用原位纯文本输入的手工Range粘贴、换行绕过浏览器Undo；图片/PDF与源码编辑的Redo别名各自漏接；已有格式控件的Native与正文输入没有对应BIU正式动作。它们不是同一个拦截器故障。真实Chromium中，原位输入原有Ctrl+A/C/X/V本来可用，不能把用户选中态失效归为输入态剪贴板权限问题。

本包沿现有owner完成修改：HTML选择焦点由Pane承接，标准copy/cut/paste事件只处理当前选中的文字字段，输入／属性／AI文本框仍拥有自己的键盘；正式值修改继续经HtmlPreviewController→HtmlSourceEditService→DocumentSession。没有新增全局HTML键盘监听、剪贴板存储、文档writer或History。新剪切先成功写ClipboardEvent数据再删除；紧随剪切、先于ACK的粘贴等待同一Controller刷新地址，再提交当前同handle的值。进入输入、重载、换lease或换目标后，旧待执行动作不写新owner，旧错误也不显示到新页。选中文字字段的Delete／Backspace复用同一个值清空动作，Esc清除选择并保留编辑模式；Esc清选自然使尚未执行的对象粘贴失效。

清空文字不能把可绑定源TextNode直接删掉：现复用已有author-record空值override及源element的软件anchor注册。普通重复A也能按精确source locator注册；同一父element的A／C文字叶复用一个parent anchor，以各自textIndex定位，不相互覆盖。正式Undo/Redo回放取当前revision的author records。根Agent“记录先到、receipt后到”时已投影为目标值却误报patch mismatch的问题，由Root在其Agent写锁中完成幂等确认，第三种真实不匹配值仍拒绝。

共用输入的粘贴与换行现使用浏览器原生编辑命令，只插入软件生成的span及完全转义的纯文字，最终仍读textContent；原文中的`<img>`等文字不会成为元素，LF、Undo/Redo和后续选择保留。HTML已有独立geometry格式控件的字段，还可从Ctrl+B/I/U委托同一HtmlSelectionToolbar→TextFormatActions toggle→原onStyle事务；普通纯值字段不冒充富文本输入。

## 有限快捷键／owner审计

下表按当前实际入口分工；“静态”不代签实际桌面键盘、物理IME或全产品矩阵。

| 当前上下文 | 剪切／复制／粘贴、全选 | Undo／Redo、保存 | B/I/U | Delete／Backspace、Enter／Esc | 证据与边界 |
|---|---|---|---|---|---|
| HTML单击选中的文字字段 | 由Pane上的标准ClipboardEvent走当前字段值；Ctrl+A进入该字段的共用原位输入并全选。根文档和可访问嵌套srcdoc共用父Pane | Pane选中态调既有onUndo/onRedo；预览iframe聚焦时仍由Main可信键盘桥转发正式历史。保存仍属Lesson文档owner | 有独立geometry、当前工具条确实提供格式动作时，委托同一工具条；无几何纯值不生成格式 | Delete／Backspace清空当前文字值；Esc清选保留编辑模式。不把字段删除解释为删除整个DOM element | 根重复A的真实键盘→Main→保存冷开；嵌套srcdoc的X/V、BIU、Delete／Backspace／Undo及Esc均通过。图片／任意DOM结构的跨剪贴板序列化未新增 |
| CanvasPlainTextEditor原位输入（HTML／组件／原生字段共用） | 浏览器拥有选区、C/X/A；软件纯文本粘贴经原生编辑命令入同一Undo链 | 浏览器拥有未完成输入的Undo/Redo；完成后由原正式事务入文档History。Ctrl+S交原保存flush，IME不抢输入 | 可选已有格式owner port；纯值caller仍禁止浏览器自行插富文本。Native格式字段由Root接既有NativeSelectionContext owner | 浏览器文字删除；普通Enter保留literal LF，Ctrl+Enter／Esc按现有完成合同，composition期间保留IME | 实际Chromium C/X/V/A、粘贴／LF Undo/Redo、多行literal markup不执行均通过；既有IME/blur直接检查保持 |
| HTML源码／TXT的PlainTextDocumentEditor | CodeMirror浏览器输入与选区owner；不转画布对象剪贴板 | CodeMirror的现有onUndo/onRedo；补齐Windows Ctrl+Shift+Z，与Ctrl+Y同路。保存经Lesson capture | 纯源码不启用字形格式 | CodeMirror原生文字删除／换行；没有对象删除路由 | 两种Redo alias穿实际CodeMirror键盘handler通过；其余分工静态核对 |
| Markdown／Flow的SharedDocumentEditor | ProseMirror→现有document clipboard及resource port；图片、正文对象仍走已有正式剪贴板语义 | PM显式Mod+Z／Shift+Z／Y；补齐其源码CodeMirror漏掉的Mod+Y，仍为同一navigateHistory。保存由上层owner | 实际PM默认Ctrl+B未生效且changes=0；现PM在确有输入所有权、非IME时将BIU交给shell原toggleStyle，与按钮同一正式动作 | 既有PM keymap、Flow delete和professional completion合同保留 | 真实SharedDocumentEditor／Chromium／Main／磁盘冷开1/1；BIU、按钮反向切换、两种源码Redo通过。不是全部Flow对象／nodeView矩阵 |
| 原生／组件选中态共用App路由 | 现有CourseCanvasPaste与正式对象剪贴板，输入事件仍由isEditorTextInputEvent避让 | 共用editorShortcut只归一化aliases／Alt／IME；动作仍属当前Surface命令 | Native原生文字与精确author field复用原格式owner；纯值字段不新增格式能力 | 现有delete disposition、nudge及Escape清选各归原owner | 既有键盘焦点、shadow输入和选择直接检查通过；Root Native3/3、既有默认提交7/7与保存冷开通过 |
| 图片／PDF轻编辑 | 不把文字／对象剪贴板交给媒体编辑；原输入控件拥有原生剪贴板 | 修正局部分叉：Ctrl+Y与Ctrl+Shift+Z同调现有draft.redo；Alt／IME／属性input不抢动作。保存仍为原save | 不增加文本格式功能 | 原媒体操作保留 | 已有旋转→Undo→Ctrl+Y Redo的真实组件handler直接验证；未声称新媒体能力 |

CanvasPlainTextEditor各实际caller已核：HtmlPreviewPane；ProfessionalContentEditor的plain authorSpot；useSlideNativeTextEditor的图表文字card；FlowDynamicAuthoringOverlay；SlideDynamicAuthoringOverlay的runtime／组件纯值；SpatialGlobalRuntimeAuthoring。前述Professional局部工具条只有纯文本／全选／完成，但NativeSelectionContext会对authorSpotFormatView可用的字段另提供正式格式动作，因此Root按实际可格式化owner接Native BIU，不能仅从局部工具条推断能力。有源范围草稿时先排空同一输入ACK与后续输入、关闭原输入，再用accepted spot提交格式；无record的源binding.baseline跟随已接受文字推进，有record仍服从正式binding。

## 当前证据

- [选择／格式与既有直接检查25/25](../../../output/html-shortcuts-20261025/selection-format-final.json)：真实Chromium键盘操作实际HtmlPreviewPane、当前Agent和Main服务；根重复A的C/X/V、Undo/Redo、Ctrl+A输入清空、保存／新Host冷开；嵌套srcdoc的X/V及selected B、inline I、U，实际computedStyle、邻居保持和无b/i/u污染。
- [原位纯文本浏览器3/3](../../../output/html-shortcuts-20261025/plain-browser-final.json)：原生C/X/V/A、粘贴与LF Undo/Redo、多行literal markup粘贴安全与Undo。未增加第二输入History。
- [ACK接续与源码Redo 2/2](../../../output/html-shortcuts-20261025/clipboard-source-final.json)：cut receipt仍挂起时粘贴不丢；系统剪贴板写数据失败不删除内容；实际CodeMirror两种Redo别名。快速接续修前明确失败为undoDepth=1而不是2，未提高断言超时。
- [选中态删除／Esc扩展3/3](../../../output/html-shortcuts-20261025/delete-escape-final.json)：真实嵌套HTML的Delete、Backspace及各自Undo；Esc清选保留编辑模式；cut ACK前已经排队的paste在Esc清选后不执行。[最终剪贴板owner 2/2](../../../output/html-shortcuts-20261025/clipboard-owner-final.json)另保留外部旧文字范围，确认它不截走当前HTML字段的C/X命令。
- [同父文字叶空值冷开1/1](../../../output/html-shortcuts-20261025/main-empty-cold.json)：A／C共享父anchor但textIndex独立，保存、新Host和正式consumer冷开后仅余B。
- [实际键盘事实](../../../output/html-shortcuts-20261025/html-selected-keys-facts.json)、[原位输入事实](../../../output/html-shortcuts-20261025/inline-native-facts.json)。coldUndoDepth=0是从已保存源文件新建Session后的历史深度，不能当作原编辑会话未产生历史；测试在保存前分别断言1／2／3条正式历史。

上述首包去除同条用例的扩展／复跑后，共32条不同直接检查，不将旧红报告或未运行用例计入通过。最终窄检查另补[正文／Markdown源码1/1](../../../output/html-shortcuts-20261025/shared-document-final.json)：先在原PM实际触发Ctrl+B得到changes=0，再补原格式port；B/I/U、按钮toggle、保存磁盘冷开后的全部inlines精确值与两种源码Redo通过，0pageerror，见[事实](../../../output/html-shortcuts-20261025/shared-document-keys-facts.json)。没有仅凭缺keymap就认定故障。

Root另完成[Native3/3](../../../output/html-shortcuts-20261025/native-format-final.json)与[既有输入默认提交7/7](../../../output/html-shortcuts-20261025/default-submit-final.json)，覆盖源字段ACK期间继续输入、正式保存／冷开、邻文B/C保留。完整Electron私有构建还通过实际文件树→可信鼠标选中嵌套文字→X/V／Z／ShiftZ／重新选中B／Ctrl+S，并在独立新profile与新Session冷开保持文字、700、邻文及dirty=false；原始`final-ipc-*.json`／截图和性能边界统一见[Root结果](../20261025-html-edit-repair/PERFORMANCE.md)。不把这些证据混算为首包32条。

最终Main、renderer／player／测试类型与私有player／compiled-player／renderer构建通过，构建只在`output/html-performance-20261025`；未写共享dist，未commit／push／发布，未改桌面英语素材原件或用户profile。

浏览器装配使用真实Main类与正式事务，经测试传输函数连接前端；上述完整Electron另补实际IPC证据，两者均不代替物理Windows键盘／IME。嵌套srcdoc已测；opaque Blob的剪贴板未另跑一条完整链，父Pane为同一owner的源码判断不代签该现场。普通Markdown正文BIU已测；全部Flow nodeView、跨平台Meta、长按重复键未在本包宣称全通。

过程中原位粘贴Undo、快速ACK和PM BIU反例均先失败再修；独立review还拦下重复文本／同父anchor和旧队列跨owner问题。测试装配先后出现beforeAll编译／启动超时、字符串replace的`$`替换污染、HTTP无UTF-8声明以及不真实的Shift键字段，均按实际producer修夹具，未删正确内容、Undo、冷开或遮挡断言，也未放宽运行超时来洗绿。最终Playwright参数的深类型只加测试传输unknown注解。静态评审由未参与实施的html_review完成，Root Agent／Native BIU及PM最后增量分别独审通过。
