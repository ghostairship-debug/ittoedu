# Flow 与独立 HTML：独立源码评审

日期：2026-10-24。评审者不是本范围实现作者。本记录针对当前工作树候选，不代表 commit、发行或 Owner 签收。

## 结论

**批准已审 Flow 与独立 HTML 结构候选。** 前次评审提出的两处交互接线问题均已在当前源码闭合，未发现本范围尚未处理的阻断项。

## 审查范围

- Flow 保留单一连续 ProseMirror 正文编辑器，以 inputActive 区分选择与输入；单击使用 NodeSelection，显式编辑进入原输入，完成输入经 drain 后选择当前正文块。
- Flow 全文格式作用于所选块，范围格式作用于真实文字/单元格选区；共用格式控件，不新增格式写入 owner。
- 正文拖动复用语义 drop 与 applyDocumentBlockCommand；浮层复用 FreeTransformGesture，最终坐标经冻结目标提交，取消不提交。iframe 整体指针复用原正文或浮层 owner。
- 独立 HTML 将选择与内容编辑分离；Esc/完成编辑恢复原选中对象，文本交接先 settle，canonical 修改后重新解析同一地址。geometry 使用已有父级矩阵和作者覆盖，不增第二 writer。
- HTML 创作态仲裁阻止业务点击，运行态沿原业务事件；只有真实内容输入扩展文字选区。

## 整改复核

| 前次发现 | 当前复核结果 |
|---|---|
| Flow 光标 CSS 查询根节点的 inputActive 属性，实际属性位于 ProseMirror | 当前选择器明确匹配 `.shared-document-editor .ProseMirror[data-flow-input-active]`，与 editorSession 的真实属性位置一致；选择/输入光标规则接通 |
| HTML 双击图片依赖 event.target，pointer capture 可能把目标改为根节点 | 当前 pickTarget 在 capture-root 事件中按实际坐标读取 authoring hit，并以 painted element 为回退；双击使用该同一命中结果生成 image edit report |

图片反例已新增到 unifiedSelectionHtml20261024.test.tsx：通过真实共享仲裁请求根节点 capture，再将第二次 pointerdown、click、dblclick 的事件目标设为根节点，验证最终只有一个图片编辑意图。该测试保留实际 paint reader；只补充 jsdom 不具备的布局、capture 和构造样式表事实。实现作者报告该反例通过，本评审已核对测试定义与修法对应，不重复运行既有有效检查。

## 证据边界

本次独立审查读取源码、diff 和针对性测试定义；最终增量只复核上述两点整改。本评审没有运行 GUI、构建或保存/冷开流程，未修改实现，也不将作者报告的测试结果改称独立实测。真实浏览器呈现、跨 realm 指针、保存与冷重开应以本轮结果文档的实际执行证据为准。

实现入口：[FlowWorkspace](../../../src/renderer/ui/FlowWorkspace.tsx)、[SharedDocumentEditor](../../../src/renderer/document/SharedDocumentEditor.tsx)、[editorSession](../../../src/renderer/document/editorSession.ts)、[HTML 预览视图](../../../src/renderer/documentFiles/html/HtmlPreviewPane.tsx)、[HTML controller](../../../src/renderer/documentFiles/html/htmlPreviewController.ts)、[HTML page agent](../../../src/player/htmlPreview/htmlPreviewAgent.ts)、[嵌套 HTML authoring](../../../src/shared/html/htmlFrameAuthoring.ts)、[样式](../../../src/renderer/styles/globals.css)。
