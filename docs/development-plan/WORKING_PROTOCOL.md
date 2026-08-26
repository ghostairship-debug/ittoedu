# 工作协议：精简生产模式（Lean Production Mode）

> 本文是开发执行规则的唯一落点，2026-08-25 起取代 Policy version 2。任务卡格式见 [TASK_CARD_TEMPLATE.md](TASK_CARD_TEMPLATE.md)；状态与字段枚举的执行真相在 `scripts/generate-task-board.ts`，本文是其人类可读镜像，两边必须同步修改。
>
> 设计原则：只持久化会影响后续决策的信息；任务状态只服务并发协调；验证绑定产品候选而不绑定角色；风险决定流程成本；一个任务只交付一个用户行为。无法改变决策、无法阻止冲突、也无法证明产品结果的步骤，不进入生产路径。

## 1. 默认生产路径

```text
确认问题 -> 实现一个行为 -> 最小充分验证 -> product commit -> 合入
```

只有三类活动有产出价值：

1. **实现**一个可观察的用户行为变化，形成一个可整体识别、可回滚且不混入无关改动的 product commit 或紧凑提交组；
2. **风险审查**：命中第 4 节触发器的变更由独立 Reviewer 审查 diff、反例和遗漏风险，不机械复跑作者已执行的命令；
3. **集成/发布门**：在集成或发布候选上补齐尚未覆盖的验证，同一候选、同一命令只执行一次。

纯调查、重复确认、没有 consumer 的预备抽象、仅为改变任务状态而改文档，都不是生产单元。领取和关闭本身不产生独立提交。

实现立项至少满足一项：存在可复现失败；存在真实 consumer；能用当前数据量化维护/复杂度下降；**存在已完成论证的架构性偏差**（有明确技术分析、影响面清楚，即使失败尚未在测试中显形）；**产品 Owner 已决定立项**。可复现失败只是其中一条依据，不是唯一硬门——2026-08-26 Owner 修订该规则，起因是编辑画布/试运行渲染分裂被以"无可复现失败"撤项、随后该失败真实出现。Wave 名称、架构愿景、“以后可能需要”和为了让索引/测试自证更完整，仍不能单独立项——这一句挡的是没有分析的设想，不挡已经论证清楚的已知偏差。调查结果若不能改变实现、裁决或验收，立即停止调查。

## 2. 风险分级（唯一维度）

| 级别 | 典型范围 | 建卡 | Reviewer | 默认验证 |
|---|---|---|---|---|
| **S0** | 文案、注释、孤立文档、无行为影响的小改动 | 否 | 否 | 相关静态检查；未命中 invalidator 不跑产品套件 |
| **S1** | 普通缺陷、局部 UI/逻辑、单一 consumer、可直接回滚 | 默认否；并发/跨会话/交接时才建 | 默认否；命中触发器时升格 | 作者跑 1–3 条 focused checks；CI 在最终 SHA 跑 related checks |
| **S2** | 合同、保存/恢复、历史、Published/Player、main/preload 安全、迁移、删除旧路径 | 是 | 是 | focused checks + 风险专项验证；必要时进集成/发布门 |

S0 硬边界（任一不满足升 S1；命中触发器升 S2）：不命中热点；不改公共 API/合同；不涉及持久化、异步状态、历史、保存恢复；不改用户可见流程或导出；不改会被脚本/Agent/运行时消费的 skill、能力索引或生成输入；影响边界完全明确。

风险级别只决定安全成本，不派生 Task class、Validation ceiling、Validation budget、Reviewer budget 等需要手填的表单。

**不建卡不等于不写验收**：S1 的验收条件与 focused 命令写进请求上下文或 commit/提交组描述。

## 3. 任务卡与状态

**建卡条件**（任一成立才建）：S2；两个以上执行者需并发协调；写入热点（第 5 节清单）；预计跨会话需要恢复上下文；需要交接。

