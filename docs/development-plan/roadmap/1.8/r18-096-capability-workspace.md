# r18-096-capability-workspace：交付助手与Builder共用的精简发现查询和按需资源读取

- Release: 1.8
- Dependencies: `r18-090-ai-task-contract`
- Optional: 否
- Write locks: `generated-index`, `ai-session`, `cli-adapters`
- Gaps: G07, G12

## 结果与现状

同一正式能力源生成精简发现入口、查询与完整能力卡，应用CLI和外部Builder都能按当前任务展开相关能力及资源。

按需输入是课件生产效率优化，不裁剪完整原生CLI。内置课件指引附加专业方法与编辑器连接，保留用户已有Skills、工具连接及子任务；不以固定短提示集合替代完整技能知识和可按需读取的质量参考。

当前已有同源查询、完整能力卡和5,200字节预展开预算；历史约127KB不是当前请求基线。剩余缺口是遍历顺序挤走必要卡、help不可用、长尾发现未一次提供调用所需信息，以及component.package实例模式发现域漏报。本轮按[AI编辑最短路径统一方案](../../../../AI编辑最短路径产品决策报告.md)修这些直接缺口，不重建发现体系。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [scripts/generate-ai-capabilities.ts](../../../../scripts/generate-ai-capabilities.ts)
- [artifacts/ai-capabilities/index.json](../../../../artifacts/ai-capabilities/index.json)
- [src/renderer/authoring/tools/authoringToolFacade.ts](../../../../src/renderer/authoring/tools/authoringToolFacade.ts)
- [src/renderer/authoring/generation/generationCapabilities.ts](../../../../src/renderer/authoring/generation/generationCapabilities.ts)
- [src/main/localAgent/profile.ts](../../../../src/main/localAgent/profile.ts)
- [src/main/localAgent/harness.ts](../../../../src/main/localAgent/harness.ts)
- [src/shared/courseAgentSkills.ts](../../../../src/shared/courseAgentSkills.ts)
- [scripts/courseware-builder-v2-host.ts](../../../../scripts/courseware-builder-v2-host.ts)
- [src/renderer/course/coursewareBuilderV2.ts](../../../../src/renderer/course/coursewareBuilderV2.ts)

## 允许写域与旧路径退出

唯一能力生成器、派生发现数据/本地查询消费层、CLI profile/请求中的课件指引与不可变资源workspace；正式工具Owner保持定义源。外部Build Skill具体迁移归104，完整内置教学/呈现/构建工作流归1.9的044和2.0的021，不在本节点另建Skill执行引擎。

能力数据生成、查询与精简默认输入可在090合同稳定后独立交付，与095观察的非重叠修订并行。共享harness、合同和请求组装保持单writer；协调者持有共同写锁，只委派实际文件不重叠的叶子工作，不复制Owner或以隔离工作区绕开同文件冲突。095完整观察与100主力接线已存在，本轮按差异更新共同consumer，三CLI最终证据仍由103汇合。

authoringToolFacade.ts的模式适用域与工具定义变更由同一实际writer合并；生成器及派生数据由唯一生成Owner更新。097短传输所需的卡片变化消费090稳定的合同视图，不在本节点定义另一候选协议；与099共享的实例/共享语义、与104共享的安装内容顺序集成。

## 执行步骤

1. 从正式工具/Schema/支持矩阵生成能力ID、operation/mode适用Surface/carrier/owner/对象域、输入分支、必要依赖及示例。实例和共享模式分别呈现目标条件与影响范围；component.package的实例模式不得因工具级global标记而在实际支持的scene/Flow正文等域消失。复用describeAuthoringTools(names)等窄描述接口，保留index.json既有consumer兼容，不手写第二份参数或支持真相。
2. 查询支持关键词/任务类型/Surface/carrier及明确ID/operation/mode，一次定向查询取得完整调用分支、默认值与限制、目标/资源入口、一个正确示例及主要错误恢复信息。无参数给精简发现入口和帮助指引，--help提供正确用法，未知参数明确失败。CLI原生文件工具与Builder消费同一语义版本和模式适用域，不将目录命中当成已取得完整调用信息，不建live RPC。
3. 首轮按选择、操作适用性、直接依赖和任务范围提供必要完整卡与真实目标，长尾保留精简查询入口；同能力去重，不以对象遍历顺序或截断关键Schema满足字节目标。先消费090已有真实输入，不把完整095观察设为数据/查询前置，也不填虚假观察字段。材料/源码包/动态协议按任务闭包展开，资源和技术说明分开计量；095完整观察由100在同一请求Owner接线。
4. 保持版本变化和scope变化的缓存失效，修订后仍验证离线发现与未知能力明确失败；已退出的profile整套Skills/动态catalog内联路径不得回归，不为新增模式重新发送全量定义。
5. profile、harness与内置课件指引不得将“只根据快照”“只能读写candidate/观察文件”等变为全局能力限制。保留工程候选格式、用户任务范围、当前状态优先和canonical提交要求；Agent可在原生授权下使用文件、终端、网络、工具连接、Skills和子任务取得更多资料。

