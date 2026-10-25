# HTML 编辑修复与指针定位（2026-10-25）

三项均已有源码修复和对应证据。第2项已在用户的 You-and-Me 原件上复现，原因是鼠标经过空白处触发命中检测死循环，与文件大小无关。HTML已消费共用快捷条和就近AI动作；完全被遮挡的内容不再显示可操作提示。起点只读调查见[原报告](../../../output/html-regression-20261025/REPORT.md)，其中第2项“未决”属于修复前时点，以本结果及[原生鼠标对照](../../../output/html-edit-repair-20261025/pointer-investigation/RESULT.md)接续。

本轮仅修改软件与直接检查；原素材、真实profile和启动时已有未提交成果保留。未commit、push、发布、部署或调用付费模型。没有重启用户正在使用的窗口；源码启动脚本下次启动会准备对应构建，已打开的旧预览进程不会自动获得新Agent。

Owner随后要求的卡顿检测、继续修复和快捷键审计已接续到[性能结果](PERFORMANCE.md)及[快捷键结果](../20261025-html-shortcuts/RESULT.md)。本文保留前三项修复时点，不把后续性能／快捷键证据倒算进原统计。

## 根因、引入点和修复

| 现象 | 已确认因果及历史点 | 修复后的行为 |
|---|---|---|
| HTML控件不统一、文字AI入口消失 | `76101357`（10月22日）把文字输入从旧面板迁至原位编辑器，旧面板内的AI动作没有一起迁出；`fb2a7d21`（10月24日）又新建HTML专用工具条，未消费共用快捷条或补回动作。旧面板单独测试仍通过，实际文字入口却不挂载它 | 删除独立工具条，实际`HtmlPreviewPane`消费`SelectionQuickBar`与`TextFormatActions`；HTML与组件DOM文字共用格式映射。`HtmlTargetAiButton`作为唯一当前字段AI动作供快捷条和图片面板使用，先提交输入，再捕获正式Session中的当前字段 |
| 有框，悬停／双击却失效 | `nestedAuthoringDom.hit`用`candidate.frame === top`查子frame；空命中时`top`为undefined，恰好匹配没有frame的root entry，从而root→root／root→child→root同步循环。`76101357`留下该查找，`fb2a7d21`扩大HTML/BODY及hover命中调用后暴露。原件srcdoc内固定定位内容使html/body高度为0，黑色留白处正好产生空命中 | 只有实际绘制元素存在时才沿对应frame下行。空白正常返回无目标，预览继续处理悬停与双击。没有按文件名、体积或超时加旁路 |
| 被遮挡的文字有虚线框，却无法选中 | 最早可追至`423a96dc`（10月8日）的顶层描框按布局矩形／视口相交和可写确认决定；点击按实际绘制栈决定。两个规则不一致，使底层矩形浮到遮罩上 | DOM authoring统一提供绘制可见性与命中语义，根预览及opaque frame均消费。绘框检查实际文本行片段、裁剪及绘制遮挡，嵌套frame还检查祖先frame对应区域。完全遮挡不画，部分露出的目标保留；正常点击与捕获后的双击走同一命中owner |

不是所有“不可见”都由同一次提交产生，也不是所有小文件都不能编辑。原来直接移动到文字再双击可以成功，先经过留白才触发冻结；这解释了先前隔离检查为何没有复现用户路径。用户截图中旧提示仍在、外层窗口能操作，符合仅预览renderer卡住的事实。

## 保留能力与候选内修正

- 单击选中、拖动整体、双击编辑、Esc完成、原位纯文本输入、图片面板及旧行距／内容盒宽度入口保留。独立文字盒提供共用格式控件；共享父元素的混排文字仍按原纯文本能力处理，避免把某一Text的字号应用到相邻Text。未把HTML升级为逐字富文本模型。
- 保存、History、AI目标及资源继续由既有DocumentSession／Main／ToolTargets负责，没有新增writer、选择Store或AI旁路。AI卡片能读取刚完成的输入，而非旧props或旧源码片段。
- 独审和实际入口验证发现候选中的共享父格式误伤、目标对象克隆破坏ACK保留、异步props晚到导致误reload、透明段落空白命中回退，均已修正。对晚到props只关联当前lease内已应用且revision与beforeSource同时匹配的历史记录；真实外改和patchMismatch仍走原重载处理。
- 软件提示层的shadow文字不再进入作者目标集合；绘框不反复重写未变化的标签。该问题确实存在，但不是第2项冻结的归因。

