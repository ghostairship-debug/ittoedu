# 1.8当前执行包：准确编辑、短操作与可靠结束

> 2026-09-10：[延迟修复与工程收尾](LATENCY_COMPLETION_PLAN.md)的路径、计时、实际互动核对及Windows会话持久化修复已集成；OpenCode 使用 OpenAI OAuth Luna 默认，受影响代表用例通过。Owner临时接入DeepSeek后Claude Code文字预览已补验通过；[原记录](../../reviews/2026-09-10-latency-completion.md)保留Sonnet 503及当时状态；[最终工程验收](../../reviews/2026-09-10-final-acceptance.md)已完成约定工程范围与失败修复，Owner S3仍未签署。下文A/B/C/D及原有限矩阵按有效范围复用，不作为整批重开指令。

2026-09-09按[统一方案](../../../../AI编辑最短路径产品决策报告.md)与[开发计划](../../AI_ASSISTANT_DELIVERY_PLAN.md)更新并经用户授权实施。文件名沿用首批入口以保留引用；下文定义本批结果边界，实际完成范围与保留失败见[实施记录](../../reviews/2026-09-09-short-path-implementation.md)。089–104相关实现已集成，9月8日Claude身份、退出收口、配置链和Flow修复及有效证据按未变范围复用，不再全部重开；当前协调仍只看任务板。

## 1. 当前起点

先读总纲“当前开发路线”、任务板/工作协议、[共同实施合同](IMPLEMENTATION_CONTRACT.md)相关条目、本包和本次节点的直接源码/测试。[历史审查](../../reviews/1.8-first-batch-review.md)与[预检](../../reviews/1.8-first-batch-preflight.md)是证据来源，不覆盖当前源码事实。旧只读/白名单探针不证明完整原生能力，也不证明当前仍有相同限制。

| 已有基础 | 当前应补的结果 |
| --- | --- |
| 三CLI原生transport、V2任务/记录、真实观察、手动/自动应用和多阶段反馈 | 创建前正确配置、真实usage和可读消息；提交后能可靠结束 |
| strict candidate、多步/$result、正式资源事务与commit receipt | 当前request短投影展开；结构化失败和finish/observe声明贯通 |
| asset.image.transform的copy-on-write资产及Native/Flow引用更新 | 有效PNG正例、原坏输入负例、首个候选即有准确图片诊断 |
| 小能力卡、查询脚本、instance/shared patch与源码增量 | 选区必要卡优先、一次完整发现、正确help与operation/mode写域、消除full shared revise旧提示 |
| deadline、无进展、格式修复和回执保存重试 | 覆盖观察至提交前及预览到期；唯一终态/持久化/待送回执一致 |
| Builder V2 execute/finish及observe/readReceipts/activateScope | 同源发现和高频窄操作接线；不发明打开已有工程的方法 |

不得把已有基础重新实施，也不因“已集成”宣称103、060/S3或三CLI全部通过。当前故障、代码变化和明确验收门决定补查范围。

## 2. 执行顺序与写入边界

A/B/C/D是原Owner的剩余工作批次，不新增manifest节点或依赖。先由090 Owner定本次公共增量接口；不依赖新接口的图片夹具、帮助、发现、消息修复和最小计时可同步开始。A的必要基础汇入B；C使用已有增量能力可随A/B开始，D集中补真实集成证据。C中需实测触发的后续深化不阻塞D；1.9/2.0不进入本包。

| 叶子 / 原Owner | 可独立负责 | 必须由唯一Owner顺序集成 |
| --- | --- | --- |
| 098图片 | 图像变换/正式tool与夹具的直接修复及测试 | generationSnapshot诊断、共享失败字段、事务接口 |
| 091/092 Codex | 一个writer统一codexAppServer初始化、Schema、usage、typed事件及专属测试 | harness open/configure、shared合同、repository/projection |
| 094 OpenCode | ACP启动/目录/解析分组/配置确认及缓存，专属测试 | 共用发现/配置接口与UI状态 |
| 095/096/099/104发现与提示 | 能力生成/查询、组件模式提示、Builder consumer | generationSnapshot由一个writer汇总焦点/组件目标/诊断；生成目录单writer |
| 097短操作 | 正式candidate构造/展开、批量和引用测试 | 090公共传输与100结果/生命周期 |
| 100/101/102终态与界面 | 窄接口稳定后的独立Chat展示/恢复consumer | generationTaskController、harness/guard/repository、IPC只由公共Owner修改 |
| 089/093保全 | 仅受影响的新失败或相关回归 | 复用既有Flow与Claude证据，不作为全部重开项 |

多执行者实施按工作协议建当前必要卡，由协调Owner持共享锁，将实际非重叠叶子分到隔离工作区；同一实体文件始终单writer。共享合同、harness、generationSnapshot、codexAppServer不按功能名拆成并发writer。真实窗口、输出目录与工程提交串行，独立准备可并行；无并行条件按同一结果顺序串行。

