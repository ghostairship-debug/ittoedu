# r19-047-shared-document-editor：实现连续正文与源文共用编辑核心

- Release: 1.9
- Dependencies: `r19-046-shared-document-contract`
- Optional: 否
- Write locks: `authoring-flow`, `workspace-shell`

## 结果与边界

按 [正文合同](../../R19_SHARED_DOCUMENT_CONTENT_CONTRACT.md)实现可脱离课件使用的连续正文核心；Tiptap/ProseMirror负责排版输入，CodeMirror负责源文，KaTeX呈现有限数学。通过两个保存接入口接入不同归属，不把库history或JSON当第二工程真相。

## 直接入口与写域

读取 [FlowWorkspace.tsx](../../../../src/renderer/ui/FlowWorkspace.tsx)、[flowTextEdit.ts](../../../../src/renderer/authoring/flowTextEdit.ts)、[flowEditorSlice.ts](../../../../src/renderer/course/flowEditorSlice.ts)、[flowInlineTextEditor.test.tsx](../../../../tests/unit/flowInlineTextEditor.test.tsx)。本节点新建共用正文UI/会话适配模块，不提前改正式Flow根Schema或直接接完整Store；048负责替换旧Flow writer。

## 执行顺序

1. 完成所有约定正文承载点、文字/数学原子、链接/代码和复杂对象视图；跨段落、列表、公式选区及表格选区按各自语义处理。
2. 实现中文IME、光标/选区映射、分段合并、复制/剪切身份、样式及行内/独立公式转换。
3. 实现源文/排版双向切换、有限扩展折叠与错误定位；无效源文保留草稿，不静默丢对象。切视图不增加一次内容撤销。
4. 将操作分组和持久化flush交给保存接入口；Flow不启用另一个库撤销历史，文档可使用自己的文件编辑历史。
5. 以实际UI挂载验证核心并交付可消费的窄端口，不反等049文件接入。042/049使用核心完成真实Markdown保存，文件接线证据归049/050；Flow接线归048。独立核心验收不冒充真实文件已接通，也不把下游接线变成047的隐性前置。

## 验收与聚焦验证

新增sharedDocumentEditor命名用例覆盖中文组合输入、跨段落/公式选择、表格/表头、分段合并、视图切换和分组撤销；可扩展现有flowInlineTextEditor相关行为。真实窗口操作一次混合正文；渲染正确不能代替选择/输入/撤销。

## 退出与交接

交付可测试的窄编辑器接口给048/049。Flow接线由048、文件接线由049完成；本节点不改变其他Surface或生成调度，不依赖真实模型。