**只为 Ready 工作建卡**：前置尚未满足的未来任务不预建，也不为整个 Wave 填满占位卡。前置完成后再用当时源码事实创建卡；执行中才出现的外部阻断使用 `blocked`。

**状态只有三个**：`queued`（Ready 且目标清楚，未开始）| `active`（有唯一写入者）| `blocked`（记录原因、解除条件、下一决策者）。

完成后**删除卡文件**（一并入实质提交或波次收口提交）；完成事实由 product commit/提交组与 CI 记录承载，不设 done 状态、不做关闭提交。focused checks 通过只表示实现候选完成，不自动等于 wave outcome 或 `accepted`。

**卡片最多 7 项字段**，见 [TASK_CARD_TEMPLATE.md](TASK_CARD_TEMPLATE.md)。`Write scope / Baseline` 是并发边界，所有建卡任务必填。已删除且不得恢复的表单：Policy version、Task class、Necessity/skip condition 固定表单、Complexity delta、Validation ceiling/budget、Reviewer budget、Dependencies/Blocks、claimed/released 时间、worktree/branch、context hash、retry count、固定格式 Evidence reuse / Invalidating paths / Ready checklist / 四态防火墙。必要信息写入 Outcome / Why now 或 Write scope。

交接给较弱执行模型时，仍不增加字段；在现有字段内写清当前失败证据、允许与禁止写入路径、越界停止条件、确定性验收及 1–3 条精确检查。执行者只读卡片点名的源码/测试和相关合同，不从 Wave 标题猜测范围。

**跨会话 S2 真锁例外**：协调器无法持久保存 owner 与热点锁时，修改前持久化一条 `active + owner + baseline + hotspot` 记录（最多一个开始协调提交）。这是防并发写坏的真实锁，不是领取仪式。

## 4. Reviewer 触发器（风险触发，非固定角色）

命中任一条即需独立 Reviewer 并按 S2 处理：

- Course Project V9、Published Course V2、Runtime/Component API 等 schema/contract 变化；
- 保存、重开、自动恢复、历史、撤销/重做、用户数据迁移；
- Published producer、真实 Player、导出语义、发布兼容性；
- Electron main/preload、权限、网络、安全边界；
- 删除旧实现、迁移 consumer、声称"无引用"；
- 同时触碰两个以上热点，或无法维持单写入者；
- 公共 API、异步竞态、stale state、跨进程/跨 Surface 边界存在明显不确定性；
- 自动化无法观察但直接影响用户数据或关键用户流程的风险。

Reviewer 职责：干净上下文独立检查；diff 是否满足验收；构造作者遗漏的反例；检查失败/回滚路径、边界与 consumer；判断已有验证是否覆盖风险。默认复用已有证据，只在证据失效、环境不明、结果可疑、测试不稳或需覆盖不同风险面时补跑。

Schema、用户数据迁移、安全权限、导出语义和最终发布结论仍由产品 Owner 决策；AI Reviewer 只提供技术风险证据。

## 5. 并发模型（三层）

高并发的前提是 Integrator 在派工时先切分互斥写入范围。

1. **调查层——无限并行**：源码定位、consumer 盘点、测试设计、反例审查、characterization 不受数量限制。
2. **实现层——按写入范围并行**：非热点任务并行写入必须使用隔离 worktree/branch、写入范围互斥、开始前由 Integrator 确认；并行数量由可切分的互斥范围决定，不设固定上限。共享 worktree 默认只允许一个产品实现任务写入；一个用户行为只有一个 product writer。
3. **集成层——单写者小批量轮转**：热点始终单写入者；Integrator 批量合并并只补组合风险验证。

热点清单（同一时间每项只有一个写入者）：Editor Store / History；App lifecycle / save / recovery；Workspace / Properties；Published producer；contracts / Schema；main / preload；generated repo-index。非 owner 禁写但可读。

tracked generated index 只有存在 fresh-checkout、产品运行时或自动化真实 consumer 时才统一生成并提交；否则必须是 ignored、可缺省的显式 build output。repo-index 属于后者，只在确有导航收益时手动生成；分支、worktree 或运行时中的 owner 是并发事实，不用领取提交重复表达。

