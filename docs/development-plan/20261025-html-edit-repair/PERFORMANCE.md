# HTML预览、编辑切换性能接续（2026-10-25）

已修复编辑描框的重复样式读取、opaque提示自触发扫描和Main静置轮询反复解析；原件样本的进入／完成编辑明显缩短。大HTML首次打开仍慢，不能宣称全部卡顿已消除。Owner随后要求检查快捷键，已按当前输入／选中owner补齐HTML、共用原位输入和其他编辑入口的实际断口，详见[快捷键修复与有限审计](../20261025-html-shortcuts/RESULT.md)。Root负责paint/readscope与Native格式接续，`html_open_performance`负责Main分析，`shortcut_unification`负责快捷键，`html_review`独立核实际候选。

## 已修正的编辑热路径

- 上一轮加入真实paint判定后，绘框对每个文字采样点安装/恢复整域pointer-events样式、枚举inline样式，并重复读取相同遮挡物/祖先。当前在同一同步readscope复用安装与查询，缓存坐标无关paint事实；边框/文字范围依然逐坐标判定，部分露出文字、pointer-events:none装饰与透明段落caret能力保留。scope不跨异步或帧，inline important在每次hit后即恢复，最外层finally恢复软件样式。
- `nested.hit`的实际paint owner读取与本地hit共用同一同步scope，已知owner仅查自己的直接文字/图片，保持原shadow在light子节点之前的顺序，避免再全文枚举。
- opaque子页面的DOM adapter把软件提示的remove/append当作者变动，形成持续“绘框→扫描→绘框”；adapter与Agent共用作者变动判定，跨ShadowRoot排除提示。临时inline pointer-events改写后恢复的属性在同批MutationRecord中没有最终作者变化，按首oldValue与最终值过滤；真实文字、属性和混合childList变化仍触发扫描。嵌入factory与进程内consumer使用同一实现。

## 当前原始测量

原件：`C:\Users\74755\Desktop\英语素材\Unit1-You-and-Me.html`（75,351B）和`Unit 1 · YOU & ME — 互动改编版.html`（25,577,746B）。实际完整Electron、独立profile、真实文件树和工具条可信鼠标事件；原件只读。普通预览831×723 CSS px，编辑工具行出现后高度变化。编译/测试与动作计时错开。诊断wrapper仅在自有进程记录Main方法耗时，不修改共享dist。

| 属性 | 修前证据 | 修后证据 |
|---|---|---|
| 小文件一次51目标paint累计 | 597.7ms；首次进入绘框longtask596ms | 40.4ms，包含逐点实际遮挡判定；不是整次打开耗时 |
| 小文件进入命令→首21提示的rAF | 716.2ms | 首次295.6ms、计数轮182.9ms；按钮状态ACK本来就很快，不能以ACK冒充绘制完成 |
| 小文件可信“完成编辑”点击→false ACK | 1403.7ms，另一轮659.3ms | 已收到的完整一轮97.2ms；另一轮在立即关闭诊断进程前未采到ACK，不计通过时长 |
| 大文件编辑静置 | 每约1.1–1.4秒再报告同一scan的51目标，持续超过60秒 | 一次进入收到两批51目标后，约38秒内没有再次报告 |
| 大文件完成编辑 | 旧重复绘框持续占用子页面，不能用根ACK代表子页无长任务 | scope候选可信点击→根false ACK7.1ms；与静置无重复报告证据一起使用 |
| 初次打开 | 小文件约5.09秒，大文件约14.77秒，Main open约1.47／11.70秒 | Root paint修复后仍数秒；另一轮大文件20.89秒，其中Main open17.72秒、capture16.45秒，证明初开尚有独立瓶颈，不能宣称已流畅 |

数据不构成跨机器或所有HTML的性能保证。修前为本轮性能修改前的源码，包含上一轮遮挡正确性修复；没有把更早版本的数字混作相同条件对照。Root同步facts候选仍捕获到65–82ms绘制/悬停长任务，当前只声称显著减少，不宣称全程60fps。

原始记录位于[性能证据目录](../../../output/html-performance-20261025/)：`nested-counted-preview.json`、`nested-first-preview.json`、`nested-facts-counted-preview.json`、`nested-facts-enter-preview.json`、`nested-facts-finish-parent.json`、`large-loop-before-preview.json`、`large-scope-idle-parent.json`、`large-scope-finish-parent.json`及Main分段文件。可见诊断窗口出现额外人工输入的那轮`interfered-parent.json`不用于修后性能结论；其独立profile与恢复稿保留。

## Main初开与静置成本

独立真实DocumentHostService打开同一大原件约4.72秒，其中现有worker资源分析3.93秒、Session创建509ms、journal追加260ms。纯同算法CPU采样约7.52秒，热点为脚本闭包分析、AST遍历、parse5及分配/GC；这是算法采样，与全GUI时间分别记录。原始`main-open-stages.json`、`analysis-before-profile.cpuprofile`及`analysis-before-hotspots.json`保留。

小文件静置重复分析的原因已经修正：目录依赖过去只登记一个bool，使整个Session磁盘观察不能复用。现在同一观察记录保留捕获时的成员事实，稳定轮询复用；新增、改内容、重命名、删除及原缺失目录出现仍失效重读。相同原件open＋三次观察的capture次数4→1，三次observe由770／688／657ms变为461／25／19ms；首轮461ms包含建立strong基线。没有第二缓存owner或跳过依赖解析。直接6/6覆盖实际knownVersion弱轮询及capture到首strong之间的新成员窗口，Root在撤回AST实验后再次6/6通过。

