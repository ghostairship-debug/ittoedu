# 开发操作参考

治理原则统一见 [DEVELOPMENT](../../DEVELOPMENT.md)。本页只在实际动作需要时读取；历史完整协议见 [整理前快照](../archive/20261027-development-governance/WORKING_PROTOCOL.before.md)，不恢复旧流程。

<a id="refactor-evidence-and-preserved-behavior"></a>
<a id="core-journey-selection"></a>
<a id="shared-business-closure"></a>
## 1. 定位与改动

从用户实际入口、当前稿和直接消费者定位。结构迁移在现有任务说明中写明原责任、目标责任和受影响保留行为；实际基线包含有效未提交成果。保持单一业务 owner，同批接通必要消费者并退出被替代决定，不以 re-export、空 Facade 或第二 writer 收尾。

<a id="enforceable-methodology"></a>
接口、能力说明和实际分发消费者同源更新。产品基础正确性不依赖创作 Skill；生成器已有语义核验时不紧接同义 check。没有产品影响的文档改动只检查入口、链接、生成一致性和范围。

## 2. 何时停止或改道

能决定修改边界就停止调查；目标与可信失败路径覆盖后停止追加验证。新问题只有影响当前承诺或推翻有效证据才扩面。遇产品边界按方法论暂停相关支线；用户明确要求只研究/只整理时不进入产品开发。

## 3. 敏感边界

涉及数据/Schema、History、保存、跨进程异步、Runtime/Player、权限或核心入口时，核对 [架构合同](ARCHITECTURE_CONTRACT.md) 的相关部分、直接调用双方及失败/撤回路径。对真实用户文件用副本；不把“敏感”扩大为全仓矩阵或通读历史。

<a id="independent-structural-review"></a>
### 3.1 独立评审

迁移正式 writer/History/保存/资源所有权、替换成熟核心入口或算法、删除受支持消费者、改变权限或实质削弱验收保护时，由未参与该候选实现的另一执行者审实际 diff、调用者和证据。已批准方案可直接实施，候选交付前完成此审查；新结构选择未定时先核边界。有效评审复用，修正仅补相关差异；风格建议不阻断，作者自检不冒充独审。

## 4. 选择充分验证

| 本次改变的属性 | 首选证据 |
|---|---|
| 局部逻辑/合同/类型 | 最近层真实测试或类型检查 |
| 保存、历史、资源、恢复 | 正式消费者的往返与必要失败反例 |
| UI、视觉、布局、互动 | 对应实际入口与渲染 |
| 领域职责/依赖方向 | 实际调用与现有边界检查，加代表行为 |
| 制品身份/完整性 | 仅这类目标使用 hash/字节比较 |

验证数量由风险决定，不设“最多三条”或固定全矩阵。先看命令过滤和 npm 生命周期，避免局部检查暗中启动全量构建、模型或收费调用。已有相关集成必需检查保留；只有受影响、失败含混或真实集成风险才扩大检查。

不把零匹配、skip、缺报告或只到准备阶段当通过；不删除正确断言、提高重试或改基线洗绿。原测试错误或等价覆盖迁移要说明依据；实质保护变化纳入独审。重试须有新信息或明确瞬时故障依据；无关历史红例记录后返回主线，任务要求恢复的旧能力仍需完成。真实模型验收中不由验证者代写作者作品。

## 5. 协调与任务卡

跨执行者/会话交接、重叠写入或真实阻断才建卡，使用 [六字段模板](TASK_CARD_TEMPLATE.md)。`active` 要有当前唯一 writer；共享实体文件顺序集成，独立叶子可在明确范围内并行。先核旧 active 的实际接手事实，不按日期抢锁，也不让无人执行的历史锁永久阻塞工作。

任务板由 `npm run generate:task-board` 生成，不手改。当前卡完成后删除；未完成目标先在唯一结果/执行方案中承接，历史任务不继续充当当前协调卡。写锁按模板的现有标签表达；`legacy-inventory` 台账单独一个 writer，不另造登记平台。

## 6. 删除与撤回

删除实现前核实际静态/动态消费者、配置/IPC、保存/运行/导出及支持义务；`legacy` 名称或新目录存在不构成删除依据。沿现有 `inventories/legacy-consumers.json` 核查，不另建台账。撤回只针对本批候选，保全原有 dirty、用户文件、人工修改与恢复稿。

Windows worktree 的共享依赖若为 junction/symlink，清理只移除本轮创建的连接，禁止沿连接递归删除真实目录。

## 7. 交付与外部动作

结果只记录一处：改好了什么、直接证据、仍未完成什么、下一步。状态页只在交接或重要变化时写短摘要，计划不复制日志。代码候选、实际用户体验、作品合格与用户验收分别说明。

提交、push、打包发行、部署、新凭据/采购与收费渠道沿当前用户授权，不因旧计划或治理整理自动获得。未经授权不把已有费用范围扩大；开发模型配置不改产品默认。当前有效账号/渠道和限制见 [当前状态](CURRENT_STATUS.md) 的授权参考。

## 8. 中断恢复

`EXECUTION_CHECKPOINT.json` 记录本轮任务、实际修改、验证、进程、日志与下一动作；它不拥有产品数据，也不代替 Git/文件/真实验收。主 Agent 集成任务状态，后台命令由 `scripts/execution-checkpoint.mjs` 自动登记、每 10 秒落盘、结束记录退出码。写入使用排他锁、同步临时文件和原子替换；上一份保留在 `output/execution-checkpoints/previous.json`。

- 新批次首次用 `node scripts/execution-checkpoint.mjs init <batch-id>`，已有状态不覆盖。恢复先 `reconcile`，再 `status`；存活不代表有进展，未知结果不能直接重跑。
- 接续/收口用 `goal-audit` 核对目标与证据；任务通过不自动提升产品完成。目标更新用 `goals <patch.json>`，阶段/产品收口用 `closeout stage|product`；未完条件及后续去向须保留，CURRENT/NEXT只同步该差额。
- 工作单元开始/完成/受阻时调用 `task <patch.json>`；patch 包含 `id`、`status`（pending/in_progress/verified/blocked）、`modifiedFiles`、`changes`、`nextAction`、必要的 `blockers`；verified 必须附 `evidence`。只在重要里程碑同步状态页和执行方案。
- 测试、构建及可独立执行的确定性操作用 `run <spec.json>`：`{"taskId":"T1-check","label":"定向回归","command":["node","node_modules/vitest/vitest.mjs","run","tests/unit/example.test.ts"],"timeoutMs":120000,"nextAction":"核对行为结果"}`。真实 executable/参数数组、无隐式 shell；Windows npm 可通过 `node` 执行 npm CLI。调用立即返回后台 supervisor PID、日志和结果文件，命令不依赖当前工具连接持续存活。
- 单次命令成功只登记 passed，不自动把产品任务标为合格；失败自动受阻并保留日志。已有未结算进程会拒绝同任务重启。子进程丢失时保留 unknown/orphaned，先核对实际副作用；脚本从不自动重放。
- 对没有独立 result、且 supervisor 与子进程均已退出的孤儿任务，完成副作用核查后可用 `resolve-run <resolution.json>`（`jobId`、`note`、`evidence`）结算。它单独保存核查依据，保留 unknown 结果并把任务置为 blocked，不冒充命令成功；新动作须以核查后的真实状态开始。
- 检查点损坏时保留损坏文件后显式 `restore-previous`，随后重新核对 Git、当前进程和日志，不能把回退后的旧记录当作最新事实。此机制减少中断损失，不承诺主模型或聊天断线后还能继续作新判断。
