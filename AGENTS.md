# 互动课件创作路由

以下两条描述**显式调用现有外部课件 Skill**的实际流程；产品开发、方案讨论不触发它们。1.9工作台的新目标是不强制四阶段，F07/044须同步运行guard、提示词、托管Skill源与安装产物；本次文档重建没有修改Skill。用户明确指令优先，不能以历史停点重新否定已确认的产品决定。

- 教学主题、教材、教案、题目、课程标准或既有课件先交给仓库内的 [orchestrate-courseware](.agents/skills/orchestrate-courseware/SKILL.md)。它只维护教师可直接阅读和修改的 `01-teaching-plan.md` 与 `02-presentation-script.md`。信息稀疏时分轮弹出少量高影响问题，先确认教学简报，再只写策划并停下；策划明确确认后另行补全并确认呈现简报，再只写脚本并停下；脚本明确确认后才构建。不得在同一轮跨阶段，也不得用制品生成前的预授权代替教师看过当前制品后的确认。
- 两份当前 Markdown 分别经教师确认后，使用 [build-courseware-project](.agents/skills/build-courseware-project/SKILL.md)。课例交付目录可以是任意普通目录，不需要是 Git 仓库；Builder 自行定位编辑器项目和 [能力索引](artifacts/ai-capabilities/index.json)，通过 `build:courseware-case` 的产品 Facade 加载课例模块、调用真实 V9 工厂与命令并把 `.h5lesson`/HTML 写回课例目录。不得要求教师提供或切换到编辑器仓库，也不得让课例模块静态导入编辑器内部路径。仓库没有 `agent-kit/` CLI。
- 通用 Skill 不规定课型、场景数、教学法或视觉风格，但教学策划必须有真实的知识获得路径，不能退化为从头到尾的题目、选项和判定；新知识不得只在答案反馈中第一次出现。呈现脚本必须按片段写明教学作用、选择表面（演示页 / 流式讲义 / 无限画布），并写细布局、讲解与操作。Native、Runtime 与 Component 是实现载体：稳定图文与简单点击/切场/播媒体走 Native 与声明式交互；稍复杂的局部互动走组件——先匹配已有包，允许新建；整页动画、特效、连续机制走场景/世界 Runtime，少放文字。

## 仓库开发入口

- 真实模型测试的额度约束：Codex / OpenCode 通道只使用 Luna，包括需要验证快速模式时也使用原生目录实际支持的 Luna。2026-09-15 用户明确授权“Claude通道可以测试，直接用DeepSeek即可”：Claude 通道使用实际路由已确认的 DeepSeek，不因原生目录没有 Luna 而停止该通道测试，也不沿用历史 Anthropic 模型。运行前检查测试脚本、所选模型及实际路由，不能仅凭显示别名认定模型；不能因为跨 CLI 矩阵、排障或追求通过而自行改用未授权模型。无法确认上述路由或所选模型无法覆盖待测能力时，先做不消耗模型额度的验证并说明缺口，只有用户明确同意后才可使用其他模型。Luna 付费测试及 Fast、Claude 通道 DeepSeek 测试均已获用户授权，可按验证需要自主运行、重跑和排障，不得因付费、Fast 或必要重跑再次索要许可。Luna 测试默认开启 Fast；当前通道不支持所选模型的 Fast 时使用实际支持的普通速度并如实记录。此约束适用于后续新对话，不能只留在聊天承诺中。

- 2026-09-18重建1.9目标：工作空间/项目是会话目录，打开文件提供编辑目标；无课件也能开始和恢复。课件默认当前页，点选转当前选择，发送冻结目标；单一自动目标提示，@引用与编辑对象分开。材料通过目录/路径/附件/粘贴使用，默认按任务推进，只有用户要求先审真实制品时停点，不强制课例注册或四阶段文稿。040/042负责归属与首存/另存，041负责自由布局、项目会话管理、复制和/、@入口及两种编辑位置打磨，044/045/049负责自然创作/材料/文件共编；046–048正文/Flow/可编辑Word、051 PPTX必选保留，050/060尚未闭合。唯一当前实施入口为[完整实施方案](docs/development-plan/R19_FRONTEND_SPECIAL_IMPLEMENTATION_PLAN.md)，[路线](docs/development-plan/roadmap/1.9/README.md)保留正式DAG。2026-09-18本轮只重建文档，不运行实现/测试；后续收到实现指令再执行。2.0范围不提前。