四项AST复用候选及Scope＋name窄实验没有稳定初开收益，前者已精确撤回，后者未进入产品；没有把单次约6%的差异计作初开优化。详细分段、实验与原始事实见[Main结果](../../../output/html-performance-20261025/open-analysis/RESULT.md)。

## 快捷键与正式输入接续

- HTML单击选中态原本没有键盘／剪贴板owner，当前由既有Pane承接标准ClipboardEvent；输入控件仍拥有自身的剪贴板。清空保留源Text身份，快速剪切后粘贴等待同一正式ACK，目标变化后不执行旧动作。共用原位纯文本粘贴／换行进入浏览器原生Undo链。保存与正式History仍为原owner。
- “正式记录先投影、receipt后到”的同值文字patch现幂等接受，不重复写Text.data／锚属性；第三种真实不匹配值仍拒绝并保留。真实Agent1/1覆盖两者及零额外characterData写入，见`text-receipt-final.json`。
- Native原生文字对象与确有正式格式动作的plain author field复用原格式owner接B/I/U；属性输入、PM富文本和其他字段不被抢键。有草稿时先由原Slice排空ACK期间继续输入的内容，结束原输入后回传已接受spot，再按当前身份提交格式。sourceRegion的无record绑定基线随已接受文字推进，已有record仍以正式binding为准，没有复制地址迁移规则或新增writer。
- 最后窄查真实PM Ctrl+B没有任何正式变更，已在原PM输入owner将BIU交给SharedDocumentEditor既有toggleStyle；该编辑器源码CodeMirror也补齐Mod+Y。真实正文按键→Main→磁盘冷开全部inline文字／格式及两种源码Redo1/1通过，见`shared-document-final.json`，与HTML剪贴板证据分开。

## 已成立的保留行为与验证边界

- Root paint候选真实Chromium/作者记录直接16/16，包含完全遮挡、部分露出、透明段落caret、图片双击、嵌套留白后输入、坐标相关的空心边框、visibility隐藏父级的可见子级、同scope重入/抛错恢复、inline important恢复、静置无重扫、opaque真实文字和样式变更仍被发现。见`paint-facts-final.json`。
- 统一Pane/输入直接14/14曾在首scope候选通过，正式Main格式修改→Undo/Redo→保存冷开1/1通过。快捷键包32条不同直接检查另见其报告，不混作Root性能证明。
- Root Native格式3/3使用真实Store／Slice／DocumentSession／Driver，覆盖选中对象、精确字段、ACK等待时继续输入、保存后正式consumer冷开：最新文字加粗且B／C邻文保留。直接既有默认提交／IME／源范围／accepted binding检查7/7继续通过，见`output/html-shortcuts-20261025/native-format-final.json`与`default-submit-final.json`。
- HTML候选私有构建的完整Electron经实际文件树打开本包临时嵌套HTML，以可信鼠标选中／键盘事件完成Ctrl+X→空值、Ctrl+V→恢复、Ctrl+Z→空值、Ctrl+Shift+Z→恢复、重新选中Ctrl+B→700及Ctrl+S→dirty=false。真实Main的undoDepth依次1／2／1／2／3，邻文保持、0alert。关闭自有进程，以独立新profile／新Session冷开已保存文件，目标文字／700、邻文及干净状态保持。见`final-ipc-*-parent.json`、`final-ipc-*-preview.json`、[实际快捷条](../../../output/html-performance-20261025/final-ipc-shortcuts.png)与[新进程冷开](../../../output/html-performance-20261025/final-ipc-cold.png)。本条验证Electron IPC载体，不替代物理Windows键盘或原件现场验收。之后PM窄增量不影响本条路径，最终renderer已按新PM再次私有构建。
- 最终Main emit、renderer／player／测试类型及私有player／compiled-player／renderer构建通过。类型发现的Playwright大模型参数推导深度仅在测试传输参数上作unknown注解，未改运行行为或断言。构建都在`output/html-performance-20261025`，没有覆盖共享dist。
- `html_review`未参与实现，分别核同步scope、paint facts、observer净变更、factory、目录观察、剪贴板归属／空值锚、Native提交接续、accepted baseline及最后PM格式port／源码Redo增量，当前实际候选无阻断。已有有效评审未因无关变化重复。

过程中新增inline important反例先超时，定位为临时style写入触发重扫后修正；没有提高正确断言的超时或删除用例。依赖目录在接续时为空，从既有lock和本机离线缓存恢复后继续，未升级依赖或改lock。未commit、push、Portable或发布；用户原件、profile、恢复稿及无关dirty保全。

## 回归边界与剩余项

本次实际断口横跨绘框／命中、作者变动／软件提示、输入／选中快捷键、投影／正式receipt、已接受source binding，只有检查按钮或单次输入无法覆盖。当前用例直接经过实际consumer，保留部分露出、空白后输入、真实变更、Undo、ACK后续输入及冷开邻文；别名解析只归一化按键，动作继续由原owner承担，不建全局第二路由。原统一控件／就近AI／Windows原生鼠标失效对照的证据见[前轮结果](RESULT.md)。

剩余已知性能：25.58MB大HTML的首次资源分析仍需数秒，完整打开样本约14.77–20.89秒；当前绘制／hover仍有65–82ms长任务。没有跳过闭包依赖或静态化程序换取数字，也未把单机有限样本签成普遍流畅。物理Windows键盘／IME、opaque Blob完整剪贴板链和全产品矩阵的未验范围分别保留。