已明确选区的标题/样式/位置、图片变换或公开组件参数修改，直接附带正式定义生成的相关完整小能力卡，成功路径不额外串行搜索多轮。必要卡优先于无关遍历项，但不把某对象类型的所有工具都设为无条件热卡；预算不足保留完整调用信息并说明展开方式。原图、材料、源码与技术说明分别读取和计量；参数足够时不展开整包源码。共享数据、查询与精简默认输入仅依赖090；不得重新以095完整观察或三adapter完整任务矩阵作为交付前置。100完成完整观察与主力CLI接线，三家实际消费由103汇合。

已有模板、设计参考、Recipe和组件一并进入同源发现，提供实际适用范围、配置方式与可运行例子；当前任务优先复用匹配内容，不能手写第二模板目录或强套不适配样式。此处负责发现，生成/修改仍复用正式工具；自动/手动整课流程与常见材料分片由1.9的044/045消费，不作为本节点前置。

会话基础仅提供短用途、目标、当前工程/阶段及发现入口；按任务加载相关Skill，再展开教学/视觉质量参考和精确能力。1.8先退出已知全文注入和重复读取，保留所需完整内容；1.9/2.0完成同源Skill内容与软件内工作流，不能宣称本节点已替代完整外部流程。缓存按材料/源码/能力/观察版本失效，不用文件名相同或mtime代替语义一致。

能力卡、协议、Skills与查询脚本按原生会话工作目录和能力semanticVersion保存为稳定派生目录，生命周期跟随现有会话删除Owner。单轮候选结束清理本轮request/resources/candidate；后续回合仍能读取此前合法的同版本能力路径。profile分别给当前工程资料与能力资料的绝对根，当前请求显式指向当前语义版本；旧版本目录不被覆盖，候选仍只摄取当前request root。2026-09-08真实OpenCode回归证明一次性候选目录中的能力路径会在反馈回合失效，因此采用此生命周期修复。

## 验收与可信反例

- 用两份不同教学材料实际发现并选用已有模板/设计/Recipe/组件，返回适用范围、配置和可执行例子；不存在适配项时明确缺口，不伪造目录命中。应用与Builder查询同一能力语义。
- 简单选区任务初始技术说明≤12KB、精简发现入口≤8KB，必要完整合同仍可取；小任务不读取无关Runtime/Component资料。
- 反例：工具更名/版本变化、未知Surface、隐藏能力、缺失依赖、错误scope查询不得生成虚假支持或使用陈旧Schema。
- 混合页文字在前但选中图片时必要图片卡完整可得；scene/Flow正文中的实例patch可发现，共享模式不被错误扩域。help可用，一次查询得到的模式卡及示例能通过正式输入Schema；字节数合格不能代替这些行为。
- 精简请求不覆盖用户Skill/工具发现位置，也不删除必要内容；同一原生CLI仍可实际发现/使用的证据与100主力纵切、103汇合共用。请求减少的是默认发送量，不是可取得信息；必要资料超出初始预算时可按需展开，缺失材料或质量参考不能靠泛化提示冒充完整支持。

## 停止条件

若压缩需要丢失必要字段、教学目标或依赖闭包，优先保持正确性并给出超预算原因；不能手写第二清单满足字节目标。

## 聚焦验证

按[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)为本次代码变化和所选用例准备必要产物一次，再执行以下直接入口；纯逻辑/Schema测试不因此重构建。现有用例只证明其实际覆盖的行为；新增行为在实施diff中补命名测试，并同步文件及 `-t` / `--grep` 选择。执行时确认目标测试实际被选中，0匹配不算通过，不用旧用例通过代签新能力。未变化证据继续复用，仅失败指向更广范围或版本门要求才扩大验证。

```text
npx --no-install tsx scripts/generate-ai-capabilities.ts --check
npx --no-install vitest run tests/unit/generationCapabilityWorkspace.test.ts -t "directly supplies complete title, style and position contracts under the initial technical budget|filters supported destinations and rejects stale versions and unknown queries without losing complete resources"
npx --no-install vitest run tests/unit/coursewareCaseBuilder.test.ts -t "shares exact read-only discovery with the app and builds a discovered Recipe through the same Facade"
```

以上用例已存在，但不覆盖新增混合页排序、mode适用域、help或完整单次查询；实施时在能力workspace/Builder目标测试中补对应命名用例并登记实际过滤条件。生成命令已完成生成与检查时不重复同义--check。本节点先核对正式能力源、应用/Builder查询一致性、精简默认请求与输入量，不等待完整095观察。真实CLI读取轨迹并入100主力纵切：使用已通过对应原生基础门的CLI，在Native小任务与动态任务核对小能力卡直达、复杂内容按需展开以及完整定义可取得；分别记录技术说明、材料、图像、源码输入量与发现往返。可复用已有效的当前输入轨迹，完整观察及其他CLI消费差异在100/103集成时补齐，不把最终秒级/分钟级/整课预算前置，也不把本节点通过表述为三CLI全部验证。

## 回退与交接

交付唯一生成入口、数据版本/失效规则、查询API、兼容consumer名单及100/104受影响接线说明；生成产物与对应consumer同批切换。095/100已有接线按变化补证，三CLI消费差异仍交103汇合，不把已集成能力重新列为未开工。
