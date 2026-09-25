# 互动课件创作路由

以下两条描述**显式调用现有外部课件 Skill**的实际流程；产品开发、方案讨论不触发它们。1.9工作台的新目标是不强制四阶段，F07/044须同步运行guard、提示词、托管Skill源与安装产物；本次文档重建没有修改Skill。用户明确指令优先，不能以历史停点重新否定已确认的产品决定。

- 教学主题、教材、教案、题目、课程标准或既有课件先交给仓库内的 [orchestrate-courseware](.agents/skills/orchestrate-courseware/SKILL.md)。它只维护教师可直接阅读和修改的 `01-teaching-plan.md` 与 `02-presentation-script.md`。信息稀疏时分轮弹出少量高影响问题，先确认教学简报，再只写策划并停下；策划明确确认后另行补全并确认呈现简报，再只写脚本并停下；脚本明确确认后才构建。不得在同一轮跨阶段，也不得用制品生成前的预授权代替教师看过当前制品后的确认。
- 两份当前 Markdown 分别经教师确认后，使用 [build-courseware-project](.agents/skills/build-courseware-project/SKILL.md)。课例交付目录可以是任意普通目录，不需要是 Git 仓库；Builder 自行定位编辑器项目和 [能力索引](artifacts/ai-capabilities/index.json)，通过 `build:courseware-case` 的产品 Facade 加载课例模块、调用真实 V9 工厂与命令并把 `.h5lesson`/HTML 写回课例目录。不得要求教师提供或切换到编辑器仓库，也不得让课例模块静态导入编辑器内部路径。仓库没有 `agent-kit/` CLI。
- 通用 Skill 不规定课型、场景数、教学法或视觉风格，但教学策划必须有真实的知识获得路径，不能退化为从头到尾的题目、选项和判定；新知识不得只在答案反馈中第一次出现。呈现脚本必须按片段写明教学作用、选择表面（演示页 / 流式讲义 / 无限画布），并写细布局、讲解与操作。Native、Runtime 与 Component 是实现载体：稳定图文与简单点击/切场/播媒体走 Native 与声明式交互；稍复杂的局部互动走组件——先匹配已有包，允许新建；整页动画、特效、连续机制走场景/世界 Runtime，少放文字。

## 仓库开发入口

- 真实模型测试以 API 为主：开发主路由为 TeamoRouter（provider `teamorouter`，`https://api.teamorouter.com/v1`）的 DeepSeek，第二路由为 DeepSeek 官方 API；均已获 Owner 授权用于 S05/S06/S11/S13/S14 及 REL 中适用的 DeepSeek 文本/视觉、规划与工具调用，可按验证需要自主运行和必要重跑。记录实际路由、模型 ID、账号计费类型与能力；模型 ID 在探针时按供应商实时目录钉定，首选 V4.1 Flash，不把 dsh 模型列表当供应商权威目录，不混写 `deepseek-flash` 与 `deepseek-v4-flash`。开发测试只在运行时读取 `TEAMOROUTER_API_KEY` / `DEEPSEEK_API_KEY`；产品凭据使用自己的安全存储，内部测试模型与产品默认设置分离。
- 2026-09-23 Owner 决定首轮上线 GPT OAuth，使用当前账号通过正式登录流程接入，前期由该连接生图；所需登录与 OAuth 图像验证已授权，无需再次索要账号选择。独立图片 API 的供应商与账号待定，不作为 B05 前置；GPT OAuth 登录、实际图像模型/执行者/计费及生成编辑能力仍须在 S05/S14/P5 实测，不能将账号授权记为接通或通过。DeepSeek 授权不延伸为任意图像 API 授权，不静默切换收费路径。本轮仍只修订方案，不发起登录、付费调用或产品实现。
- 既有 CLI 授权只用于 S12-T01、M12-T05 等确需外部客户端的用例：Codex / OpenCode 只用 Luna，Claude 只用已授权 DeepSeek；按各 CLI 当时实际配置记录模型和路由，不推断 Luna 的历史路由。Luna 默认开启 Fast，不支持时用实际支持的普通速度并记录。运行前核对脚本、所选模型及实际路由；不得因排障改用未授权模型，exclude/skip/零匹配不算通过。已授权路径可按相关变化或新假设自主验证、必要重跑，不因付费或 Fast 重复索要许可；无法确认路由或能力时先做不收费检查并记录缺口，不无限重复同因付费请求。

- 2026-09-22 当前目标为[果铃 2.0 收敛方案](果铃2.0收敛方案.md)及[GPTpro 执行包](GPTpro方案/guoling_2_0_execution_plan/00_README.md)：API/Token Plan 为主、OAuth 可选、统一自建执行器、外部 MCP。旧 1.x 路线不限制本次重构。2026-09-25：S01–M14 已工程验收并提交为 2.0 基线 `25b12b4b`；后续按收敛方案 §7B 与[实施顺序](GPTpro方案/guoling_2_0_execution_plan/delivery/SEQUENCE.md)整合推进 B13–B18（M20 → M21+M19 → M15 → M16 → M17 → M18，REL-T11 与 M14-T05 置后），不自行扩大范围或启动未授权付费测试。

