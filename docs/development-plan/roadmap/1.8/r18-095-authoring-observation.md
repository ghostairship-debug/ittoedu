# r18-095-authoring-observation：从当前结构草稿画面与运行状态生成一致只读观察

- Release: 1.8
- Dependencies: `r18-090-ai-task-contract`, `r18-089-flow-viewport-repair`
- Optional: 否
- Write locks: `authoring-slide`, `authoring-flow`, `authoring-spatial`, `published-slide`, `published-flow`, `published-spatial`, `published-dynamic`
- Gaps: G01, G09

## 结果与现状

AI观察来自当前内存文档、活动草稿、实际画面与运行结果；结构、图像和状态具有可核对版本，教师无需另发工程内已有图片。

观察scope表示默认提供的当前工程上下文，不表示CLI整体文件或工具权限。Agent可按原生授权取得更多资料，但磁盘旧文件不能替代当前未保存内存和活动草稿；正式编辑目标仍遵守用户意图和canonical target。

当前已具备版本绑定的真实画面、结构、草稿和运行观察。剩余缺口是page默认范围内选择相关性未参与信息优先级，以及资产诊断、组件实例/共享源码提示与实际操作合同尚未完全一致；不重建观察系统。本轮按[AI编辑最短路径统一方案](../../../../AI编辑最短路径产品决策报告.md)修正这些直接缺口，既有有效观察证据继续复用。

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

generationSnapshot.ts的焦点、资产诊断和组件源码提示由同一实际writer汇总；095提供当前观察事实，099确定实例/共享编辑语义，096消费同源能力卡。共同Observation合同由090 Owner维护，跨叶子的共享文件顺序集成，不复制快照或另设工程状态。

## 执行步骤

1. 生成090 Observation：当前选择/位置/稳定目标、documentRevision、draftEpoch、viewEpoch及运行session/state身份。
2. 从既有草稿Owner读取讨论所需草稿；编辑准备按原Owner冻结/提交，不能绕开历史或把未提交DOM复制成新文档。
3. 捕获与结构版本对应的真实作者/试运行/预览画面及原始资产；渲染未就绪或中途变化丢弃旧组合并显示待同步。
4. 保留本次授权范围和冻结目标，以当前选中对象优先组织现值、必要邻接关系、直接依赖和真实资产诊断；输出精简摘要及不可变读取入口供096。选区变化只更新关注上下文，不能改绑已开始任务。附件解码失败、变换预检失败、格式不支持和尚未检测分别呈现，不把一个路径的失败推断为全部图片能力不可用。

默认选区/当前页观察按任务需要展开：精确修改优先选中目标，整页重排仍提供全页关系，跨页任务保留各页摘要和公共约定，源码修改提供相关状态与依赖。原图、材料、源码与技术说明分别引用和计量；不以完整性为名每轮重复发送整工程和全部资源。Observation文件的ID/版本/路径闭合保证这份输入可信，不能被adapter用作CLI全部可读文件白名单。带基准的后续增量观察仅在必要续轮的重复传输构成瓶颈时深化，恢复、换模型或丢基准必须重建紧凑完整观察；此节点不新增材料解析平台或live Store接口。

## 验收与可信反例

- T01能判断当前图像；发送前未保存文字、活动编辑草稿和最新选区可被解释；每张图能追到其结构/视图/运行版本。
- 反例：快速切页、连打字、删除资产、缩放/滚动、Runtime帧变化及捕获中修改不能把旧画面标为最新或改绑任务。
- 先保存再修改未保存文字，CLI同时可读磁盘资料时仍以当前Observation解释画布；获取更多资料不能静默扩大工程写入目标。默认观察缩小不改变原生CLI的实际权限。
- 当前页文字排列在图片之前、但选中图片时，首轮仍取得该图片的现值、资产诊断和必要关系；整页任务不得因选择聚焦漏掉必要对象。附件/变换各自状态准确，未知不冒充可用或不可用。

## 停止条件

无法取得某宿主的同源画面时明确未同步/观察不可用；不得猜Runtime私有状态或用静态封面冒充连续运行。

## 聚焦验证

按[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)为本次代码变化和所选用例准备必要产物一次，再执行以下直接入口；纯逻辑/Schema测试不因此重构建。现有用例只证明其实际覆盖的行为；新增行为在实施diff中补命名测试，并同步文件及 `-t` / `--grep` 选择。执行时确认目标测试实际被选中，0匹配不算通过，不用旧用例通过代签新能力。未变化证据继续复用，仅失败指向更广范围或版本门要求才扩大验证。

```text
npx --no-install vitest run tests/unit/generationSnapshotCanvas.test.ts -t "keeps current dimensions in each new snapshot without aliasing the live Surface or prior snapshot"
npx --no-install playwright test tests/e2e/stabilizationCoreUsability.spec.ts --grep "活动文字草稿：Slide、Spatial、Flow 不失焦保存并可重开|S3 Flow 所见即所得：空段、连续换行、选择与保存重开"
npx --no-install playwright test tests/e2e/stabilizationFlowAuthoring.spec.ts --grep "Wave C Flow authoring survives one real Editor and Player session"
```

以上为已有基础入口，只按受影响范围选择；画布尺寸用例不证明新增选择优先或资产诊断。实施时在观察/快照目标测试中补混合页选中图片、整页关系保留和附件/变换状态分离的命名用例，再登记实际过滤条件。三表面真实窗口验证结构/草稿/画面；至少30个本地变化测上下文提示p95≤500ms，报告capture阶段，不混入模型网络耗时。

## 回退与交接

交付Observation样本、资源读取路径、失效与渲染就绪规则及097/100可复用证据；回退单一观察consumer，不新增第二Project。
