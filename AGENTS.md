# 互动课件创作路由

- 教学主题、教材、教案、题目、课程标准或既有课件先交给仓库内的 [orchestrate-courseware](.agents/skills/orchestrate-courseware/SKILL.md)。它只维护教师可直接阅读和修改的 `01-teaching-plan.md` 与 `02-presentation-script.md`。信息稀疏时分轮弹出少量高影响问题，先确认教学简报，再只写策划并停下；策划明确确认后另行补全并确认呈现简报，再只写脚本并停下；脚本明确确认后才构建。不得在同一轮跨阶段，也不得用制品生成前的预授权代替教师看过当前制品后的确认。
- 两份当前 Markdown 分别经教师确认后，使用 [build-courseware-project](.agents/skills/build-courseware-project/SKILL.md)。课例交付目录可以是任意普通目录，不需要是 Git 仓库；Builder 自行定位编辑器项目和 [能力索引](artifacts/ai-capabilities/index.json)，通过 `build:courseware-case` 的产品 Facade 加载课例模块、调用真实 V9 工厂与命令并把 `.h5lesson`/HTML 写回课例目录。不得要求教师提供或切换到编辑器仓库，也不得让课例模块静态导入编辑器内部路径。仓库没有 `agent-kit/` CLI。
- 通用 Skill 不规定课型、场景数、教学法或视觉风格，但教学策划必须有真实的知识获得路径，不能退化为从头到尾的题目、选项和判定；新知识不得只在答案反馈中第一次出现。呈现脚本必须按片段写明教学作用、选择表面（演示页 / 流式讲义 / 无限画布），并写细布局、讲解与操作。Native、Runtime 与 Component 是实现载体：稳定图文与简单点击/切场/播媒体走 Native 与声明式交互；稍复杂的局部互动走组件——先匹配已有包，允许新建；整页动画、特效、连续机制走场景/世界 Runtime，少放文字。

## 仓库开发入口

- 开始产品代码实现、缺陷修复或代码评审前，先读根目录 [当前开发总纲](COURSEWARE_DEVELOPMENT_PLAN.md) 的“当前开发路线”、[任务板](docs/development-plan/TASK_BOARD.md) 和任务涉及的源码、合同与目标测试；路线不等于 Ready，历史阶段名称不得自动恢复任务。
- 涉及 Schema/持久化、Surface、global/surface 图层、教师控制器、Published/Player、Runtime/Component、网络、导出或稳定身份时，行动前必须补读 [架构合同](docs/development-plan/ARCHITECTURE_CONTRACT.md) 的相关条目。
- 立项、S0/S1/S2、任务卡、单写入者、Reviewer、验证去重、Git 与完成定义只遵循 [工作协议](docs/development-plan/WORKING_PROTOCOL.md)；AGENTS 与总纲不复述这些规则。当前 queued/active/blocked 状态只看任务板。
- 当前产品事实以用户明确决定、正式 Schema/合同、源码和可复现结果为准。repo-index 只是可缺省的本地导航缓存，只有确能减少阅读量时才使用，不能阻断实现或覆盖源码事实。

## 自动加载硬边界

- 当前协议为 Course Project V9、Published Course V2、Runtime API 2/3 与 Component API 4；不导入 V8 `.h5lesson`，不借重构创建 V10。V9 已有字段、判别器和语义软冻结；additive 可选字段必须独立合同提交并保持 `.strict()`。
- 当前编辑器内没有可见 AI、聊天、模型或 Provider；`courseAiHandoff` / `courseAiPatch` 等 internal/reserved 接口不得宣称为可用工作流，也不得新增调用点。
- Runtime/Component 是经过审核的可信扩展，外部导入只是分发方式；不得仅因代码不内置就建立 opaque-origin 权限边界或永久禁用真实 consumer 所需的宿主能力。远程脚本暂不开放，长期 Provider Secret 不得写入工程、Published payload、组件包或导出 HTML。
- 自动化最多证明 `engineering candidate`；真实视觉、互动和教师复核决定 `art candidate` / `accepted`。