- 开始产品代码实现、缺陷修复或代码评审前，先读[当前收敛方案](果铃2.0收敛方案.md)、[执行任务索引](GPTpro方案/guoling_2_0_execution_plan/03_TASK_INDEX.md)、[任务板](docs/development-plan/TASK_BOARD.md) 和任务涉及的源码、合同与目标测试；路线节点不是协调状态，满足依赖、当前事实与写锁后才按协议实例化，历史阶段名称不得自动恢复任务。
- 涉及 Schema/持久化、Surface、global/surface 图层、教师控制器、Published/Player、Runtime/Component、网络、导出或稳定身份时，行动前必须补读 [架构合同](docs/development-plan/ARCHITECTURE_CONTRACT.md) 的相关条目。
- 默认开发闭环、敏感变更、任务协调、写锁、验证停止条件与完成定义只遵循 [工作协议](docs/development-plan/WORKING_PROTOCOL.md)；不先做风险分级，单执行者单会话工作不建卡。当前 queued/active/blocked 协调状态只看任务板。开工前置与真实集成验收分开；稳定窄接口后的独立叶子可并行，由唯一Owner持有共享锁并分配精确非重叠写域。局部检查选择实际命名用例，必要制品按变化只准备一次；不得整文件隐式触发真实CLI矩阵或把排除/零匹配算通过。
- 当前产品事实以用户明确决定、正式 Schema/合同、源码和可复现结果为准。repo-index 只是可缺省的本地导航缓存，只有确能减少阅读量时才使用，不能阻断实现或覆盖源码事实。

## 自动加载硬边界

- 当前协议为 Course Project V9、Published Course V2、Runtime API 2/3 与 Component API 4；不打开或导入 V8 `.h5lesson`，不借 1.1 清理创建 V10。**1.1 V8 清零与主动模块化已经完成**（`v1.1.1` 签署基线）：`editorStore.ts` 是唯一 Zustand composition root。1.9 不重做该迁移。仅当本批命中该棘轮（新增 raw Store consumer、双写、削弱三 Surface／保存／Player／导出）时才补读架构合同第 8 节并按等价 consumer 先迁后删；不得把 1.1 段落读成当前开工任务。
- V9 与 Published V2 保持严格合同。2026-09-15 Owner 对本次1.9改造明确“没有兼容需求”：按[统一正文合同](docs/development-plan/R19_SHARED_DOCUMENT_CONTENT_CONTRACT.md)直接替换Flow文字/公式/相关正文字段，不保留旧text/runs、AST双分支或旧工程转换；新课例/会话/缓存不承担旧格式迁移。正式根Schema、工厂与直接consumer在同一可运行批次切换，未知/旧输入明确失败，不静默剥离或截图降级。其他未涉及域继续遵守原有严格合同；不为本次创建V10，不误删其他Surface仍使用的Native公式能力。
- 2.0 目标：果铃自建统一执行器覆盖编辑、图像与受控构建/导入，可复用成熟基础库；API/允许的 Token Plan 为主，OAuth 可选，文本/视觉/图片模型可组合。外部 Codex、Claude、OpenCode 等经同一 MCP Server 使用工具，不深度嵌入三套原生 Agent。ToolCatalog/Gateway 同源，主进程每文档 DocumentSession 为唯一正式 writer/History；renderer 是投影。普通编辑直接提交，构建/Runtime/Component 保留 staging 和真实准入。2026-09-24 Owner 决定：内置 AI 定位为通用 Agent，权限四档（完全访问 / 完全访问（工作空间，默认）/ 修改前询问 / 只读），完全访问档可读写工作空间外文件，发送前不弹服务说明；档位随任务冻结并由主进程强制执行。以上是待实现目标，不代表当前源码已切换。
- 2.0 会话属于空间且与文件正交，任务冻结文档/选区与授权。文档身份、路径 binding、ViewState 分离；Save As 与复制按新 S02/S09 合同实现。删除旧聊天/缓存迁移、双内核切换和旧用户升级门，保留受支持 V9/Markdown 读取、代码职责迁移地图、崩溃恢复和保存保护。删除会话不删除用户文件，不承诺删除外部 AI 历史。
- Runtime/Component 是可信扩展，外部导入只是分发方式；自动生成的 Component/Runtime 源码必须先留在应用暂存区，经编译、协议、依赖、素材闭包、精确 origin、生命周期、资源上限、静态后备和真实宿主 smoke 自动准入后，才可自动取得当前正式可信扩展已有的宿主能力。自动可信不授予 Provider Secret、原始 Electron Main、任意 OS 命令、未开放远程脚本或未经合同批准的新宿主接口；长期 Provider Secret 不得写入工程、Published payload、组件包或任何导出物。可编辑性由软件登记：Runtime/Component 中的文字与图片由宿主自动识别，不要求 AI 登记文案表、注册编辑目标或加 `data-courseware-edit-key`，也不把编号写进 AI 源码（2026-09-25 Owner 决定的 M15 目标）。M15 交付自动识别前，现有能力说明中的登记要求仍然有效，删除须与自动识别在同一批次切换。
- 产品默认运行在受控团队与受信代码环境；staging硬边界是宿主只摄取当前candidate root内realpath闭合内容，正式工程修改只经canonical transaction，当前未提交的失败/迟到候选零工程写入。2.0 内置构建工具在受控 scratch 写入，正式工程不可旁路写；必须实际落实运行边界。外部 MCP 不限制客户端独立 shell；其磁盘变化不算宿主提交，由 FileService 处理重载与保存冲突。除非信任来源改变，不扩为通用OS沙箱平台。
- 自动化最多证明 `engineering candidate`；真实视觉、互动和教师复核决定 `art candidate` / `accepted`。