## 6. 验证去重（唯一执行原则）

同一 candidate SHA、同一精确命令、同一相关环境默认只有一个执行责任人：

| 阶段 | 责任 | 不做什么 |
|---|---|---|
| 作者 | 与改动直接相关的 focused checks | 不为证明认真而跑完整门 |
| Reviewer | 审 diff、反例、证据缺口 | 不机械复跑作者命令 |
| CI | 在最终 SHA 上跑 related checks | 不依赖主观预算跳过强制安全检查 |
| Integrator | 只补组合风险和缺失证据 | 不重跑同 SHA 已有效证据 |
| 发布门 | 对最终候选执行完整门 | 不要求历史任务各自重跑完整门 |

同一 SHA 上更高覆盖度的通过结果可替代较低覆盖度证据。可复用证据至少含：来源 product commit/SHA、完整命令与结果、相关环境、实际覆盖的行为/风险、失效条件。S1 直接用 commit 描述 + CI 状态；S2 与门留下可持久读取的简短记录。复用必须证明来源 commit 是当前候选祖先，且其后变化未命中依赖闭包。

同一生成器、同一输入、同一输出在一次写入命令或 focused test 已完成生成与字节/语义比较后，不立即追加同义 `--check`。只有 `--check` 证明不同属性、验证未提交状态，或属于后续独立 CI 门时才执行。Hash/字节比较只用于制品身份或确定性本身属于合同时，不代替行为验证。

**证据失效条件**（出现才重跑）：product source / 相关 test / 夹具 / 测试或构建配置 / lockfile 变化；公共合同或真实 consumer 依赖闭包变化；release/example 生成器、main/preload/IPC 等上游输入改变被验证产物；执行环境变化；上次结果失败/超时/可疑/flaky；diff 命中该验证明确覆盖的 invalidator；集成后出现新组合风险。

纯治理文档、评估报告、任务板状态或不参与产品/自动化输入的索引刷新，未命中相关 invalidator 时不使产品验证失效。但本仓库的合同、skill、能力索引、示例/发布生成输入会被程序或 Agent 消费——不能笼统把 `docs`/`generated` 视为无害，必须沿真实依赖闭包判断。

**完整门时机**：完整 E2E、完整 build、`verify`、打包与 release verification 只在阶段候选、多任务组合出现新集成风险、发布候选或高风险专项要求时执行。修改保存/恢复/历史、Schema/contracts、main/preload、Published producer/Player 的 S2，在后续依赖任务开始前先过对应专项门；多个相互作用的 S2 合并后执行一次 wave gate。门失败创建精确 repair item 或重开直接责任任务，不把整波无差别退回。每个有产品改动的阶段最多一次 phase gate；final gate 只对固定候选执行一次。

Flaky：原命令重跑一次；可复现由当前任务修；随机则隔离建卡，不提高 retry 或弱化断言；baseline 已红先与当前 diff 比较。

**不预建证据平台**：先用 Git SHA、CI 状态和 commit 描述作事实源；只有试运行后仍持续发生昂贵重复验证，才加一个最小机器可校验的 evidence receipt。

## 7. Git 与任务板

保留的提交：product commit / 紧凑提交组；必须与合同/迁移同步落地的安全文档或测试；有真实 consumer 的 tracked generated 更新；阶段结束确有长期价值的计划更新。可重建的本地导航缓存不提交。

取消的提交：领取提交；终态/关闭提交；仅刷新任务板派生字段的提交；逐卡索引提交。任务元数据确需更新时与实质变更同一提交，或波次收口时集中一次。

任务板（`TASK_BOARD.md`）是**当前活跃任务摘要**（queued/active/blocked），不是调度引擎；只在任务集合实质变化时更新。生成器额外做两个廉价并发护栏校验：active 卡必须有 Owner；同一热点标签不得出现在两张 active 卡上。

## 8. 完成定义与最小阅读

