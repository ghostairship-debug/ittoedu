# r18-099-dynamic-edit-verification：闭合Runtime与Component增量修改和按影响运行验证

- Release: 1.8
- Dependencies: `r18-096-capability-workspace`, `r18-097-semantic-edit-replacement`, `r18-100-task-feedback-loop`
- Optional: 否
- Write locks: `published-dynamic`, `published-slide`, `published-flow`, `published-spatial`, `store-kernel`, `contracts-schema`, `ai-session`, `generated-index`, `main-preload`
- Gaps: G03, G08, G09

## 结果与现状

“改成不断翻滚的立方体”“慢一点”能完成真实Runtime替换和连续修订；临时宿主验证画面、动作和错误并把结果回送同一CLI任务。

已有动态准入/capture保证部分可运行边界，但自然语言替换缺create scope，静态封面或编译通过不能证明连续效果。当前组件修改还要求完整回传未改文件，component.configure对参数/图层变更统一进入动态准入；本节点同时修正源码传递与验证粒度，不能只压缩输入提示词。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/renderer/authoring/tools/dynamicCandidateAdmission.ts](../../../../src/renderer/authoring/tools/dynamicCandidateAdmission.ts)
- [src/renderer/authoring/generation/admissionWorker.ts](../../../../src/renderer/authoring/generation/admissionWorker.ts)
- [src/shared/dynamicAdmissionContract.ts](../../../../src/shared/dynamicAdmissionContract.ts)
- [src/renderer/authoring/tools/runtimeInsertTool.ts](../../../../src/renderer/authoring/tools/runtimeInsertTool.ts)
- [src/renderer/authoring/tools/runtimeSourceTool.ts](../../../../src/renderer/authoring/tools/runtimeSourceTool.ts)
- [src/renderer/authoring/tools/componentConfigureTool.ts](../../../../src/renderer/authoring/tools/componentConfigureTool.ts)
- [src/renderer/authoring/tools/componentPackageTool.ts](../../../../src/renderer/authoring/tools/componentPackageTool.ts)
- [src/renderer/authoring/generation/generationSnapshot.ts](../../../../src/renderer/authoring/generation/generationSnapshot.ts)
- [src/player/surfaces/publishedCapture.ts](../../../../src/player/surfaces/publishedCapture.ts)

## 允许写域与旧路径退出

既有动态准入/临时宿主、当前用例所需的有限宿主动作/采样及结果、Runtime/Component实际consumer与097替换接线。必要字段沿既有strict合同窄扩展，不建设跨组件通用验证计划解释器、断言DSL、任意脚本RPC或未批准宿主权限。

原生CLI仍可按用户授权使用文件、终端、网络、工具、Skills和子任务准备或检查源码；此能力不自动授予运行中的Component/Runtime。宿主候选摄取保持current candidate root闭合及唯一文档资源事务，CLI生成文件不等于已修改工程。

## 执行步骤

1. 按当前用例选取能证明目标的有限公开宿主动作、时间点采样和公开状态检查，复用现有挂载、更新、暂停/恢复、捕获与销毁接口；未知动作失败，不解释任意步骤或断言语言。执行前明确动作数、采样点及次数，累计等待计入100既有任务预算，单次执行复用现有宿主/准入timeout；修复或进入新阶段不刷新累计预算，耗尽明确结束，不另硬编码一套秒数。
2. 首次Generated Component/Runtime保留完整正式准入，再观察当前目标所需连续帧、生命周期、资源和错误；目标效果验证与安全/可执行准入分别出结果。Native及已准入组件的公开props修改无需独立验证计划，仍检查参数、事务及受影响的实际呈现/互动。
3. 将结果经100回传，让同一CLI根据具体诊断修订；通过后经097替换，默认保留选区几何和可迁移引用。
4. 再次“慢一点”读取当前包与运行结果，修改正确实例/共享范围；停止、卸载、切模式和重开不泄漏或错误重播。

