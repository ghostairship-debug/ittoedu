# r18-098-image-edit-transaction：交付保留原图内容的确定性图片变换与资产替换事务

- Release: 1.8
- Dependencies: `r18-096-capability-workspace`, `r18-097-semantic-edit-replacement`
- Optional: 否
- Write locks: `authoring-slide`, `authoring-flow`, `authoring-spatial`, `store-kernel`, `generated-index`, `contracts-schema`
- Gaps: G02, G03

## 结果与现状

基于现有图像实际内容完成确定性改色、保留透明度的局部颜色替换、裁切/尺寸和资源替换，结果可撤销并完整保存运行导出。

G02红色小图改绿未生成候选；单纯shape fill、色块覆盖或让模型手写base64均不能完成图片编辑。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/renderer/project/assetManager.ts](../../../../src/renderer/project/assetManager.ts)
- [src/renderer/authoring/tools/mediaAssetTool.ts](../../../../src/renderer/authoring/tools/mediaAssetTool.ts)
- [src/renderer/authoring/tools/nativeAuthoringTool.ts](../../../../src/renderer/authoring/tools/nativeAuthoringTool.ts)
- [src/renderer/authoring/generation/prepareGenerationCandidate.ts](../../../../src/renderer/authoring/generation/prepareGenerationCandidate.ts)
- [tests/unit/assetTransactions.test.ts](../../../../tests/unit/assetTransactions.test.ts)

## 允许写域与旧路径退出

资产Owner中的确定性图像运算、正式窄输入Schema和媒体/替换工具、生成能力卡；strict输入先独立合同提交。无需新付费Provider或秘密。

## 执行步骤

1. 定义源资产引用、目标颜色/默认绿色、容差、可选区域/mask、alpha保留、裁切/尺寸与输出格式；读原始像素不以截图反复压缩。
2. 生成新资产并经097原子替换；仅所选实例改色，共用原图的其他实例保持，源资产保留至正式引用清理时机。
3. 把操作与能力卡开放给CLI/Builder，模型只输出正式意图；复杂语义生成式修图如依赖CLI额外工具，应清楚区分能力。
4. 验证1×1红图、含文字/透明背景的多色图、局部改色和裁切；非目标像素内容保留，修改可在真实视图确认。

## 验收与可信反例

- T02/T03得到实际绿色图片且文字/非目标区域/透明度符合要求；撤销重做、保存重开、Player/HTML/PPTX或对应导出均引用正确资产。
- 反例：坏图、超尺寸、空mask、资产写入失败、共享引用、Stop/stale、输出解码失败，当前事务零写且无孤立工程引用。

## 停止条件

目标局部范围无法确定时提出具体澄清；无生成式工具不能冒充语义修图已支持，但不阻断确定性颜色操作。

## 聚焦验证

在以下现有测试入口补本规格命名行为，不能用旧用例通过充当新能力证据。若确需新文件，先在实现diff中创建再同步入口。仅失败指向更广范围或版本门要求才扩大验证。

```text
npm run test:product -- tests/unit/assetTransactions.test.ts tests/unit/assetReferences.test.ts tests/unit/editorTransaction.test.ts
npm run test:product -- tests/unit/courseProjectRoundTrip.test.ts tests/unit/coursePptxExport.test.ts
```

真实UI比较T02/T03前后并检查alpha/文字/局部范围，导出后实际显示；像素断言用于算法保真，不能替代实际呈现。

## 回退与交接

交付操作合同、容差/默认色说明、资源事务与失败证据；103复用图像fixture和自然语言原话。
