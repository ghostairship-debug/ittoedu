# r18-095-authoring-observation：从当前结构草稿画面与运行状态生成一致只读观察

- Release: 1.8
- Dependencies: `r18-090-ai-task-contract`, `r18-089-flow-viewport-repair`
- Optional: 否
- Write locks: `authoring-slide`, `authoring-flow`, `authoring-spatial`, `published-slide`, `published-flow`, `published-spatial`, `published-dynamic`
- Gaps: G01, G09

## 结果与现状

AI观察来自当前内存文档、活动草稿、实际画面与运行结果；结构、图像和状态具有可核对版本，教师无需另发工程内已有图片。

观察scope表示默认提供的当前工程上下文，不表示CLI整体文件或工具权限。Agent可按原生授权取得更多资料，但磁盘旧文件不能替代当前未保存内存和活动草稿；正式编辑目标仍遵守用户意图和canonical target。

现有generationSnapshot主要是结构与资产元数据；dynamic admission有局部capture但尚未形成一般当前课件观察。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/renderer/authoring/generation/generationSnapshot.ts](../../../../src/renderer/authoring/generation/generationSnapshot.ts)
- [src/renderer/authoring/generation/generationCapabilities.ts](../../../../src/renderer/authoring/generation/generationCapabilities.ts)
- [src/renderer/project/assetManager.ts](../../../../src/renderer/project/assetManager.ts)
- [src/player/surfaces/publishedCapture.ts](../../../../src/player/surfaces/publishedCapture.ts)
- [src/renderer/ui/flow/useFlowTextAuthoringController.ts](../../../../src/renderer/ui/flow/useFlowTextAuthoringController.ts)
- [src/renderer/ui/CanvasPlainTextEditor.tsx](../../../../src/renderer/ui/CanvasPlainTextEditor.tsx)

## 允许写域与旧路径退出

各Surface正式观察consumer、已有capture Owner、活动草稿Owner的只读/准备接口以及generation快照组合；不在Chat截另一张假页面，不读保存文件替代内存。

## 执行步骤

1. 生成090 Observation：当前选择/位置/稳定目标、documentRevision、draftEpoch、viewEpoch及运行session/state身份。
2. 从既有草稿Owner读取讨论所需草稿；编辑准备按原Owner冻结/提交，不能绕开历史或把未提交DOM复制成新文档。
3. 捕获与结构版本对应的真实作者/试运行/预览画面及原始资产；渲染未就绪或中途变化丢弃旧组合并显示待同步。
4. 选区变化只更新关注上下文，已绑定任务目标保持；输出精简索引及不可变文件供096，删除旧仅元数据图片路径。

默认选区/当前页观察按任务需要展开，原图、材料、源码与技术说明分别引用和计量；不以完整性为名每轮重复发送整工程和全部资源。Observation文件的ID/版本/路径闭合保证这份输入可信，不能被adapter用作CLI全部可读文件白名单。此节点不新增材料解析平台或live Store接口。

## 验收与可信反例

- T01能判断当前图像；发送前未保存文字、活动编辑草稿和最新选区可被解释；每张图能追到其结构/视图/运行版本。
- 反例：快速切页、连打字、删除资产、缩放/滚动、Runtime帧变化及捕获中修改不能把旧画面标为最新或改绑任务。
- 先保存再修改未保存文字，CLI同时可读磁盘资料时仍以当前Observation解释画布；获取更多资料不能静默扩大工程写入目标。默认观察缩小不改变原生CLI的实际权限。

## 停止条件

无法取得某宿主的同源画面时明确未同步/观察不可用；不得猜Runtime私有状态或用静态封面冒充连续运行。

## 聚焦验证

按[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)为本次代码变化和所选用例准备必要产物一次，再执行以下直接入口；纯逻辑/Schema测试不因此重构建。现有用例只证明其实际覆盖的行为；新增行为在实施diff中补命名测试，并同步文件及 `-t` / `--grep` 选择。执行时确认目标测试实际被选中，0匹配不算通过，不用旧用例通过代签新能力。未变化证据继续复用，仅失败指向更广范围或版本门要求才扩大验证。

```text
npx --no-install vitest run tests/unit/editorTransaction.test.ts tests/unit/publishedCapture.test.ts tests/unit/flowViewportGeometry.test.ts
npx --no-install playwright test tests/e2e/stabilizationCoreUsability.spec.ts --grep "活动文字草稿：Slide、Spatial、Flow 不失焦保存并可重开|S3 Flow 所见即所得：空段、连续换行、选择与保存重开"
npx --no-install playwright test tests/e2e/stabilizationFlowAuthoring.spec.ts --grep "Wave C Flow authoring survives one real Editor and Player session"
```

三表面真实窗口验证结构/草稿/画面；至少30个本地变化测上下文提示p95≤500ms，报告capture阶段，不混入模型网络耗时。

## 回退与交接

交付Observation样本、资源读取路径、失效与渲染就绪规则及097/100可复用证据；回退单一观察consumer，不新增第二Project。
