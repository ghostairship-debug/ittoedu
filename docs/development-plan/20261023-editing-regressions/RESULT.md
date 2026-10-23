# 编辑阻断与体验回退：架构修复结果

日期：2026-10-23。状态：本轮已定位问题的软件修复及独立复核完成；指定GLX、大小HTML副本的实际编辑、保存及新进程冷开通过，最后移动控件视觉增量通过。未进行commit、push或发行。

Owner已授权按[唯一方案第11节](../../archive/编辑阻断与体验回退修复方案-2026-10-23.md)先形成架构选择再修改。基线为HEAD `76101357`与当前有效脏树，逐写域原始文件保存在 `output/editing-regressions-20261023/baseline/`，不覆盖用户原件／恢复稿，不commit、push、Portable或发行。

下表的实施与独审完成不等于所有产品行为已实机验收。聚焦检查、实际Chromium／Office／输出产物和最终原文件副本GUI分别按原样本与属性成立。原失败、不成立报告项和外部条件边界均保留。

## 为什么会反复回退，以及本轮如何减少复发

- **保留稿被当成活动输入占用。** 旧稿、当前字段、真实IME和等待ACK混成全局布尔值，导致A的失败锁住B，或迟回执清掉新输入。本轮在原输入owner内分开这些事实，统一按文档、目标和输入身份交接，保原稿但不占无关编辑。
- **失败类别在入口处丢失。** 确定拒绝、已应用、结果未知和读取失败被压成同一种报错，造成永久占用或错误重试。本轮保留typed结果，由原操作精确结束；真正unknown只查原ID，不重放。
- **相同内容走不同适配器，事实漏传。** 大HTML包含编译外壳与opaque嵌套程序，和小HTML直接页面不是同一路径；文字样式、空白、选区、坐标与可编辑提示曾在跨frame时丢失。本轮共用portable作者事实与变换，保业务事件隔离，不按体积换编辑器。大文件额外的源码与资源准备成本仍独立记录。
- **异步完成被等同于仍拥有当前界面。** 导入、更新或打开在await后继续使用旧选择，导致抢页、错插或释放错误输入。本轮复用原controller的作用域／ticket，把后台内容完成与前台激活分开。
- **验证经过局部owner却漏掉实际接线。** 本次真实HTML验收才发现Main只接纳course恢复稿，虽局部磁盘测试通过，HTML原稿仍必被拒。已修该实际guard，并加入真实Host保存／关闭／新Host恢复反例；后续相关改动按消费者链选验证。

防回退采用已确定的产品行为和本批失败反例：保留编辑／完成编辑、原字形、无关稿不锁编辑、原ID不重放、保存冷开、精确删除范围及右键不导航。重要职责变化由非作者审查实际consumer和保留行为。影响产品体验的新取舍先与Owner讨论；不以重构或测试维护自行改变已确认行为。不另建恢复平台、第二writer或机械全矩阵。

## 领域结果

