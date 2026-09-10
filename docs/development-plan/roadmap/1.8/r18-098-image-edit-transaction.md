# r18-098-image-edit-transaction：交付保留原图内容的确定性图片变换与资产替换事务

- Release: 1.8
- Dependencies: `r18-096-capability-workspace`, `r18-097-semantic-edit-replacement`
- Optional: 否
- Write locks: `authoring-slide`, `authoring-flow`, `authoring-spatial`, `store-kernel`, `generated-index`, `contracts-schema`
- Gaps: G02, G03

## 结果与现状

基于现有图像实际内容完成确定性改色、保留透明度的局部颜色替换、裁切/尺寸和资源替换，结果可撤销并完整保存运行导出。

确定性图片变换、派生资产和单实例资源事务已有实现。2026-09-09真实事故的原图来自基线夹具PNG_BYTES，其IDAT CRC与zlib校验均损坏；换色失败后以绿色Native text替换Native image，得到错误结果。本轮优先修正有效正例夹具、保留原坏字节负例，并关闭诊断丢失与错误语义恢复。不能以shape fill、色块覆盖、模型手写base64或关闭PNG校验冒充换色。

当前裁决与事故证据见[统一最短路径方案](../../../../AI编辑最短路径产品决策报告.md)第3.2、4.2、8节。已有像素算法与copy-on-write继续复用，节点不重新承担已完成的工具建设。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/renderer/project/assetManager.ts](../../../../src/renderer/project/assetManager.ts)
- [src/renderer/project/imageTransform.ts](../../../../src/renderer/project/imageTransform.ts)
- [src/shared/imageTransformContract.ts](../../../../src/shared/imageTransformContract.ts)
- [src/renderer/authoring/tools/imageTransformTool.ts](../../../../src/renderer/authoring/tools/imageTransformTool.ts)
- [src/renderer/authoring/tools/mediaAssetTool.ts](../../../../src/renderer/authoring/tools/mediaAssetTool.ts)
- [src/renderer/authoring/tools/nativeAuthoringTool.ts](../../../../src/renderer/authoring/tools/nativeAuthoringTool.ts)
- [src/renderer/authoring/generation/prepareGenerationCandidate.ts](../../../../src/renderer/authoring/generation/prepareGenerationCandidate.ts)
- [scripts/build-architecture-baseline-fixtures.ts](../../../../scripts/build-architecture-baseline-fixtures.ts)
- [tests/unit/imageTransform.test.ts](../../../../tests/unit/imageTransform.test.ts)
- [tests/unit/imageTransformTool.test.ts](../../../../tests/unit/imageTransformTool.test.ts)

## 允许写域与旧路径退出

资产Owner中的确定性图像运算、既有窄输入Schema、图片工具与能力卡，以及实际受影响的夹具生成器/目标测试；需要调整strict合同才独立合同提交。跨Generation的失败传输与任务保持条件交由097/100的唯一Owner接线，不在资产工具中另建任务或自然语言授权分类器。无需新付费Provider或秘密。

## 执行步骤

1. 在夹具生成Owner修复有效正例，保留原事故字节为独立负例；重新准备实际受影响的夹具制品一次。既有用户文件与原事故记录不改写为成功样本。关键块与压缩流校验保持，不能预设辅助块容错或Canvas重编码能无损修复本次坏输入。
2. 复用现有源资产引用、源色/目标色、容差、区域/mask、alpha及输出合同。使用原始像素，保留PNG透明像素下隐藏RGB；换色保留尺寸与未选区域，裁剪/缩放按各自合同改变区域或尺寸，不能混用不变量。
3. 复用既有copy-on-write：生成新资产，经Native content或Flow media的局部引用更新与一个资源事务提交；保留对象身份、显示属性、未请求字段、未选共享实例和源资产。此路径不是selection.replace，不用语义对象替换模拟图片换色。
4. 把明确操作、实际支持范围和可调用输入交给CLI/Builder。原图附件失败与变换解码失败分开呈现；工具错误保留阶段、步骤、资产、错误码/字段路径、当前版本、是否提交及同操作真实可用的恢复信息，沿prepare/controller/host result回传，不能只剩泛化字符串。
5. 与097/100衔接初次候选和修正轮的目标/影响检查：只改颜色时保持Native image或Flow media image语义、可见形状、alpha和未请求内容。图片与文本同属Native，单查carrier或外框不足。没有新意图或既有授权依据时，恢复不得变成文字/色块覆盖；明确要求对象替换时仍可使用正式替换能力，不建立全局禁换载体规则。
6. 验证有效1×1红图、含文字/透明背景的多色图、局部改色和裁切/缩放，再验证原坏字节的准确失败与无替代提交。生成式修图不属于当前确定性工具，发现目录应如实说明实际可用能力，不能用换色或裁切冒充语义修图。

## 验收与可信反例

- 有效正例中的T02/T03得到实际绿色图片，文字、非目标区域、alpha及隐藏RGB符合合同；可见形状和未请求显示属性保持。撤销重做、保存重开、Player/HTML/PPTX或对应导出引用正确资产，未选共享实例与源资产保持。
- 原事故损坏PNG作为负例得到可定位错误、当前事务零写，无绿色文本或遮盖替代。有效正例与原坏例不能直接相减计算提速率，原事故不重新包装为成功基线。
- 反例：坏图、超尺寸、空mask、资产写入失败、Stop/stale、输出解码失败，当前事务零写且无孤立工程引用。共享引用是成功路径的保全条件，不应因其他实例共用原图而拒绝合法单实例修改。
- 初次候选及失败修正均不能把未请求的对象类型、显示方式或区域变化包装为成功；已明确授权的对象替换仍可完成。宿主只检查正式可表达的约束，不声称机器证明所有视觉语义。

## 停止条件

目标局部范围无法确定时提出具体澄清；无生成式工具不能冒充语义修图已支持，但不阻断确定性颜色操作。

## 聚焦验证

按[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)为本次代码变化和所选用例准备必要产物一次，再执行以下直接入口；纯逻辑/Schema测试不因此重构建。现有用例只证明其实际覆盖的行为；新增行为在实施diff中补命名测试，并同步文件及 `-t` / `--grep` 选择。执行时确认目标测试实际被选中，0匹配不算通过，不用旧用例通过代签新能力。未变化证据继续复用，仅失败指向更广范围或版本门要求才扩大验证。

```text
npx --no-install vitest run tests/unit/imageTransform.test.ts -t "changes a real 1×1 PNG|preserves text-like black/white detail|keeps real text glyphs|rejects malformed PNG"
npx --no-install vitest run tests/unit/imageTransformTool.test.ts -t "recolors one|leaves document and resources unchanged"
```

上述现有用例验证像素保全、事务和直接失败；原事故坏字节、正例生成器修复和跨轮错误恢复需在实施diff新增准确命名用例并同步选择，不借旧测试代签。只有裁剪/缩放等对应实现变化时才增加其直接用例；相关代码/输入未变的证据继续复用。

真实UI使用有效正例比较T02/T03前后，检查可见形状、alpha、文字与局部范围及受影响导出；负例检查准确失败且无替代。像素断言不能替代实际呈现，不重跑九分半坏任务以建立速度基线。

## 回退与交接

交付有效正例、保留原坏字节的负例、实际诊断与防错误恢复证据，复用既有操作合同、容差/默认色和资源事务；103沿原自然语言任务补受影响验证，区分正确结果速度与失败路径收敛。
