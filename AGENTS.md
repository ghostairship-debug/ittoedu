# 果铃仓库开发与内容任务入口

## 授权与当前方向

Future changes to this file require Owner confirmation.

Owner 2026-10-07 已确认本次启动文档瘦身：合并重复、按任务读取，既有权限与费用边界保留；不因此启动产品开发。具体实施阶段以当前用户指令和[当前状态](docs/development-plan/CURRENT_STATUS.md)为准。发行继续暂停，解除须 Owner 决定。

已批准统一组件、独立 V10/Published V3/Component API 5、无旧兼容及可替换编辑投影。后续实施细化不重复审批；旧计划、签收或历史“暂不实施”不替代当前授权。新凭据、采购、管理员安装、未授权付费路径、迁移真实用户数据或新的产品能力取舍仍交 Owner 决定。

## 长期原则

- 用户能完成核心操作并得到正确、可编辑、可保存、可重开、可运行/交付的结果优先。当前不可用、可见错误和明显性能退化优先于维护、合规准备及纯预防风险；真实安全漏洞、法律发布阻断和数据损坏另明确报告，不虚升定级。
- 选题从用户操作和结果出发，合同/源码用于定位断点。消除真实根因、保持单一 owner；规模服从问题，不以最小 diff 为目标，也不为假设风险建设平台、双轨状态或兼容层。必要职责调整可以做，单纯“更清晰/方便以后扩展”不足以扩面。
- 只做最低成本的充分验证；有效证据未受相关变化影响就复用，通过即停。额外检查、重跑、抽象和等待必须有信息增益；新增测试/fixture 红灯不自动改写全局目标。不跑机械全矩阵，不以审查者更换或压缩上下文为由重验。Hash/字节比较只证明合同要求的身份、完整性或确定性。
- 非必要不加核验门，既有门也核对当前保护属性。能解析、保真承载、保存和使用的 AI/用户内容先接入；局部缺口保留原件和可修输入，明确诊断，不整份拒绝或静默静态化。身份、登记、编号和机械装配由软件处理，不强迫模型固定格式或簿记。
- 保全用户改动、未提交成果和人工布局。模型负责意图与内容，软件负责身份、事务、History、资源及保存。普通修改入工程/恢复稿，保存按用户要求落盘；删除会话不删除用户文件。自动化工程候选不等于真实视觉、互动或 Owner accepted。

## 按任务读取

已在上下文注入的本文件不重复全文打开；相关内容发生变化时再核对。链接是导航，不是开工通读清单。

- 启动读[开发入口](docs/development-plan/README.md)与当前用户指定的执行入口；主会话读[当前状态](docs/development-plan/CURRENT_STATUS.md)，本批问题只读对应段落。子智能体接收本包结果、范围、必要约束和直接源码，不重复主会话全部历史。
- Root 在实际派发/接手前查[任务板](docs/development-plan/TASK_BOARD.md)及相关卡；计划、派发、运行、候选/提交和完成分开，不将 planned 写 active。就绪非重叠工作并行，共享实体文件单 writer。
- [工作协议](docs/development-plan/WORKING_PROTOCOL.md)按动作取用：选题/收口 §1–2，重要结构独立 review §3.1，验证 §4，并发/任务卡 §5，删除 §6，Git/交付 §7；无需每次全文读。重要结构候选不能作者自审，未变有效评审不重复。
- Schema/持久化、Surface/图层、教师控制台、Published/Player、Runtime/Component、网络、导出或稳定身份变化，行动前补读[架构合同](docs/development-plan/ARCHITECTURE_CONTRACT.md)相关条目及直接 producer/consumer/目标测试，不通读整个合同或历史任务。正式格式/源码决定当前 consumer，用户决定目标。

## 正式内容与执行边界

- 果铃 Schema 是作者语义；GrapesJS/ProseMirror 是投影。Slide/Spatial 保留自由 frame/编组/顺序，Flow 保留阅读顺序，组件内部自排版。局部修改不重排整页；HTML/CSS 仅在新建或明确重做的自由范围测量装配。
- 复用专业算法、DocumentSession、资源/保存/文件服务及成熟 UI；不重造算法或第二 writer/History/工程。Phaser 仅用于局部游戏/模拟。默认组件共享预置实现，局部源码按需内存解析/转译/缓存；不以逐实例编译、磁盘打包、静态 fallback 或人为预算阻塞可用内容。
- 内置 Agent 通用，外部客户端经同源 Gateway/MCP；四档权限、冻结目标/授权、文档身份与路径/ViewState 分离。正式修改只经 canonical transaction。唯一 writer、最终 CAS、停止屏障、授权根和真实未知副作用查证因防已知错写/重放而保留，不扩防御平台。
- staging 仅摄取当前 candidate root 内 realpath 闭合内容。Provider Secret 不得进入工程、Published、组件包或导出；组件不得获得 Provider Secret、原始 Electron Main、任意 OS 命令或未开放宿主 API。外来代码不继承文件/登录权限，复用现有 origin/权限边界。外部 MCP 客户端独立 shell 改磁盘不等于正式提交，由 FileService 处理。

## 真实模型与费用

- DeepSeek 文本/视觉/规划/工具验证已有授权：主 TeamoRouter（`teamorouter`，`https://api.teamorouter.com/v1`），第二 DeepSeek 官方 API，适用 S05/S06/S11/S13/S14/REL 及当前明确用例。首选精确请求别名 `deepseek-flash`；核供应商目录/实际响应、能力与计费，不混成 `deepseek-v4-flash` 或以 dsh 列表代替权威目录。运行时读 `TEAMOROUTER_API_KEY`/`DEEPSEEK_API_KEY`，产品凭据用安全存储，开发设置与产品默认分开。
- 首发 GPT OAuth 已授权当前账号正式登录、生图和编辑验证；授权不等于通过，记录真实执行者/模型/费用及实际结果。未变有效证据复用，不重复索账号。独立图片 API 供应商/账号待定，非 B05 前置；不切换新收费路径。
- 外部 CLI 授权仅用于 S12-T01/M12-T05 等确需客户端的用例：Codex/OpenCode 只用 Luna，Claude 只用既有 DeepSeek；先核脚本和实际路由/模型。当前另获授权的 MCP/裸 HTML Luna 创作按本轮执行入口，不混为 CLI 全矩阵。无法确认先做不收费检查；不重复同因付费、升级模型掩错，exclude/skip/零匹配不算通过。

## 内容任务 Skill

只在实际创作/改作品时按需用；产品开发不加载教学方法，通用系统提示词不写教学策略。Skill 能力与已交付工具一致，机械装配不增必读 Skill 或阶段门。

- 新作品：[orchestrate-courseware](.agents/skills/orchestrate-courseware/SKILL.md)。教学策划→工程内框架→素材/互动→关键页检查→交付；策划保存 `<课名>/01-教学策划.md`。策划/框架默认确认，已授权自动推进则不等待但照常产出。框架后正式工程是唯一作品；导航/缩放默认宿主管，教师明确要求时可改控制台或自写导航；复杂模拟用独立组件，不默认全课截图精修。
- 已有作品：[edit-content](.agents/skills/edit-content/SKILL.md)，保留未选内容和人工调整，不改外部整课 HTML 再重导覆盖。素材优先用户/资产库，示意图用 SVG，照片取授权图库，图像用已配置连接；不能以占位交付核心内容，未知能力如实说明。
- 仅外来 HTML 保真导入：[build-courseware-project](.agents/skills/build-courseware-project/SKILL.md)，保留原件与局部诊断，不作新课创作中转。Office、模型连接、浏览器继续复用既有服务，不借本轮重写。
