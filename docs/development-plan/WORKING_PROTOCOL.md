# 工作协议：任务、验证与热点

> 本文是开发执行规则的唯一落点。任务卡格式见 [TASK_CARD_TEMPLATE.md](TASK_CARD_TEMPLATE.md)；字段枚举的执行真相在 `scripts/generate-task-board.ts`，文档是其人类可读镜像，两边必须同步修改。

## 1. 角色与优先级

默认一个 Coordinator/Integrator 协调最多三个并行 Worker。Coordinator 维护任务卡状态、依赖、热点锁、合并、回滚与阶段验证；Worker 领取依赖已满足、写入范围互不重叠的最高优先任务。只有 Coordinator 可写任务状态与进入 `integrating` / `wave-validated` / `done` / `rolled-back` / `product-decision`。

优先级：数据安全 > 保存/撤销正确性 > 用户可达回归 > 当前关键路径 > Legacy 减少 > 纯整理。

只有以下情况升级产品 Owner：修改 V9 Schema / 创建 V10 / 迁移用户数据；教师能力取舍；用户可见工作流、导出语义或视觉结果变化；付费/重大依赖/网络服务/新安全权限；真实数据损坏风险；性能只能靠能力缩水恢复；预算超出登记值 50% 以上；最终发布或 `accepted` 结论。

## 2. 风险等级与 Task class

- **S0 局部小修**：极少文件、无公共 API、无 persisted/async/history 影响；Reviewer budget 0；定义上不命中热点。边界不清就升 S1，不加流程补偿模糊。
- **S1 普通跨文件**：公共入口、纯 model/command、Feature 内拆分、少量 consumer 迁移。
- **S2 高风险迁移**：Store/History/Session、保存/恢复、合同、Published producer、Player 会话边界、Workspace/Properties 热点接入、Legacy 删除、任何多智能体热点接入；由 Coordinator 集成。

Task class 描述执行层级，与风险等级不得互相代替：`docs | implementation | integration | wave-gate | phase-gate | final-candidate`。

## 3. Policy v2 必填字段与状态机

每张未完成任务卡以独立单行记录：

```text
Policy version: 2
Risk tier: S0|S1|S2
Task class: docs|implementation|integration|wave-gate|phase-gate|final-candidate
Necessity / skip condition:
Complexity delta: subtractive|neutral|additive-exception
Validation ceiling: V0|V1|V2|V3|V4
Validation budget: N minutes
Reviewer budget: 0|1|2
Evidence reuse:
Invalidating paths:
```

`additive-exception` 必须紧随独立单行 `Additive exception:` 写明首个真实 consumer、替代目标与退出条件；"未来可能复用"、阶段标题、目录整齐不是例外理由。不能证明必要性时执行 skip condition，不创建占位接口/Port/Service/adapter。

状态机：`draft → ready → claimed → characterizing → implementing → target-green → reviewed → integrating → wave-validated → done`；异常态 `retrying / parked / rolled-back / product-decision`。任务卡存放在 `docs/development-plan/tasks/<phase>/<task-id>.md`；任务板由 `npm run generate:task-board` 生成，不可手改。claim 用一个独立提交原子写入 owner/claimedAt/baseline/worktree/locks/retry；执行期瞬态不逐个提交，只有 claim 与终态必须持久提交。

**Ready 条件**（缺一保持 draft）：baseline 与 context 新鲜；dependsOn 已 done/wave-validated；current fact 有源码/合同/测试证据；Goal 是可观察行为；Necessity 是已复现风险、真实 consumer 或可量化复杂度下降；Allowed/Forbidden write 明确且路径存在；命中热点已记录锁且 Owner 唯一；预算已填；Invalidating paths 用最窄路径（implementation 卡禁止 `src/**` 级 broad glob）；1–3 个目标测试已命名；回滚起点明确；无相关用户 dirty change；未触发 Owner 升级。

**任务大小**：默认一个用户行为、一个热点 Owner、一个主要实现提交、1–3 个目标测试。阶段/准入标题只是候选问题域，允许以零张实现卡结束；不为标题补齐 selector/command/Port/目录矩阵。

**停手规则**：需改未授权 Schema/合同；carrier 与合同不一致；需新增 raw Store consumer；需第二个未授权热点锁；current fact 与卡明显不符；用户数据可能被覆盖；目标只能靠双写或能力缩水实现。Worker 提交 finding，由 Coordinator 重拆/park/升级。

## 4. 文件防火墙（四态）

- **Allowed write**：本卡允许修改的精确路径。
- **Required read**：完成正确性所必需读的文件（S1/S2 记录）。
- **Forbidden write**：禁止写入——**不等于禁止读取**；`src/shared/contracts/**` 默认 Required read 而非不可读。
- **Do not read unless needed**：默认不读，需要时可读。

## 5. 验证预算（Task class → 固定 ceiling）

| Task class | ceiling | 允许内容 |
|---|---|---|
| docs | V0 | 文档、链接、任务板/索引 freshness；不跑产品套件 |
| implementation | V1 | 1–3 个最相关目标检查；自动化不能直接观察结果时才补一个最小行为 |
| integration | V2 | 受影响类型/集成验证，最多一条明确命名的 E2E |
| wave-gate | V2 | 受影响回归 + 0–6 条本波关键 E2E（通常 ≤3）；不跑全量 |
| phase-gate | V3 | 每个改产品代码的阶段最多一次完整阶段验证 |
| final-candidate | V4 | 一次完整验证与产物复核 |