## 3. A批：先恢复正确性与必要观测

### 3.1 图片与失败事实

原红点PNG的IDAT CRC和zlib校验损坏是已确认事实。修scripts/build-architecture-baseline-fixtures.ts的正例，保留原坏字节负例，只重建受影响派生夹具，不批量改用户工程。

复用src/renderer/project/imageTransform.ts和authoring/tools/imageTransformTool.ts的新asset+局部引用事务。有效1×1红图、含文字/alpha图与损坏图分开证明：目标像素正确，未要求内容/隐藏RGB/alpha、节点身份及其他共享引用保留，Undo与资源可恢复。首候选就区分未附图、解码/预检失败、不支持与未知；失败不得替换为绿色文字或shape。合法载体转换继续遵循097原合同。

### 3.2 原生配置、Schema、用量与消息

091/092在原生thread创建前带入用户已选model；未选则原生默认。创建所需配置与只能在首次turn后确认的effort分阶段记录，不能等待后者再开turn。实际请求/原生确认与UI requested/effective一致，失败不静默换模型；恢复和active切换各用合法边界。

同版本同模式outputSchema去本轮requestId常量，值由输入/信封严格校验；candidate/auto两处检查都保留。按真实嵌套tokenUsage.last/total贯通adapter、strict事件、projection、repository、diagnostic和UI，保留reasoning、unknown=null和去重。typed消息按item/phase/type分流，机器候选增量不进入正文，完整终态才提取；普通讨论JSON仍可见。不要根据本例所有JSON推断原生Schema必然约束中途消息。

094按启动→目录请求→分组解析→实际配置确认定位；不预断言本机模型缺失的完整根因。目录按CLI版本/cwd/非秘密身份缓存与合并请求，区分错误、空列表和过期结果并可刷新。已有terminal/file/授权和pending RPC清理保全。

### 3.3 一次可用发现与现有增量

095选区必要信息优先，保留整页关系和冻结目标；混合页不能被首个文本工具占掉图片必要卡。096修help独立处理及operation/mode支持域，一次查询返回完整输入/目标/依赖/示例/诊断和引用。简单选区初始技术说明≤12KB，原图/材料/源码单列；必要技术内容超出该样本边界须报告分项和原因，不截断字段或宣称已通过简单选区验收，也不强制三轮目录→卡→Schema。

099把旧full shared revise提示改为真实instance/shared patch与changedFiles/deleteFiles合同，保持基线与未变内容；104通过同源能力和既有Builder窄观察/回执消费，不复制字段表或新增Builder协议。源码/动态范围不是所有编辑的默认输入；已有多步候选和资源依赖先直接使用。

## 4. B批：短投影、完整终态与预算

090先版本化增量字段及strict consumer，097再将当前request内target/asset别名展开为完整candidate，绑定canonical target/revision/sessionGeneration/task epoch。未知、跨范围、过期别名拒绝；不以活动选区或自然语言补猜。参数来自正式Schema，展开后仍走当前Facade/prepare/事务。短/完整传输产生同一业务结果与Undo；批量相关操作与$result仍保持依赖和原子性。

afterCommit的finish必须经过实际committed或正式unchanged、必要证据与已保存回执，再由generationTaskController、main harness、AiTask guard/持久化和UI一起终结。unchanged不增revision/Undo；preview待应用不算完成。必要observe/continue附具体理由，保留复杂任务、后续阶段和受影响真实互动检查，不增加强制总结轮。

回执先保存于唯一应用会话；原生无推理追加仅在实际版本验证角色/身份/幂等/恢复后启用，缺失则持久标记待送并在下次真正请求前带入，不阻塞本地完成。已提交但记录失败保留内存receipt，只重试保存；回执未落盘即崩溃则核实当前工程事实，未知如实显示，不自动重复修改或造回执。

工具/prepare/controller/LocalAgent/AiHostResult/下一输入保留阶段、步骤、code、target/asset、字段路径、revision、committed、恢复动作和实际帧/状态。动态smoke失败不丢已有证据；replacement-unmappable仍表示引用映射错误，不滥用于意图越界。

沿现有20分钟绝对deadline覆盖观察、原生执行、prepare、准入和提交前。子检查/等待/重试不延期；preview或waiting-input到期后旧候选不可应用，再次用户输入经新观察准备。首个失败建立基线，其后连续两次无实质进展停止；保留一次有诊断格式修复。candidateId、注释或summary变化不算进展。超时列已完成/未完成/恢复点，保留此前合法提交。

## 5. C批复杂编辑与D批真实汇合

C批按统一方案先用已有patch/多步候选完成整页和互动修改，其发现/提示接线随A/B推进；进一步观察、检查或资源复用只有实测瓶颈成立才在099/1.9-050深化，不另设未触发功能前置。