| 包／原问题 | 当前真实结果 | 证据与剩余 |
|---|---|---|
| P1 A07/A17/A18/B18/B19 | 原输入owner保raw后精确结束确定失败；unknown原ID查证、不重放；idle重连；同revision资源更新；no-op历史边界；手动冲突稿等待真实持久化ACK。实施及独审通过。 | `output/editing-regressions-20261023/P1_RESULT.md`。Bridge在途创建／打开的前台归属及Store／App薄接线已接续，相关增量与独审通过；不据此签最终原文件GUI。 |
| P2 A01/A04-A06/A08/A17/A19 | 原稿与活动输入分开；属性登记／目标切换、Source／JSON活动lease、恢复及失败出口已实施。Lifecycle不泛吞drain异常，无关旧稿不能顶替本次输入；隐藏／退场原稿不自动强推，pending不占另一目标，真实IME仍保护。实施及最终增量独审通过。 | `output/editing-regressions-20261023/p2/RESULT.md`、`p2-properties/results.json`、`p2-source/`。原T03／Q0等旧期望的维护经独立确认，原raw、target、字节、History、保存冷开与不写B断言保留；恢复默认和依赖COW的已确认输入消费亦有定向增量。 |
| P3 A02/A03/A08/A16/A17 | 字段三方接续、原provider保稿、当前scope投影、Flow准确record保留及退出端口已实施。迟到A回执不认证或清掉新B，含仅onDraft的坏源B；只按原已接受命令推进基线，真实外部冲突保留；精准范围意图随原稿保存。实施及最终增量独审通过。 | `output/editing-regressions-20261023/p3/RESULT.md`。真实Session／Main原目录恢复、范围冷恢复、custom field不混入临时text数据和迟ACK反例通过；投影提示仅清自身错误，独立磁盘／手动错误保留。最终样本GUI另见下节。 |
| P4 HTML/旧GLX/A09-A14/B14 | 同源/nested/opaque事实统一、可见性、选区、样式/空白/二维映射、confirmed提示、编辑/完成编辑、持久保稿与等待恢复已实施；独审通过。移动控件统一在既有工具栏，不遮相邻文字。 | `output/editing-regressions-20261023/p4-result.md`。原GLX与大小HTML实际编辑／保存／冷开均通过；最后工具栏增量17项及实际画面通过。B14未证明普遍提速。 |
| P5 B01/B11 | 范围修改共同语义覆盖输入/剪切/粘贴/Enter/拖动；公开正文明确去范围；保布局/存续身份/关系，observer与IME准备交易分开。独审通过。 | `output/editing-regressions-20261023/p5/RESULT.md`、`p5/review-final.json`。不签物理IME。 |
| P6 B06-B08/B16 | 布局资格、原生字号、完整组图面、长Flow尺寸/分页、字体已修；实测标题单独页/空白中页/重复图片资源同根补修。独审通过。 | `output/editing-regressions-20261023/p6-output/CHECKS.md`；Chromium与LibreOffice真实产物，未签Word GUI/极端截图尺寸。 |
| P7 B02-B05/B09/B10/B21及库/删除 | 异步owner、Bridge／App前台接线和卡片查询已修；显式整页／状态／镜头删除范围、Owner已选的右键不切画面、基础定义隐藏及语义插入已实施，库重试保留原提交意图和审阅输入。相关候选与增量独审通过。 | `p7-async/focused.json`、`p7-async/navigation.json`、`editingNavigationActions20261023`与`libraryInsertionRecovery20261023`等定向记录。通过数与样本以原始结果为准；尚不计全部UI已完成实机组合验收。 |
| P8 B12/B13/B15/B17 | PDF阶段/取消和真实发布结果，PPT协作取消/仅本次COM清理、材料复用隔离提取、错误HTTP不聚合大body已修。独审通过。 | `output/editing-regressions-20261023/P8_RESULT.md`；真实Office材料保留。旧交付2个编码fixture失败有修前差分，不冒称全套通过。 |
| P9 A20/B20 | 已保存后的恢复维护失败不假报unknown；关闭/后续Save As保未决证明，冷Host原ID可查证不重放。独审通过。 | `output/editing-regressions-20261023/p9/`，4文件38项通过。 |

## 组合验证与本批新发现

