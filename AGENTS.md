# 互动课件创作路由

- 教学主题、教材、教案、题目、课程标准或既有课件先交给仓库内的 [orchestrate-courseware](.agents/skills/orchestrate-courseware/SKILL.md)。它只维护教师可直接阅读和修改的 `01-teaching-plan.md` 与 `02-presentation-script.md`。信息稀疏时分轮弹出少量高影响问题，先确认教学简报，再只写策划并停下；策划明确确认后另行补全并确认呈现简报，再只写脚本并停下；脚本明确确认后才构建。不得在同一轮跨阶段，也不得用制品生成前的预授权代替教师看过当前制品后的确认。
- 两份当前 Markdown 分别经教师确认后，使用 [build-courseware-project](.agents/skills/build-courseware-project/SKILL.md)。课例交付目录可以是任意普通目录，不需要是 Git 仓库；Builder 自行定位编辑器项目和 [能力索引](artifacts/ai-capabilities/index.json)，通过 `build:courseware-case` 的产品 Facade 加载课例模块、调用真实 V9 工厂与命令并把 `.h5lesson`/HTML 写回课例目录。不得要求教师提供或切换到编辑器仓库，也不得让课例模块静态导入编辑器内部路径。仓库没有 `agent-kit/` CLI。
- 通用 Skill 不规定课型、场景数、教学法或视觉风格，但教学策划必须有真实的知识获得路径，不能退化为从头到尾的题目、选项和判定；新知识不得只在答案反馈中第一次出现。呈现脚本必须按片段写明教学作用、选择表面（演示页 / 流式讲义 / 无限画布），并写细布局、讲解与操作。Native、Runtime 与 Component 是实现载体：稳定图文与简单点击/切场/播媒体走 Native 与声明式交互；稍复杂的局部互动走组件——先匹配已有包，允许新建；整页动画、特效、连续机制走场景/世界 Runtime，少放文字。

## 仓库开发入口

- 真实模型测试的额度约束：只使用 Luna，包括需要验证快速模式时也使用原生目录实际支持的 Luna。运行前检查测试脚本、所选模型及路由，不得沿用历史用例中的 Astra、Claude 或其他模型配置；不能因为跨 CLI 矩阵、排障或追求通过而自行换模型、升级模型。目标通道没有 Luna、无法确认路由或 Luna 无法覆盖待测能力时，先做不消耗模型额度的验证，说明缺口；只有用户明确同意后才可使用其他模型。Luna 付费测试及 Fast 已获用户授权，测试默认开启 Fast，可按验证需要自主运行、重跑和排障，不得因付费、Fast 或重跑再次索要许可。当前通道不支持 Luna Fast 时可使用 Luna 普通速度并如实记录。此约束适用于后续新对话，不能只留在聊天承诺中。

- 2026-09-08目标分期：1.8修当前CLI/工程编辑及效率基础；1.9的044实现内置自动/手动流程，045处理材料，042未命名/首存，041聊天首页与极简/专业工作台。自动必须上传且成功读取材料；手动依次确认教学简报、策划、呈现简报、脚本。上述外部Skill在044实施前继续现有手动确认路径；044同步实际guard/Skill路由，不能把规划当已实现。2.0起教师的所有课件步骤在软件内完成，包括QA/修复，不依赖另开外部AI/终端。详见[创作方案](docs/development-plan/AGENT_AUTHORING_LONG_TERM_PLAN.md)及[开发计划](docs/development-plan/AI_ASSISTANT_DELIVERY_PLAN.md)。