D批集中真实结果与有限对照。100先用一家已具对应原生基础能力的CLI证明共用链，完整三家在103汇合，不要求每个叶子都跑全部矩阵。成功finish与有理由继续两条都验，不能用单轮通过证明复杂创作完成。

| 待证明结果 | 必要反例 / 真实证据 |
| --- | --- |
| 正确图片/精确文字 | 有效与坏图分离；首候选正确目标，保持身份/内容/共享引用，保存重开与Undo按受影响范围 |
| 正确调用与短操作 | 混合页图片优先、scene/Flow实例patch、共享域、帮助和query Schema可解析；短/完整等价，错别名/stale拒绝 |
| 模型、消息与usage | 实际请求model/effort分阶段确认；真实last/total wire去重；机器JSON不泄漏、正常JSON可读 |
| 任务与恢复 | auto/preview、finish/unchanged/observe、拒绝/stale、prepare超时、待应用到期、回执失败只重试记录、未落盘崩溃未知 |
| 复杂编辑与动态 | 整页关系、多步依赖、实例/共享patch；真实互动动作和失败帧，lifecycle smoke不冒称语义完成 |
| 双入口与三CLI | 应用当前工程与普通非Git课例目录Builder；各adapter能力差异准确，保留103原有限自然任务和生命周期范围 |

计时主指标为请求→首次正确且可用结果，总任务终结另列；effective model/effort/service tier、auto/preview、冷/热与用户等待分组。保留原始样本、失败和中位数/范围，不用3次样本报P95，不拿坏PNG负例对比有效图制造提速。continuation/native turn/candidate/token事件和不可见内部模型请求分开计数。仅实测表明瓶颈后，在099/1.9-050选择增量观察、细粒度补丁、检查/资源复用。

## 6. 精确验证入口与停止

准备统一按[开发计划6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)。以下是实际已有文件的导航，不是一次全跑的命令清单；实施时先补待验证的新命名用例，再选择对应文件/过滤。0匹配、skip/exclude不算通过；纯逻辑不因此构建Player，相关制品按变化只准备一次。

| 写域 | 直接阅读 / 验证导航（相对仓库根） |
| --- | --- |
| 图片 | src/shared/imageTransformContract.ts；src/renderer/project/imageTransform.ts；src/renderer/authoring/tools/imageTransformTool.ts；scripts/build-architecture-baseline-fixtures.ts；tests/unit/imageTransform.test.ts、imageTransformTool.test.ts |
| 原生配置/通信 | src/main/localAgent/codexAppServer.ts、openCodeAcp.ts、harness.ts；src/shared/localAgentContract.ts、localAgentTaskContract.ts、localAgentProjection.ts；tests/unit/codexAppServer.test.ts、openCodeAcp.test.ts、localAgentHarnessV2.test.ts |
| 观察/发现 | src/renderer/authoring/generation/generationSnapshot.ts；src/main/localAgent/capabilityWorkspace.ts；scripts/generate-ai-capabilities.ts、query-ai-capabilities.mjs；tests/unit/generationSnapshotCanvas.test.ts、generationCapabilityWorkspace.test.ts、aiCapabilities.test.ts |
| 短操作/动态 | src/renderer/authoring/generation/prepareGenerationCandidate.ts；src/renderer/authoring/tools/componentPackageTool.ts；src/renderer/course/coursewareBuilderV2.ts；tests/unit/courseComponentPackageTransactions.test.ts；其余直接用例按097/099/104规格 |
| 终态/恢复 | src/renderer/authoring/generation/generationTaskController.ts；src/shared/localAgentTaskGuards.ts；src/main/localAgent/harness.ts、repository.ts；tests/unit/generationTaskController.test.ts、localAgentTaskContract.test.ts、localAgentHarnessV2.test.ts |
| 真实汇合 | tests/e2e/stabilizationCoreUsability.spec.ts按103命名用例精确选入；局部不得整文件隐式触发三CLI付费生成 |

共享检查一次运行或复用有效证据；重跑需相关源码、合同、fixture、配置或验证定义变化。既有090/093恢复、退出和089 Flow通过只在本轮相关变化时补检，不因审查者或上下文变化全部重跑。生产代码不import tests/fixtures或output，不写死本机模型/会话/账号；不改用户全局CLI配置或个人Skill。

交付每个本轮目标的实际结果、受影响检查与未完成事实。A/B/C/D只更新实际协调卡，不预建全部active节点；完成后按协议清卡/生成任务板。103、050、051/052 PPTX、083/087及060/S3门全部保留，不由本包自动签署；1.9/2.0按正式计划继续，不在本批顺便实施。未获本次实施授权时只维护计划，不自行改产品、commit/push/发布或标accepted。
