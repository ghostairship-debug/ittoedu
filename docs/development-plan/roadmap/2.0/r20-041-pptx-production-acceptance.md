# r20-041-pptx-production-acceptance：完成 PPTX 导入增强的内部生产创作验收

- Release: 2.0
- Dependencies: `r19-051-pptx-media-effects`, `r20-030-docs-accessibility`
- Optional: 否
- Write locks: `app-save-recovery`, `workspace-shell`, `generated-index`

## 结果与现状

既定真实PPT/PPTX集完成导入→共享层修改→内容改写→保存重开→Player/导出，PPTX增强达到已声明支持边界。

保留原PPTX生产验收范围；AI全绿不能带过PPTX人工导入失败，PPTX无需外部转换软件。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [docs/development-plan/PPTX_IMPORT_ENHANCEMENT_PLAN.md](../../PPTX_IMPORT_ENHANCEMENT_PLAN.md)
- [src/renderer/project/pptxImport.ts](../../../../src/renderer/project/pptxImport.ts)
- [src/renderer/project/pptxImportTransaction.ts](../../../../src/renderer/project/pptxImportTransaction.ts)
- [src/main/pptResave.ts](../../../../src/main/pptResave.ts)
- [src/renderer/ui/productivity/PptxImportForm.tsx](../../../../src/renderer/ui/productivity/PptxImportForm.tsx)

## 允许写域与旧路径退出

正式PPT/PPTX导入、Workspace体验与证据；超出已有导入Owner的缺陷按对应锁修复。

## 执行步骤

1. 对既定真实样本逐类记录Native可编辑、静态保留与未支持；复用有效公式/图示/图表/媒体证据。
2. 实际修改文本/图形/公式/图表/共享层和媒体，再保存重开、Undo/Redo、Player/适用导出及导出后再导入。
3. 旧PPT验证本机转换软件可用/缺失、取消/错误和手动另存为；原生PPTX始终无需Office/LibreOffice。
4. 真实比较源与导入呈现，检查同步、文字边界与部分导入报告，不以对象计数代替质量。

## 验收与可信反例

- 支持范围可编辑且实际显示/播放正确；每类未支持项准确标页码/类型/原因，人工导入全过程可完成。
- 反例：截图后备掩盖普通对象失败、丢公式/图片而不报告、转换缺失阻断PPTX、取消后半写均不通过。

## 停止条件

不以“全PowerPoint保真”扩无限范围；当前受支持内容错误需修，已明确未支持复杂特性继续如实列边界。

## 聚焦验证

准备与证据复用统一遵循[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)。相关产物准备一次后直接选择受影响PPTX测试；下列E2E只运行已有名称以“S2 PPTX ”或“S3 PPTX ”开头的PPTX用例，不附带三CLI付费矩阵。新媒体/效果用例先随实现创建，再列入实际FILE与--grep，零匹配不得通过；旧用例不能冒充新支持已验收。

```text
npx --no-install vitest run tests/unit/pptxEquationImport.test.ts tests/unit/pptxDiagramImport.test.ts tests/unit/coursePptxExport.test.ts
npx --no-install playwright test tests/e2e/stabilizationCoreUsability.spec.ts --grep "S[23] PPTX "
```

真实渲染/交互/媒体、保存重开、导出→再导入必须执行；XML/数量/fixture不能替代。

## 回退与交接

交付真实样本映射、呈现与编辑证据、未支持清单给S4；不因AI工作流完成而豁免。
