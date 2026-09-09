# r19-051-pptx-media-effects：增强内嵌媒体与可表达的简单演示效果

- Release: 1.9
- Dependencies: `r18-051-pptx-editable-diagrams`, `r18-060-release`
- Optional: 否
- Write locks: `app-save-recovery`, `store-slide`, `authoring-interaction`, `published-slide`, `export-pptx`

## 结果与现状

PPTX受支持内嵌音视频可编辑引用并播放，当前声明式交互能准确表达的简单显隐/入场映射成功，未支持效果明确报告。

PPTX是独立人工交付线，依赖1.8/S3后实施；不因新增AI工作包被删除或降为可选。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [docs/development-plan/PPTX_IMPORT_ENHANCEMENT_PLAN.md](../../PPTX_IMPORT_ENHANCEMENT_PLAN.md)
- [src/renderer/project/pptxImport.ts](../../../../src/renderer/project/pptxImport.ts)
- [src/renderer/project/pptxPackage.ts](../../../../src/renderer/project/pptxPackage.ts)
- [src/renderer/project/pptxImportTransaction.ts](../../../../src/renderer/project/pptxImportTransaction.ts)
- [src/renderer/authoring/tools/mediaAssetTool.ts](../../../../src/renderer/authoring/tools/mediaAssetTool.ts)

## 允许写域与旧路径退出

正式PPTX读取/事务、Slide媒体与声明式交互consumer及导出；不执行OLE、自动下载外链或新建PowerPoint时间线引擎。

## 执行步骤

1. 从真实PPTX集枚举内嵌媒体、编码和简单效果，区分可解码与当前交互语义可表达范围。
2. 内嵌媒体导入既有资产闭包/播放；外链仅报告不自动下载，坏媒体明确页码/原因。
3. 仅准确映射既有显隐/入场触发，复杂时间线/转场按正式部分导入边界静态保留或报告，不能声称动画等价。
4. 连续播放/导航/暂停恢复、保存重开和离线HTML核对；静态导出提示与真实产物一致。

## 验收与可信反例

- 支持范围媒体实际播放且可人工编辑；简单效果顺序/触发符合既有正式语义；离线HTML素材闭包正确。
- 反例：外链、未知编码、缺媒体、复杂触发依赖、导入取消/失败不能半写工程、联网补资源或假称完整兼容。

## 停止条件

发现当前播放器无法解码则明确未支持；新增格式引擎/复杂时间线需要单独产品范围决定，不借本节点扩张。

## 聚焦验证

按[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)完成一次适用准备后，直接运行以下原有命名文件与现有S2/S3 PPTX用例组，复用未变保全证据；不执行整份stabilizationCoreUsability中的真实CLI矩阵。旧用例只证明已有行为，新媒体/效果实际路径须随实现补充命名用例，再用精确grep选中，零匹配不算通过，不能用旧用例通过代替新能力证据。仅失败指向更广范围或版本门要求才扩大验证。

```text
npx --no-install vitest run tests/unit/courseProjectRoundTrip.test.ts tests/unit/assetReferences.test.ts tests/unit/coursePptxExport.test.ts
npx --no-install playwright test tests/e2e/stabilizationCoreUsability.spec.ts --grep 'S[23] PPTX '
```

使用真实内嵌音视频/简单效果PPTX，实际播放、暂停/跨页和离线HTML；导入对象计数或XML通过不等于播放通过。

## 回退与交接

交付真实样本对象→工程→播放/导出的映射与支持边界，供2.0 PPTX验收复用。