**Done**：行为按验收条件可观察；写入范围与热点未越界；focused checks 绿且描述行为而非文件存在；可整体回滚。**不算完成**：Facade 只 re-export 整个 Store；新模块仍 deep import 上帝文件；只移动代码未降低 owner 混乱；测试只断言文件存在；迁移期间双写两份真相。

**最小阅读**：S0/S1 只读请求上下文 + 精确源码/测试；S2 补 [ARCHITECTURE_CONTRACT.md](ARCHITECTURE_CONTRACT.md) 相关节与必要合同。默认用直接源码、合同和目标测试定位；只有能减少阅读量时才显式生成并使用 `npm run repo:context`，低置信、缺缓存或 stale 直接回到源码。默认不读历史任务、整个 `editorStore.ts`、全部 E2E；超大文件按"导入区 → 目标符号 → 直接调用者 → 目标测试"顺序读。

## 9. Legacy 与删除

六分类：Writable duplicate（迁移后删）/ Read-only projection（禁增 consumer、按风险逐个替换）/ Compatibility fixture（评估价值）/ Shared legacy-named primitive（可保留，不凭名字删）/ Historical evidence（接管后归档）/ Dead implementation（完整证明后删）。

**删除八问**：① 静态 import/reference；② 动态、字符串、IPC 或配置 consumer；③ Player/Preview/Export consumer；④ build/fixture/release consumer；⑤ persisted/Recovery/跨版本兼容义务；⑥ 替代路径及其稳定阶段；⑦ 证明替代的目标行为测试；⑧ cache、异步 flush、生成物或安装包是否仍调用。

精确删除目标必须 `consumers=0`；保留项拆成独立 retained 记录（理由/Owner/重访触发）。不可作为删除理由：教师暂时不用、简洁模式不显示、名字含 V8/legacy、文件过大、AI 更常用另一条路径、Catalog 为空、新目录存在但行为未证明。台账唯一真相是 `inventories/legacy-consumers.json`。

## 10. 升级 Owner 的条件

修改 V9 Schema / 创建 V10 / 迁移用户数据；教师能力取舍；用户可见工作流、导出语义或视觉结果变化；付费/重大依赖/网络服务/新安全权限；真实数据损坏风险；性能只能靠能力缩水恢复；最终发布或 `accepted` 结论。用户数据/保存恢复类任务一律使用副本或 fixture。

## 11. 护栏（精简不等于失控）

- Course Project V9 等冻结合同不因流程精简放松；
- 数据损坏、安全权限、迁移、删除旧路径、Published/Player 语义仍按 S2；
- 共享 worktree 默认一个产品 writer；热点单写入者不变；
- 没有可复现风险、真实 consumer、可量化复杂度下降、已完成论证的架构性偏差、也没有 Owner 决定时，不创建实现任务（准入依据全表见第 1 节）；
- 自动化通过最多证明 engineering candidate，用户可见体验仍需真实产品复核；
- 不建 dashboard、数据库、审批状态机或复杂 evidence registry；若某项信息没有帮助协调、审查、验证或恢复，就不加入模板。

## 12. 落地状态与后续流程改进

- 切片 A（本协议 + 7 字段 Ready 模板 + 三态生成器与测试同步）已随 2026-08-25 流程更新落地。
- 原“切片 B”总括路线取消，不把验证去重再建设成平台。当前只执行已有证据支持的 repo-index 减负卡；`prepare:e2e` 拆分、diff classifier、按路径 CI 与 `verify` 嵌套重构均须各自先有稳定复现与量化收益，再单独建卡。
- 量化验收（试运行一轮 S0/S1/S2 后核对）：S0/S1 治理专用提交 0；卡字段 ≤7；同 SHA 同命令无理由重复 0；生成后立即同义 `--check` 0；Reviewer 无新增风险理由的重复验证 0；完整门只出现在真实集成/发布门；热点重叠写入 0；治理操作耗时 S1 中位 ≤5 分钟、S2 ≤15 分钟。