- Renderer、Main及e2e类型检查通过；隔离candidate Main、Renderer及Player/compiled构建通过。最后工具栏变更后仅重跑受改Renderer类型／构建及视觉，均通过。日志在本批output：`renderer-types-toolbar-final.log`、`main-build-accepted.log`、`e2e-types.log`、`renderer-build-toolbar-final.log`、`player-build-final.log`；构建有chunk体积提示，不是失败。
- 领域原始聚焦证据沿上表保存，不累加重复执行为通过数量。Root库／删除／状态交互3文件15项通过；真实恢复历史`exists:false`反例修复后2文件7项通过，旧背景迁移定向1项通过；新增HTML真实Host3项先红后绿。原旧fixture失败与修前对照仍保留，未称全套测试通过。
- 本批新发现按原共同owner修复，包括：PM组合准备提前删除；旧ACK不能覆盖新raw；原稿保全不能只等待吞错排序tail；未登记活IME不能由无关旧稿顶替；源码退出不能强推历史有效稿；图片捕获/分页的真实空白页；晚取消不能吞真实写入结果；前台归属同时覆盖工作空间、标签和Bridge实际激活；库重试必须区分稳定提交意图和另一目标。
- 方案中的正确边界／反证继续保留，不重复改造已修SAVE01、母版禁删、单writer等。未证明性能收益的准备复用不签普遍提速。
- P1的队列／连接选择在实施前通过独立技术review；P1–P9各领域候选及必要后续增量均已由未参与对应实现者复核。独审中发现的observer输入分类、无关原稿顶替活动输入、范围意图丢失、Source退场lease、迟ACK误消费新稿及恢复迁移等实质问题已回原owner修正后通过增量复核，未以作者自检替代独审。

## 最终原文件组合验收

仅在`output/editing-regressions-20261023/workspace/`操作桌面英语素材的副本，使用隔离production candidate及每次独立profile；原件与用户正在运行的窗口未修改。通过原编辑界面进入课堂、点字、修改、完成编辑并点击保存；关闭进程后用全新profile重开磁盘文件核结果。GLX另核Undo／Redo。

| 原样本 | 首次可操作／进入原位输入／完成改字／保存ACK（毫秒） | 冷开结果 |
|---|---|---|
| `Unit 1 · YOU & ME — 互动改编版.glx` | 3768 / 396 / 1089 / 5780 | `One connection. QA`保留；42px serif字体保留；Undo／Redo通过。 |
| 小HTML `Unit1-You-and-Me.html` | 3687 / 1724 / 2231 / 5300 | 修改与字体保留；编辑／完成编辑可用。 |
| 大HTML `Unit 1 · YOU & ME — 互动改编版.html` | 6953 / 323 / 975 / 5750 | opaque嵌套文字修改与字体保留；虚线提示可见。 |

三样本source与原位输入的font-family／font-size／white-space一致，冷开font-family／font-size一致，最终无alert或pageerror。这些为单次样本记录，含界面等待，不是同条件性能对照，不能推断大HTML普遍更快或全部大文件秒开秒存。完整事实：`output/editing-regressions-20261023/gui-save-cold-accepted.json`及同名log；真实截图为`glx-inline-final.png`、`small-inline-final.png`和三份`*-cold-final.png`。

最后查看大HTML截图发现画布侧移动图标仍覆盖相邻文字，已统一移到现工具栏固定槽。相关2文件17项与独立增量复核通过；受改Renderer重建后真实点字检查输入和相邻正文不再被手柄覆盖、完成编辑正常、无alert。事实：`final-handle-gui.json`；画面：`large-inline-toolbar-final.png`。该纯位置调整未影响保存／Main，复用上述已通过冷开证据。

验收中的封面遮挡、跨iframe坐标与OOPIF鼠标命中同步属于脚本准备问题，记录保留，没有为此放宽产品命中或绕过正式writer；确认实际hover后通过可信鼠标输入。真正的Main恢复门与历史缺失fact故障则已回原owner修复、独审并重建。

剩余边界：未证明B14普遍提速；未签物理IME、Microsoft Word GUI、任意设备字体及极端截图尺寸，也不替签旧完整创作／发行／Owner整体接受。这些限制不再被写成当前样本无法编辑。全部A/B及用户体验项的处理归属如下；当前正确或报告不成立的边界保留。

## 原问题逐项覆盖

“修复”指已有候选与对应聚焦证据／独审，不代替前述原文件组合验收。原报告误报不重复立项。

