# r18-099-dynamic-edit-verification：闭合Runtime与Component增量修改和按影响运行验证

- Release: 1.8
- Dependencies: `r18-096-capability-workspace`, `r18-097-semantic-edit-replacement`, `r18-100-task-feedback-loop`
- Optional: 否
- Write locks: `published-dynamic`, `published-slide`, `published-flow`, `published-spatial`, `store-kernel`, `contracts-schema`, `ai-session`, `generated-index`, `main-preload`
- Gaps: G03, G08, G09

## 结果与现状

“改成不断翻滚的立方体”“慢一点”能完成真实Runtime替换和连续修订；临时宿主验证画面、动作和错误并把结果回送同一CLI任务。

当前已有动态准入、连续观察及选区依赖创建；组件文件级patch已支持changedFiles/deleteFiles、shared/instance和精确基准，component.configure已区分外层属性、公开参数与完整准入。剩余缺口是观察仍提示完整shared revise、实例模式发现域遗漏，以及部分失败行为证据未完整送回。本轮按[AI编辑最短路径统一方案](../../../../AI编辑最短路径产品决策报告.md)修这些直接矛盾并验证实际交互，不重建增量或分级体系；静态封面、编译或smoke成功不能证明具体教学交互正确。

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

generationSnapshot.ts的实例/共享提示与095观察变更由一个实际writer汇总；096的发现域消费正式工具mode语义，不能另写支持表。动态失败字段沿090/100公共合同接回，由公共Owner统一修改；本节点负责实际取得的diagnostics/behaviorEvidence及对应consumer，重叠worker/合同/控制器改动顺序集成。

## 执行步骤

1. 按当前用例选取能证明目标的有限公开宿主动作、时间点采样和公开状态检查，复用现有挂载、更新、暂停/恢复、捕获与销毁接口；未知动作失败，不解释任意步骤或断言语言。执行前明确动作数、采样点及次数，累计等待计入100既有任务预算，单次执行复用现有宿主/准入timeout；修复或进入新阶段不刷新累计预算，耗尽明确结束，不另硬编码一套秒数。
2. 首次Generated Component/Runtime保留完整正式准入，再观察当前目标所需连续帧、生命周期、资源和错误；目标效果验证与安全/可执行准入分别出结果。Native及已准入组件的公开props修改无需独立验证计划，仍检查参数、事务及受影响的实际呈现/互动。
3. 将实际结果、正式diagnostics和已取得的behaviorEvidence经100回传，让同一CLI根据具体失败目标、触发步骤、帧/状态及当前基准修订；未取得的证据明确为空。修订通过后沿097正式候选事务提交；现有Runtime/Component优先使用原位source/package/configure工具，仅任务明确需要载体转换时使用selection.replace，不把源码修订统一转成替换。
4. 再次“慢一点”读取当前包与运行结果，修改正确实例/共享范围；停止、卸载、切模式和重开不泄漏或错误重播。

5. 公开参数足够时只经097修改参数；确需源码变化时读取相关源码。组件优先复用文件级patch，精确绑定package/baseVersion/baseContentIdentity，显式声明删除，由宿主补齐未改文件后进入原包修订与资源事务。观察按当前任务提供实例或共享目标，删除强制完整shared revise的旧指令；只改当前实例不默认改全包。小模块或大范围变化仍允许完整文件，不把源码仅留在暂存区。
6. 外层几何检查事务与呈现；公开参数检查合法性及受影响行为；新代码和影响动态运行的资源变化承担相应准入与实际效果检查。先合并同对象兼容操作，再按实测考虑最终态验证合并；任何提前执行的新代码必须已准入，依赖实际测量的步骤不能省略。静态/资源证据仅在实际代码、资源、配置、合同/规则和宿主依赖匹配时复用，旧参数下的行为结论不能代替当前成功。无需为每次Native或公开props修改另生成验证计划，也不因一般资产变化统一触发完整动态准入。

多步骤教育应用沿现有Component V4公开常用文案/素材/参数；保存重开可继续改源码，实例与共享包影响明确。用一个真实组合验证当前支持的events/courseState：实验输出更新图表或反馈，销毁/重播不重复订阅；不新增事件总线、市场或通用课程DSL。所需正式工具/宿主consumer若有当前缺口须在对应Owner补齐，不能留给后续UI。