- 开始产品代码实现、缺陷修复或代码评审前，先读根目录 [当前开发总纲](COURSEWARE_DEVELOPMENT_PLAN.md) 的“当前开发路线”、[任务板](docs/development-plan/TASK_BOARD.md) 和任务涉及的源码、合同与目标测试；路线节点不是协调状态，满足依赖、当前事实与写锁后才按协议实例化，历史阶段名称不得自动恢复任务。
- 涉及 Schema/持久化、Surface、global/surface 图层、教师控制器、Published/Player、Runtime/Component、网络、导出或稳定身份时，行动前必须补读 [架构合同](docs/development-plan/ARCHITECTURE_CONTRACT.md) 的相关条目。
- 默认开发闭环、敏感变更、任务协调、写锁、验证停止条件与完成定义只遵循 [工作协议](docs/development-plan/WORKING_PROTOCOL.md)；不先做风险分级，单执行者单会话工作不建卡。当前 queued/active/blocked 协调状态只看任务板。开工前置与真实集成验收分开；稳定窄接口后的独立叶子可并行，由唯一Owner持有共享锁并分配精确非重叠写域。局部检查选择实际命名用例，必要制品按变化只准备一次；不得整文件隐式触发真实CLI矩阵或把排除/零匹配算通过。
- 当前产品事实以用户明确决定、正式 Schema/合同、源码和可复现结果为准。repo-index 只是可缺省的本地导航缓存，只有确能减少阅读量时才使用，不能阻断实现或覆盖源码事实。

## 自动加载硬边界

- 当前协议为 Course Project V9、Published Course V2、Runtime API 2/3 与 Component API 4；不打开或导入 V8 `.h5lesson`，不借 1.1 清理创建 V10。**1.1 V8 清零与主动模块化已经完成**（`v1.1.1` 签署基线）：`editorStore.ts` 是唯一 Zustand composition root。1.9 不重做该迁移。仅当本批命中该棘轮（新增 raw Store consumer、双写、削弱三 Surface／保存／Player／导出）时才补读架构合同第 8 节并按等价 consumer 先迁后删；不得把 1.1 段落读成当前开工任务。
- V9 与 Published V2 保持严格合同。2026-09-15 Owner 对本次1.9改造明确“没有兼容需求”：按[统一正文合同](docs/development-plan/R19_SHARED_DOCUMENT_CONTENT_CONTRACT.md)直接替换Flow文字/公式/相关正文字段，不保留旧text/runs、AST双分支或旧工程转换；新课例/会话/缓存不承担旧格式迁移。正式根Schema、工厂与直接consumer在同一可运行批次切换，未知/旧输入明确失败，不静默剥离或截图降级。其他未涉及域继续遵守原有严格合同；不为本次创建V10，不误删其他Surface仍使用的Native公式能力。
- 按Owner决定，1.8起普通内部构建默认显示创作助手和CLI聊天，无需dogfood开关；版本门前不得宣称可用或对外发行。长期架构是完整原生Codex、Claude、OpenCode加GUI和编辑器连接：同配置/授权下保留文件、终端、网络、工具/连接、Skills、子任务和模型循环，GUI承接原生授权，不默默提权。最小snapshot是输入优化，不是原生权限限制。应用不自建模型循环、MCP或替代工具RPC平台，不屏蔽CLI已有连接。编辑器candidate经structured stdout/artifact或staging返回，由宿主canonical commands与唯一资源事务提交；不暴露raw Store或live project API。Native/Recipe/Existing Component不等待动态门；Generated Component/Runtime仍经静态和真实宿主准入；不建立第二工程真相或历史。
- 1.9目标中会话按规范化workspaceRoot/projectPath与conversationId归属，工程编辑另绑定真实projectId/路径/revision/epoch；首次保存只绑定工程文件，不重建目录对话。Save As建立新编辑身份，不复制旧候选/工程执行句柄/trace；目录讨论可继续，历史保留原文件目标，新目标重新观察。文档与整理材料是真实文件，应用记录不存第二正文；删除聊天/缓存不删除用户文件或恢复稿，也不承诺删除外部CLI历史。详见[目录与文件合同](docs/development-plan/R19_LESSON_DOCUMENT_WORKSPACE_CONTRACT.md)。旧课例归属/四稿guard仍须在F01/F07与所有直接consumer同批替换，文档不是运行完成证据。
- Runtime/Component 是可信扩展，外部导入只是分发方式；自动生成的 Component/Runtime 源码必须先留在应用暂存区，经编译、协议、依赖、素材闭包、精确 origin、生命周期、资源上限、静态后备和真实宿主 smoke 自动准入后，才可自动取得当前正式可信扩展已有的宿主能力。自动可信不授予 Provider Secret、原始 Electron Main、任意 OS 命令、未开放远程脚本或未经合同批准的新宿主接口；长期 Provider Secret 不得写入工程、Published payload、组件包或任何导出物。
- 产品默认运行在受控团队与受信代码环境；staging硬边界是宿主只摄取当前candidate root内realpath闭合内容，正式工程修改只经canonical transaction，当前未提交的失败/迟到候选零工程写入。该规则不限制CLI整体文件权限；原生工具外部改变磁盘工程文件不算宿主提交，由既有打开/保存Owner处理必要的重载与保存冲突。除非信任来源改变，不扩为通用OS沙箱平台。
- 自动化最多证明 `engineering candidate`；真实视觉、互动和教师复核决定 `art candidate` / `accepted`。