- 开始产品代码实现、缺陷修复或代码评审前，先读根目录 [当前开发总纲](COURSEWARE_DEVELOPMENT_PLAN.md) 的“当前开发路线”、[任务板](docs/development-plan/TASK_BOARD.md) 和任务涉及的源码、合同与目标测试；路线节点不是协调状态，满足依赖、当前事实与写锁后才按协议实例化，历史阶段名称不得自动恢复任务。
- 涉及 Schema/持久化、Surface、global/surface 图层、教师控制器、Published/Player、Runtime/Component、网络、导出或稳定身份时，行动前必须补读 [架构合同](docs/development-plan/ARCHITECTURE_CONTRACT.md) 的相关条目。
- 默认开发闭环、敏感变更、任务协调、写锁、验证停止条件与完成定义只遵循 [工作协议](docs/development-plan/WORKING_PROTOCOL.md)；不先做风险分级，单执行者单会话工作不建卡。当前 queued/active/blocked 协调状态只看任务板。开工前置与真实集成验收分开；稳定窄接口后的独立叶子可并行，由唯一Owner持有共享锁并分配精确非重叠写域。局部检查选择实际命名用例，必要制品按变化只准备一次；不得整文件隐式触发真实CLI矩阵或把排除/零匹配算通过。
- 当前产品事实以用户明确决定、正式 Schema/合同、源码和可复现结果为准。repo-index 只是可缺省的本地导航缓存，只有确能减少阅读量时才使用，不能阻断实现或覆盖源码事实。

## 自动加载硬边界

- 当前协议为 Course Project V9、Published Course V2、Runtime API 2/3 与 Component API 4；不打开或导入 V8 `.h5lesson`，不借 1.1 清理创建 V10。1.1 同时完成 V8 清零与主动模块化：`editorStore.ts` 最终只作为唯一 Zustand composition root，App/Workspace/Properties/Flow、Slide Published Native painter 和 Course package analyzer/preflight/emitter 按独立规格迁入正式 Owner。必须先迁移并验证等价 consumer；每个提交删除对应旧 writer/实现，任一中间提交都不得双写或削弱当前 UI、三 Surface、保存恢复、Undo/Redo、Preview/Player、Runtime/Component、Builder、诊断或导出能力。
- V9 已有字段、判别器和语义软冻结；additive 可选字段必须独立合同提交并保持 `.strict()`。Table、Chart 与 Slide Native input 是 Owner 明确批准的三个 V9 新 strict discriminator 窄例外，并在 Published Course V2 增加匹配的严格分支；旧 V9 必须继续可读，旧 reader 遇到新分支必须明确失败，不得静默剥离、截图降级或塞入 legacy SceneNode。
- 按Owner决定，1.8起普通内部构建默认显示创作助手和CLI聊天，无需dogfood开关；版本门前不得宣称可用或对外发行。长期架构是完整原生Codex、Claude、OpenCode加GUI和编辑器连接：同配置/授权下保留文件、终端、网络、工具/连接、Skills、子任务和模型循环，GUI承接原生授权，不默默提权。最小snapshot是输入优化，不是原生权限限制。应用不自建模型循环、MCP或替代工具RPC平台，不屏蔽CLI已有连接。编辑器candidate经structured stdout/artifact或staging返回，由宿主canonical commands与唯一资源事务提交；不暴露raw Store或live project API。Native/Recipe/Existing Component不等待动态门；Generated Component/Runtime仍经静态和真实宿主准入；不建立第二工程真相或历史。
- AI 会话、材料和 tool trace 保存在应用本地版本化目录，以“工程 ID + 规范化文件位置”隔离；Save As 创建新 workspace identity 且不复制旧会话。它们可删除但不进入 `.h5lesson`、Published、Component/Runtime 或导出物；应用只能承诺删除自己的记录，不虚假承诺同时删除外部 CLI 历史。
- Runtime/Component 是可信扩展，外部导入只是分发方式；自动生成的 Component/Runtime 源码必须先留在应用暂存区，经编译、协议、依赖、素材闭包、精确 origin、生命周期、资源上限、静态后备和真实宿主 smoke 自动准入后，才可自动取得当前正式可信扩展已有的宿主能力。自动可信不授予 Provider Secret、原始 Electron Main、任意 OS 命令、未开放远程脚本或未经合同批准的新宿主接口；长期 Provider Secret 不得写入工程、Published payload、组件包或任何导出物。
- 产品默认运行在受控团队与受信代码环境；staging硬边界是宿主只摄取当前candidate root内realpath闭合内容，正式工程修改只经canonical transaction，当前未提交的失败/迟到候选零工程写入。该规则不限制CLI整体文件权限；原生工具外部改变磁盘工程文件不算宿主提交，由既有打开/保存Owner处理必要的重载与保存冲突。除非信任来源改变，不扩为通用OS沙箱平台。
- 自动化最多证明 `engineering candidate`；真实视觉、互动和教师复核决定 `art candidate` / `accepted`。