本节点交付当前动态替换、props/源码分流和按影响验证，优先检查最容易失败的连续机制，再检查其他受影响内容。记录源码输入/输出、模型生成、准入、实际观察、返工及总耗时，关闭完整包重复往返和无关重测。Runtime/函数级或精确文本补丁、带基准的增量观察及资源缓存，仅在分段证据表明大量未变输出、重复检查或传输构成瓶颈时深化，不阻塞已有patch、提示和失败反馈修复。代表动态分钟级与标准整课完整质量/速度由2.0的020/040验收，不新增通用QA或性能平台，不以跳过必要视觉/互动检查提速。

## 验收与可信反例

- 至少两个内容单元通过现有事件/课程状态实际联动，保存重开、Player/HTML仍正确；实例销毁/重播无重复订阅和残留回调，不能只验证静态配置。
- T05是实际随时间翻滚的立方体；T06减慢后连续机制保留，撤销/保存重开/Player/HTML均一致，修订有真实结果观察。
- 反例：只有封面、运行异常、素材缺失、无限循环/资源超限、错误共享包范围、取消/过期准入均不冒充成功，不改教师正在授课的live session。
- 改一份源码时未改文件内容保留，错误源码基线拒绝，删除文件/资源引用一致；修改参数不重写包，不复用不同参数的行为结论。实例/共享修改、保存重开后再次改源码均走唯一正式路径。
- snapshot→同源能力卡→instance patch的直接路径不再强制完整shared revise；明确共享修改才影响所有相关实例。运行失败的目标、触发步骤及已有帧/状态真实送回同一任务，不以空证据或通用message替代已取得信息。
- 挂载、更新、resize、暂停/恢复与销毁的smoke证据和答题/实验语义分别验收；指定交互故障必须真实触发并修复，不能用无异常或单张截图证明答案、重试或重置正确。
- 原生工具可在授权范围准备源码，但候选root外文件不得被宿主隐式摄取；运行组件不能继承CLI终端/网络授权。已有编译/准入证据仅在相关实现和条件匹配时复用，文档修改或审查者变化不触发同义重测。

## 停止条件

既有宿主公开动作不能证明当前用例目标时，在对应Owner补受批准的窄动作及真实consumer；不要为未知未来用例建设通用验证DSL。任务累计预算耗尽或取消时有界停止；不得用任意eval/script、截图静态后备或关闭准入过门。

## 聚焦验证

按[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)为本次代码变化和所选用例准备必要产物一次，再执行以下直接入口；纯逻辑/Schema测试不因此重构建。现有用例只证明其实际覆盖的行为；新增行为在实施diff中补命名测试，并同步文件及 `-t` / `--grep` 选择。执行时确认目标测试实际被选中，0匹配不算通过，不用旧用例通过代签新能力。未变化证据继续复用，仅失败指向更广范围或版本门要求才扩大验证。

```text
npx --no-install vitest run tests/unit/dynamicIncrementalAuthoring.test.ts -t "merges unchanged files, explicitly deletes, revises all shared instances and undoes resources once|forks only the selected instance and persists the changed source with one reversible resource step|moves an instance without running code or changing package bytes|validates legal public props and checks only affected behavior without full admission or package rewriting"
npx --no-install playwright test tests/e2e/stabilizationCoreUsability.spec.ts --grep "S3 独立动态准入：正常候选、同步死循环终止与编辑保存响应|S3 独立动态工具：组件与 Runtime 的三 Surface 准入回归|S3 共享组件源码：两文件草稿、嵌套正文目标、真实准入与一次资源历史"
```

以上单测已存在且mock动态准入，只证明文件增量、实例/共享事务和检查分流，不能证明新提示接线或真实互动。实施时补snapshot→卡→instance patch、动态失败证据全链和指定交互故障的命名用例，再登记实际过滤条件。用一种主力CLI取得真实临时与最终宿主的至少三个时间点/连续观察，证明动画与变慢，再验证暂停/恢复/销毁；静态截图单张不够。按变化复用增量基线/未改文件/参数与代码分流的有效证据；其他CLI完整动态任务在103汇合，保留失败及分阶段耗时。

## 回退与交接

交付当前用例的有限动作/采样与结果样例、真实多帧证据、累计预算消耗和100反馈输入；失败保留先前已提交阶段并明确部分完成。