ceiling 是上限不是累加清单，只运行覆盖当前风险的最小子集；要更高 ceiling 先重分类，预计超预算先拆卡。普通 implementation 卡禁止无过滤 `npm test`、完整 E2E、`verify`、打包与完整性能矩阵。性能不因"进门禁"自动重跑：只有改动命中热路、测量口径或声明的性能 Invalidating paths 才测，否则复用最近有效证据。

Flaky：原命令重跑一次；可复现由当前任务修；随机则隔离建卡，不提高 retry 或弱化断言；baseline 已红先与当前 diff 比较。

Evidence reuse：Ready 时只定义复用规则，执行后在 Result evidence 绑定实际 commit/命令/结果/环境；只改任务卡、报告、任务板或 generated 且未命中 Invalidating paths 时不重跑产品套件；一个失败只按影响使相关证据失效。Reviewer 查 diff、反例与边界，不重复同一套件；第二 Reviewer 只在双热点或首轮 finding 时启用并覆盖不同风险面。

结果分层：自动化绿 = pipeline pass；边界与 consumer 证据满足 = engineering pass；代表工程真实可用 = outcome pass；教师明确确认 = accepted。

## 6. 热点排他与并行

同一时间只有一个写入者的热点锁：

1. Editor Store / History；
2. App lifecycle / save / recovery；
3. Workspace / Properties；
4. Published producer；
5. contracts / Schema；
6. main / preload；
7. generated repo-index。

非 owner 禁写但**可读**。可并行：不同 Feature 纯 model/command；边界互不冲突的 Surface 内部行为；Published producer 只读时的 format adapter；characterization/fixtures/inventory/unit tests；索引生成与盲测。

S1 建议、S2 必须使用隔离 worktree/branch，一个工作区一张卡。热点接入失败回退接入提交、保留已验证纯模块、在最新基线串行重放，不在热点堆兼容补丁。

预算默认上限：同时 active ≤3 张；一个波次 ≤12 张实现卡（S2 ≤4）；时间盒 ≤10 个 Coordinator 工作日；generated 索引一个波次最多统一重建提交一次；同一任务原 Worker 修复 1 次、独立诊断 1 次、整体设计尝试 3 次。

## 7. 完成定义

**Done 要求**：行为按验收清单可观察；预算与锁未超；目标测试绿且描述行为而非文件存在；semantic/generated 影响已声明；回滚起点可用；Result evidence 绑定实际提交。

**不算完成**：Facade 只 re-export 整个 Store；新模块仍 deep import 上帝文件；只移动代码未降低 owner 混乱；测试只断言文件存在；迁移期间双写两份真相。

## 8. 最小阅读与 Bootstrap

- S0 只读任务卡 + 精确源码/测试；边界不清升 S1，不加仪式。
- S1/S2 补 [ARCHITECTURE_CONTRACT.md](ARCHITECTURE_CONTRACT.md) 相关节 + 必要合同 + 一份 Context Pack（`npm run repo:context`，small 12–20KB / medium 30–50KB / large 70–100KB；S1 默认 medium，仅 S2 跨域用 large）。
- 查询优先级 feature/symbol/path/changed > 自由文本；低置信、stale 或相关 dirty 时显式降级人工 Bootstrap：任务卡与一个相关合同 → 精确类型/函数/Store action/UI 文案 → canonical writer → 一个直接 consumer → 1–3 个相关测试 → 仍不足才扩展相邻模块。
- 默认不读：全部历史任务、整个 `editorStore.ts`、全部 E2E、已删除的历史计划（Git 历史查证据）。
- 超大文件读取顺序：导入区 → 目标符号 → 直接调用者 → 目标测试。

## 9. Legacy 与删除

六分类：Writable duplicate（迁移后删）/ Read-only projection（禁增 consumer、按风险逐个替换）/ Compatibility fixture（评估价值）/ Shared legacy-named primitive（可保留，不凭名字删）/ Historical evidence（接管后归档）/ Dead implementation（完整证明后删）。

**删除八问**：① 还有静态 import/reference 吗；② 还有动态、字符串、IPC 或配置 consumer 吗；③ 还有 Player/Preview/Export consumer 吗；④ 还有 build/fixture/release consumer 吗；⑤ 还有 persisted/Recovery/跨版本兼容义务吗；⑥ 替代路径是什么、稳定经过了哪个阶段；⑦ 哪些目标行为测试证明替代；⑧ cache、异步 flush、生成物或安装包是否仍会调用它。

精确删除目标必须 `consumers=0`；仍需保留的兼容项拆成独立 retained 记录（保留理由/Owner/重访触发），不用"0 或明确保留"的模糊条件。不可作为删除理由：教师暂时不用、简洁模式不显示、名字含 V8/legacy、文件过大、AI 更常用另一条路径、Catalog 为空、新目录存在但行为未证明。

清理顺序链：禁止新增 consumer → 新路径稳定一阶段 → 逐 consumer 迁移 → 兼容入口只读告警 → consumer=0 → 删实现 → 删残留 → 重建索引。

## 10. 文档与索引维护

四类真相：唯一计划（根总纲 + 本目录）/ 任务卡 / Legacy 台账（`inventories/legacy-consumers.json`）/ Schema-源码-测试。一个事实只有一个权威落点；摘要只链接不复制状态。

任务卡报告 `Semantic index impact: none | canonical-update` 与 `Generated refresh: defer-to-wave-gate | not-required`；generated 索引每波最多统一重建提交一次（默认 wave-gate 收口）；`TASK_BOARD.md` 是轻量投影不属于批量 index；Context Pack 不提交（仓库内只允许 ignored 的 `repo-index/contexts/`）。
