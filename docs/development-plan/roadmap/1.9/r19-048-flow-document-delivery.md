# r19-048-flow-document-delivery：交付新Flow正文、保存播放及可编辑Word数学

- Release: 1.9
- Dependencies: `r19-047-shared-document-editor`
- Optional: 否
- Write locks: `contracts-schema`, `generated-index`, `store-flow`, `authoring-flow`, `props-flow`, `published-flow`, `published-producer`, `export-docx-print`, `app-save-recovery`

日期：2026-09-18 状态勘误。**Flow 正文、两预览、HTML 与可编辑 Word 数学已有 Wave C 等分项证据，见[共用方案第 4 节](../../R19_SHARED_DOCUMENT_EDITOR_IMPLEMENTATION_PLAN.md#4-剩余范围与滚动批次)；禁止从零重做。** 只在相关 consumer 变化时补验；无 Word 环境则复用已有证据并保持“未新实测”。实施次序见[主方案](../../R19_FRONTEND_SPECIAL_IMPLEMENTATION_PLAN.md)。

## 结果与边界

将共用核心接入真实Flow，在一个可运行切换批次中替换V9/Published根定义及全部直接producer/consumer；完成保存恢复、唯一工程History、Player/两种预览、离线HTML和结构化可编辑Word数学。无旧正文/AST兼容模式。

依据 [正文合同](../../R19_SHARED_DOCUMENT_CONTENT_CONTRACT.md)。当前Flow纸张、媒体、合并表格、图表、章节、组件、导航和浮层的编辑能力保留；本次不是仅替换画面里的contentEditable。

## 必读的实际接入点

- [FlowWorkspace.tsx](../../../../src/renderer/ui/FlowWorkspace.tsx)、[flowTextEdit.ts](../../../../src/renderer/authoring/flowTextEdit.ts)、[flowAuthoringSlice.ts](../../../../src/renderer/store/slices/flowAuthoringSlice.ts)、[flowEditorCommands.ts](../../../../src/renderer/course/flowEditorCommands.ts)。
- [flowAuthoringTool.ts](../../../../src/renderer/authoring/tools/flowAuthoringTool.ts)、[materialCitationTool.ts](../../../../src/renderer/authoring/tools/materialCitationTool.ts)、[dynamicAdmissionScope.ts](../../../../src/renderer/authoring/tools/dynamicAdmissionScope.ts)：AI正文输入、引用段落、动态准入空正文都须更新。
- [coursewareBuilderV2.ts](../../../../src/renderer/course/coursewareBuilderV2.ts)、[flowDocumentModel.ts](../../../../src/renderer/course/flowDocumentModel.ts)：正式构造、身份及纯文本投影。
- [FlowSurfaceHost.ts](../../../../src/player/surfaces/flow/FlowSurfaceHost.ts)、[flowModel.ts](../../../../src/player/surfaces/flow/flowModel.ts)、[flowPrintPlan.ts](../../../../src/renderer/export/course/flowPrintPlan.ts)、[flowDocx.ts](../../../../src/renderer/export/course/flowDocx.ts)：显示/打印中间层及Word，不在中间先压成纯文本。

## 执行与验收

1. 唯一集成人接管V9/Published Schema、工厂/命令、工具合同、Builder与样例；删除Flow旧字段与writer，更新受影响能力/合同生成物。不得提交正式根Schema与旧consumer不匹配的中间版本。
2. 接入新编辑器、属性命令与History，合法草稿在保存前提交；无效源文恢复与dirty状态明确。结构/资源/导航在同一事务更新，迟到修改不写当前目标。
3. 统一作者态、Player、两种预览、打印计划与离线HTML；保留实际可用宽度和浮层/组件生命周期。
4. Word从共同数学结构输出，先复用046九类数学的有效转换/修改证据，再对真实Flow导出的混合正文做结构编辑、保存重开和呈现验证，证明新增出口。只有共同数学writer、转换语义或相关环境改变时才重验受影响类别，不默认完整重做046；不能以数学图片、线性串或仅m:oMath通过，不增加LibreOffice第二渲染门。
5. 用新模型重建受影响fixtures，并核对原有可用功能；不承担旧版本文件读取。其他Surface仍用的Native公式类型/编辑器保留，不做全仓AST清除。

## 聚焦验证与退出

沿flowProductIntegration、flowEditorCommands、courseDraftPersistence、flowDocxProjection、flowSurfaceHost及混合表面History命名测试补新语义，先跑目标用例；两预览与Word分别真实验证。需要整应用编译/构建以证明本节点可运行切换时执行对应build，不在每个局部重复整套真实CLI矩阵。

完成后旧Flow writer零实际consumer，新结构能编辑、保存重开、运行与适用导出；050再验证整课组合。