| 原编号 | 处理归属与当前裁定 |
|---|---|
| A01 | P2：多候选／未挂接原稿可靠保留，不作无关编辑门。 |
| A02 | P3：字段三方接续、已应用识别；真实重叠保原稿。 |
| A03 | P3：原provider保留后退出当前占用，真实IME不假结束。 |
| A04 | P2/P3：保存／退出等待实际原稿ACK，空清理串行。 |
| A05 | P2：未挂载属性原稿不挡另一目标。 |
| A06 | P2：Source／JSON按真实活动lease，隐藏／退出不强推旧稿。 |
| A07 | P1：原ID查证／精确结束，unknown不重放。 |
| A08 | P2/P3：本owner明确保稿就绪，不能用无关旧稿掩盖真实输入失败；未保全staged媒体仍保护退出。 |
| A09 | P4：完成编辑可保稿退出，正常输入不被局部失败永久占住。 |
| A10 | P4：HTML原稿真实持久化ACK，实际GUI发现Main类型门遗漏后补齐并独审。 |
| A11 | P4：结构／样式由当前输入准备，不被无关历史稿封锁。 |
| A12 | P4：mode/ready失败可重试或转源码，不穿透错误业务模式。 |
| A13 | P4：局部source span与同source分析复用；有局部诊断不默认否定整个目标。 |
| A14 | 原本资源／geometry／程序诊断的局部边界保留，不虚列成新全局gate。 |
| A15 | 真磁盘冲突／保存失败仍如实保护；P1/P9修恢复出口及结果事实。 |
| A16 | P2/P3：Scope投影与原稿保留一致，A不锁B。 |
| A17 | P1/P2/P3/P7：字段、源码、公式、图表、背景、手势、库卡与一次性命令保typed outcome；原owner精确收敛。 |
| A18 | P1：idle重读、FileSession原raw/原ID保留、真实冲突UI、手动稿实际ACK；P4接session冲突文案。 |
| A19 | P2：真实mounted/binding注册，IME与ACK分开，不因关闭A漏B原稿。 |
| A20 | P9：保存事实与后续恢复维护分开。 |
| B01 | P5：跨列所有实际范围修改共用保结构语义。 |
| B02 | P7：图表弹层／工程卡／混合库复用Flow书签；全局／Spatial placement同源。 |
| B03 | P7/P1：异步完成与前台激活事实分开；旧请求不抢新scope。 |
| B04 | P7：工作空间、文件树、会话与恢复入口均归原请求／导航。 |
| B05 | P7：新建／复制通过输入交接，晚ACK不抢新页面。 |
| B06 | P6：合法原生布局与capture资格收口，静默错排退出。 |
| B07 | P6：普通组capture保完整后代。 |
| B08 | P6：长自然Flow保像素清晰度与阅读尺寸，实际分页。 |
| B09 | P7：延迟查询错误可重试，任务不重发；主刷新已修事实保留。 |
| B10 | P7：更新／替换失败保审阅输入，原ID再查；真实成功才释放对应请求。 |
| B11 | P5/P3：明确去range不被重加，专业稿序列化同意图。 |
| B12 | P8：PDF打印可取消，真实发布结果不被晚cancel抹掉。 |
| B13 | P8/P7：PPT真实取消及精确COM清理，业务入口信号贯通。 |
| B14 | P4：收窄已证实重复准备，保留成本；未证明普遍提速，不虚签。 |
| B15 | P8：Office材料复用原隔离提取owner。 |
| B16 | P6：实际字体资源链接入PDF；不签任意设备字体等价。 |
| B17 | P8：错误HTTP响应不无界聚合；合法内容不加任意体积拒绝门。 |
| B18 | P1：同revision真实资源delta接纳，未变buffer仍复用。 |
| B19 | P1：no-op回执不错误割裂Undo组；真实作者／任务／历史边界保留。 |
| B20 | P9：未决保存证明可跨关闭／另存按原ID查证，不回滚／重放。 |
| B21 | Owner已选不切画面；P7状态菜单按所指对象操作。 |

用户§2的模式、字体／空白、选区／变换、虚线、移动、旧GLX均由P4及P3当前输入收口；基础库与整页删除由P7收口，母版继续不可删。新增真实恢复失败由`RECOVERY_FINISH_RESULT.md`接续：历史删除fact无value不再进入旧背景迁移，严格current验证和历史隔离保留。