## 证据与准确边界

| 待证明属性 | 最终证据 |
|---|---|
| 实际HTML入口消费共用快捷条、就近AI卡正确 | 真实`HtmlPreviewPane`＋Main编辑服务＋Agent的只读原件浏览器装配中，选中ME后打开真实`AI 修改：“ME”`卡片；独立标题字号12→24，相邻YOU／ME保持74，选框与工具条保留、无alert。见[统一控件](../../../output/html-edit-repair-20261025/html-format-controls.png)、[就近AI卡](../../../output/html-edit-repair-20261025/html-nearby-ai.png)及[格式事实](../../../output/html-edit-repair-20261025/ui-format-facts.json)。此装配不替代完整Electron外壳或磁盘保存 |
| 输入后AI捕获当前内容、格式ACK期间保留选择、一次历史、原有几何与图片操作 | 聚焦3文件26/26，涵盖真实Pane入口、Main服务、既有作者记录／IME草稿／原生轻动作；新增晚到props反例保留原选择、可继续编辑、一次History断言。见[最终报告](../../../output/html-edit-repair-20261025/entry-native-ack-final.json) |
| 遮挡提示与实际输入 | 当前Agent源码内存编译的真实Chromium2/2：完全遮挡无框、部分露出有框、pointer-events:none绘制图片命中、透明段落空白命中、提示shadow文字排除，以及嵌套零高根空白→双击编辑。见[报告](../../../output/html-edit-repair-20261025/browser-final.json)与[截图／事件](../../../output/test-runs/html-paint-input-20261025/) |
| 用户第2项修前失效／修后可用 | 独立Electron打开同一`C:\Users\74755\Desktop\英语素材\Unit1-You-and-Me.html`原件，同一952×815预览和Windows原生鼠标路径：修前留白后preview evaluate超时、父窗口正常、双击无输入；候选留白后preview正常、可信dblclick进入` ME`的原位输入。精确替换自有进程Agent，未重建共享dist，见[独立定位及原始证据](../../../output/html-edit-repair-20261025/pointer-investigation/RESULT.md)。这证明Agent修复，不替签统一工具条的完整Electron验收 |
| 新格式的正式保存、撤销重做、冷开及运行消费 | 新增Main集成用例1/1：HtmlSourceEditService→真实DocumentHostService写一次历史，Undo还原，Redo后保存到临时文件，新服务冷开并运行保存的正式consumer，目标24px／新颜色、邻居12px，原按钮onclick可运行。见[报告](../../../output/html-edit-repair-20261025/save-cold-final.json)。按用例名定点执行；文件内另18项未在这条命令中执行，不计入通过 |
| 类型及独审 | renderer、Main、测试三套tsc无错误；最后Pane ACK和新增保存测试后renderer／测试增量再次通过，Main源码未变所以复用。`html_review`未参与实现，集中核直接消费者与原能力，并对修正增量复核，结论无剩余阻断项。`html_pointer_investigation`只读完成原生失败对照 |

过程中一次扩大到`textFormatControls20261017.test.ts`，其中旧native-color夹具因owningContainer的childIds缺失失败；未改该夹具、产品结构或断言来洗绿，未将该次命令报全通过。新浏览器用例最初点到文本范围外而超时，已按真实boundingBox取露出位置，不提高超时或弱化遮挡／输入断言。原始失败报告仍保留在output中。

Studio原件另有重复`const $`绑定的脚本语法错误，普通浏览器也可见，属于独立素材问题；本轮未修改原件。未跑全仓／完整GUI矩阵，未声称全部旧文件、物理IME或Owner现场已验收。

## 今后如何避免同类漏检

这次补的是失效边界，而非增加一轮全面检查：正式Pane入口的AI用例可拦住“旧组件仍有按钮、实际入口已丢失”；实际Agent鼠标用例可拦住“人工注入targets通过、消息产生前已经卡死”；绘制覆盖与部分露出反例可拦住“有矩形就画框”；晚到props与保存冷开检查可拦住入口统一引入的真实异步／持久化回退。这些用例已进入现有Vitest默认收集，不另建平台或审批门，也未宣称远端CI已运行。

后续改入口时，审查实际挂载链和迁出前动作集合；保留统一快捷条／格式映射／目标动作的单一实现。已有通过证据按覆盖范围复用；出现新现场失败，先找到事件消失的那一跳，不能用其他环境的一次成功替代，也不把当前断点泛化成文件大小或架构改造本身必然失败。