5. 公开参数足够时只经097修改参数；新增行为才读取相关源码并返回实际变化。增量严格绑定包身份及精确源码基线，删除文件显式声明；宿主用正式现有包补齐未改文件，形成完整候选后进入原包修订与资源事务。所选实例另存与共享包修改明确区分，不把源码仅留在暂存区。
6. 按纯图层几何、参数、代码、共享接口变化决定检查范围，后续修订只执行受影响检查。匹配实际代码/资源/配置/宿主依赖的编译及准入证据才可复用；参数合法性和受影响运行行为仍检查。首次生成完整准入、改变所影响的各门与真实效果验证全部保留，不能以关闭动态准入提速；无需为每次Native或公开props修改先生成另一份验证计划。

多步骤教育应用沿现有Component V4公开常用文案/素材/参数；保存重开可继续改源码，实例与共享包影响明确。用一个真实组合验证当前支持的events/courseState：实验输出更新图表或反馈，销毁/重播不重复订阅；不新增事件总线、市场或通用课程DSL。所需正式工具/宿主consumer若有当前缺口须在对应Owner补齐，不能留给后续UI。

本节点交付当前动态替换、props/源码分流和按影响验证，优先检查最容易失败的连续机制，再检查其他受影响内容。记录源码输入/输出、模型生成、准入、实际观察、返工及总耗时，关闭完整包重复往返和无关重测；代表动态分钟级与标准整课完整质量/速度由2.0的020/040验收，不新增通用QA或性能平台，不以跳过必要视觉/互动检查提速。

## 验收与可信反例

- 至少两个内容单元通过现有事件/课程状态实际联动，保存重开、Player/HTML仍正确；实例销毁/重播无重复订阅和残留回调，不能只验证静态配置。
- T05是实际随时间翻滚的立方体；T06减慢后连续机制保留，撤销/保存重开/Player/HTML均一致，修订有真实结果观察。
- 反例：只有封面、运行异常、素材缺失、无限循环/资源超限、错误共享包范围、取消/过期准入均不冒充成功，不改教师正在授课的live session。
- 改一份源码时未改文件内容保留，错误源码基线拒绝，删除文件/资源引用一致；修改参数不重写包，不复用不同参数的行为结论。实例/共享修改、保存重开后再次改源码均走唯一正式路径。
- 原生工具可在授权范围准备源码，但候选root外文件不得被宿主隐式摄取；运行组件不能继承CLI终端/网络授权。已有编译/准入证据仅在相关实现和条件匹配时复用，文档修改或审查者变化不触发同义重测。

## 停止条件

既有宿主公开动作不能证明当前用例目标时，在对应Owner补受批准的窄动作及真实consumer；不要为未知未来用例建设通用验证DSL。任务累计预算耗尽或取消时有界停止；不得用任意eval/script、截图静态后备或关闭准入过门。

## 聚焦验证

按[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)为本次代码变化和所选用例准备必要产物一次，再执行以下直接入口；纯逻辑/Schema测试不因此重构建。现有用例只证明其实际覆盖的行为；新增行为在实施diff中补命名测试，并同步文件及 `-t` / `--grep` 选择。执行时确认目标测试实际被选中，0匹配不算通过，不用旧用例通过代签新能力。未变化证据继续复用，仅失败指向更广范围或版本门要求才扩大验证。

```text
npx --no-install vitest run tests/unit/editorTransaction.test.ts tests/unit/publishedCapture.test.ts
npx --no-install playwright test tests/e2e/stabilizationCoreUsability.spec.ts --grep "S3 独立动态准入：正常候选、同步死循环终止与编辑保存响应|S3 独立动态工具：组件与 Runtime 的三 Surface 准入回归|S3 共享组件源码：两文件草稿、嵌套正文目标、真实准入与一次资源历史"
```

用一种主力CLI取得真实临时与最终宿主的至少三个时间点/连续观察，证明动画与变慢，再验证暂停/恢复/销毁；静态截图单张不够。目标单测补增量基线/未改文件/参数与代码检查分流；其他CLI完整动态任务在103汇合，保留失败及分阶段耗时。

## 回退与交接

交付当前用例的有限动作/采样与结果样例、真实多帧证据、累计预算消耗和100反馈输入；失败保留先前已提交阶段并明确部分完成。
