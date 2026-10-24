# 统一选择与编辑：独立源码评审

日期：2026-10-24。评审者为非实现作者，本文件只记录当前工作树候选，不代表已提交、发行或 Owner 签收。

## 结论

**批准本次已审范围的结构候选。** 当前源码未发现尚未处理的阻断项。选择、输入、几何变换和写入继续沿既有 Bridge、专业输入 owner、变换算法和 canonical transaction；普通组只增加临时 view scope，没有第二份正式树、writer 或 History。

本结论覆盖 Slide、Spatial、共享内部字段交互、普通组上下文、精确字段微移，以及本次新增的 Program、导航返回和投影选框增量。Flow 正文与独立 HTML 的完整行为不由本次源码评审替代。

## 已核对的关键链

- Slide 在普通指针中选择整体或准确内部字段，显式双击才进入原输入；内部字段 bounds 接入当前快捷条。普通组通过正式树解析当前层级，退出编辑不会自动抬升字段为父组件。
- Spatial 与 Program 的框和手柄消费实际变换能力；锁定或输入期间保留实线关系，关闭不可用手柄。Program 根视图的测量框不冒充作者 frame；具有真实 free frame 的对象复用既有仿射变换和 Bridge 提交。
- realm 保留原始字段身份和 start/update/end/cancel，旧无 phase 消息只选择。精确字段方向键不回退为移动派生父实例；取消手势与完成文字输入分开。
- Program 的 DOM 仲裁覆盖 Element，包括 SVG 命中；Runtime 的两个实例投影入口均传递正式 selection kind，精确字段不再被派生实例 ID 画成整体选择。未接 Bridge 的独立投影保留已有语义。
- 导航返回优先退出普通组；App 的 Esc 路由优先完成当前 draft，再返回组层级，最后才清选择。原输入失败时不通过清选择丢弃 draft。

## 评审发现的整改已闭合

| 发现 | 当前闭合方式 |
|---|---|
| Spatial 锁定字段或编辑期仍显示变换手柄 | 以 selection phase、锁定和真实目标推导能力，框继续显示 |
| Slide realm 连续移动按旧 canonical frame 还原局部点 | 使用当前渲染内容的 client matrix，再转为 surface 点 |
| Slide realm 右键先创建内部 gesture，后续 hover/up 可能继续它 | 右键在创建变换前选择并开菜单，同时清理旧内部预览 |
| 整体公式 Esc 残留直接 cancel draft 的旧特例 | 与其他专业输入一样经原 owner 应用或保稿后退出 |
| Slide 前一输入慢 ACK 时直接丢弃新的双击意图 | 先冻结语义命中，等待原输入完成，再按同一上下文激活 |
| 共享 hook 内部图片双击只重复选择 | 显式 edit 进入已有替换入口，单击仍只选择 |
| 上述图片入口对 locked 对象仍可能打开选择器 | 替换前及完成交接后都检查现有锁定事实 |
| Program 仅接受 HTMLElement，SVG 跳过作者仲裁 | 使用 Element，SVG 沿相同选择、整体拖动和点击仲裁 |

对应实现见 [SlideLocationWorkspace](../../../src/renderer/ui/workspaces/SlideLocationWorkspace.tsx)、[SpatialLocationWorkspace](../../../src/renderer/ui/workspaces/SpatialLocationWorkspace.tsx)、[共享字段交互](../../../src/renderer/ui/workspaces/useComponentAuthorInteraction.tsx)、[Workspace](../../../src/renderer/ui/Workspace.tsx)、[专业输入](../../../src/renderer/ui/workspaces/ProfessionalContentEditor.tsx)、[Bridge](../../../src/renderer/documents/CourseV10DocumentBridge.ts)、[Runtime 投影](../../../src/renderer/components/CourseV10RuntimeView.tsx)、[实例投影](../../../src/renderer/documents/CourseV10DocumentView.tsx)及 [App 键盘接线](../../../src/renderer/App.tsx)。

## 证据边界

本评审执行只读源码、diff 和针对性反例定义检查，未独立运行 GUI、构建或长测试集；未修改实现。作者报告的针对性通过结果供集成记录引用，本文件不将其改称评审者独立实测。实际呈现、跨 realm 的真实浏览器指针链、保存与冷重开仍以本轮结果文档中的实际执行证据为准；源码批准不等于这些验收均已通过。

## 实际消费者增量复核

复用上文有效评审，只复核随后集成的直接消费者。**该增量批准，未留阻断项。**

- Program 原生表格／图表接入已有 `useSlideNativeTextEditor`；`wholeInstanceEditor=false` 防止共享字段 hook 再挂整体输入。新增 `resolveTarget` 只提供已有自由对象的投影，程序根仍不生成虚构作者 frame。单元格／标签输入、文字输入和正式提交沿原 owner。
- Program 等待输入 ACK 后，从 Bridge 当前 `editingProject` 构造变换目标；DOM 只提供实际已渲染父级到 client 的映射。由输入接收的新尺寸不会被旧 runtime 投影尺寸覆盖。
- Slide 原生双击先把当前整体目标收敛为该成员，再进入原生输入；图片的原有编辑事件延后一轮并核对原上下文和当前目标。增量评审发现 realm fallback 的延时回调曾引用未进入的普通指针分支变量 `next`；当前已改为在双击分支冻结独立 `context`，该运行时错误已闭合。

此增量仅做源码检查并写入本记录，按要求未重跑原有验证、测试或 GUI。作者新增的表格／图表输入、ACK 尺寸与双击代表证据仍由本轮结果文档记录。
