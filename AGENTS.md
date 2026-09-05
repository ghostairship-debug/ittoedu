# 互动课件创作路由

- 教学主题、教材、教案、题目、课程标准或既有课件先交给仓库内的 [orchestrate-courseware](.agents/skills/orchestrate-courseware/SKILL.md)。它只维护教师可直接阅读和修改的 `01-teaching-plan.md` 与 `02-presentation-script.md`。信息稀疏时分轮弹出少量高影响问题，先确认教学简报，再只写策划并停下；策划明确确认后另行补全并确认呈现简报，再只写脚本并停下；脚本明确确认后才构建。不得在同一轮跨阶段，也不得用制品生成前的预授权代替教师看过当前制品后的确认。
- 两份当前 Markdown 分别经教师确认后，使用 [build-courseware-project](.agents/skills/build-courseware-project/SKILL.md)。课例交付目录可以是任意普通目录，不需要是 Git 仓库；Builder 自行定位编辑器项目和 [能力索引](artifacts/ai-capabilities/index.json)，通过 `build:courseware-case` 的产品 Facade 加载课例模块、调用真实 V9 工厂与命令并把 `.h5lesson`/HTML 写回课例目录。不得要求教师提供或切换到编辑器仓库，也不得让课例模块静态导入编辑器内部路径。仓库没有 `agent-kit/` CLI。
- 通用 Skill 不规定课型、场景数、教学法或视觉风格，但教学策划必须有真实的知识获得路径，不能退化为从头到尾的题目、选项和判定；新知识不得只在答案反馈中第一次出现。呈现脚本必须按片段写明教学作用、选择表面（演示页 / 流式讲义 / 无限画布），并写细布局、讲解与操作。Native、Runtime 与 Component 是实现载体：稳定图文与简单点击/切场/播媒体走 Native 与声明式交互；稍复杂的局部互动走组件——先匹配已有包，允许新建；整页动画、特效、连续机制走场景/世界 Runtime，少放文字。

## 仓库开发入口

- 开始产品代码实现、缺陷修复或代码评审前，先读根目录 [当前开发总纲](COURSEWARE_DEVELOPMENT_PLAN.md) 的“当前开发路线”、[任务板](docs/development-plan/TASK_BOARD.md) 和任务涉及的源码、合同与目标测试；路线节点不是协调状态，满足依赖、当前事实与写锁后才按协议实例化，历史阶段名称不得自动恢复任务。
- 涉及 Schema/持久化、Surface、global/surface 图层、教师控制器、Published/Player、Runtime/Component、网络、导出或稳定身份时，行动前必须补读 [架构合同](docs/development-plan/ARCHITECTURE_CONTRACT.md) 的相关条目。
- 默认开发闭环、敏感变更、任务协调、写锁、验证停止条件与完成定义只遵循 [工作协议](docs/development-plan/WORKING_PROTOCOL.md)；不先做风险分级，单执行者单会话工作不建卡。当前 queued/active/blocked 协调状态只看任务板。
- 当前产品事实以用户明确决定、正式 Schema/合同、源码和可复现结果为准。repo-index 只是可缺省的本地导航缓存，只有确能减少阅读量时才使用，不能阻断实现或覆盖源码事实。

## 自动加载硬边界

- 当前协议为 Course Project V9、Published Course V2、Runtime API 2/3 与 Component API 4；不打开或导入 V8 `.h5lesson`，不借 1.1 清理创建 V10。1.1 同时完成 V8 清零与主动模块化：`editorStore.ts` 最终只作为唯一 Zustand composition root，App/Workspace/Properties/Flow、Slide Published Native painter 和 Course package analyzer/preflight/emitter 按独立规格迁入正式 Owner。必须先迁移并验证等价 consumer；每个提交删除对应旧 writer/实现，任一中间提交都不得双写或削弱当前 UI、三 Surface、保存恢复、Undo/Redo、Preview/Player、Runtime/Component、Builder、诊断或导出能力。
- V9 已有字段、判别器和语义软冻结；additive 可选字段必须独立合同提交并保持 `.strict()`。Table、Chart 与 Slide Native input 是 Owner 明确批准的三个 V9 新 strict discriminator 窄例外，并在 Published Course V2 增加匹配的严格分支；旧 V9 必须继续可读，旧 reader 遇到新分支必须明确失败，不得静默剥离、截图降级或塞入 legacy SceneNode。
- AI 路线为 1.6–1.9 在普通内部生产构建中默认隐藏、受控 dogfood 可按纵切开启，2.0 在内部生产构建中正式开放；不表示外部公开发行。在对应版本门完成前不得宣称相应能力可用。`courseAiHandoff` / `courseAiPatch` 等 internal/reserved 名称不能作为接线依据；正式路径是用户自行安装并认证的 Codex、Claude、OpenCode CLI。1.7 只允许 CLI 消费不可变最小 snapshot，并经 structured stdout/artifact channel，或在启用文件工具时经当前 session staging 输出 strict candidate；宿主通过 1.4 canonical commands 原子提交，CLI 没有 live project API。Native/Recipe/Existing Component 不等待动态代码门；Generated Component/Runtime 才经静态与真实宿主准入。1.8 起才开放版本化 live MCP Authoring Tools；不另建模型规划循环、第二工程真相或第二历史。
- AI 会话、材料和 tool trace 保存在应用本地版本化目录，以“工程 ID + 规范化文件位置”隔离；Save As 创建新 workspace identity 且不复制旧会话。它们可删除但不进入 `.h5lesson`、Published、Component/Runtime 或导出物；应用只能承诺删除自己的记录，不虚假承诺同时删除外部 CLI 历史。
- Runtime/Component 是可信扩展，外部导入只是分发方式；自动生成的 Component/Runtime 源码必须先留在应用暂存区，经编译、协议、依赖、素材闭包、精确 origin、生命周期、资源上限、静态后备和真实宿主 smoke 自动准入后，才可自动取得当前正式可信扩展已有的宿主能力。自动可信不授予 Provider Secret、原始 Electron Main、任意 OS 命令、未开放远程脚本或未经合同批准的新宿主接口；长期 Provider Secret 不得写入工程、Published payload、组件包或任何导出物。
- 产品默认运行在受控团队与受信代码环境；staging 的硬边界是宿主只摄取当前 candidate root 内 realpath 闭合内容、`.h5lesson` 只经 canonical transaction 写入、失败/迟到结果零工程写入。除非分发或信任来源改变，不把这些规则升级成公开恶意插件、多租户或通用 OS sandbox 平台。
- 自动化最多证明 `engineering candidate`；真实视觉、互动和教师复核决定 `art candidate` / `accepted`。
