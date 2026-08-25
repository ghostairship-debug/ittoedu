# IttoEdu 开发总纲

> 计划版本：14.0（2026-08-25 文档整合：历史阶段叙事移除，规则收敛到 docs/development-plan/ 四份整合稿）
>
> 当前活动路线：第 5 节"工程修复准入（REPAIR）"
>
> 产品 Owner 决策现状：架构稳定化与 2026-08-24 审计的 29 项修复已收口为 owner-waived `engineering candidate`（打包与性能测量按 Owner 决定豁免，记录为未执行项）；教师 `accepted` 只保留为最终产品与发布结论。既有 V8 课例与历史开发产物均为测试用途、无保存必要，已随文档整合清退。

本文件是仓库唯一长期开发总纲。详细规则统一在 [docs/development-plan/](docs/development-plan/README.md)：[架构合同](docs/development-plan/ARCHITECTURE_CONTRACT.md)（什么不能坏）、[工作协议](docs/development-plan/WORKING_PROTOCOL.md)（怎么干活）、[任务卡模板](docs/development-plan/TASK_CARD_TEMPLATE.md)、[修复方案](docs/development-plan/REPAIR_PLAN.md)（当前路线的详细证据与批次）。历史阶段合同、审计报告、评估与已终态任务卡由 Git 历史保存，不再作为派工入口。

权威顺序：

```text
用户当前明确决定
> 正式 Schema、合同与兼容策略
> 当前源码和可复现运行结果
> 本总纲
> docs/development-plan 详细执行文件
> 自动生成的 repo-index 与任务板
> 历史材料（Git 历史）
```

索引、计划或任务卡与源码冲突时，先修正索引或任务卡，不按过时文字强改代码。

---

## 1. 产品目标

目标不是继续增加功能数量，而是把已有能力变成真正可用、稳定、可维护的软件：

- 编辑结果可信：不会写错课件、错页面或错对象；
- 撤销、重做、保存、恢复和资源文件保持一致；
- Slide、Flow、Spatial 与 Mixed 往返稳定；
- 试运行、整课预览和各导出读取同一份课程事实；
- 高频作者行为必须在真实 Chromium / Electron 中可完成，不能用 Schema、jsdom 或样式字符串通过代替真实选区、命中、布局和媒体结果；
- 所有公开控件、拖拽承诺和成功反馈必须对应真实 canonical 工程变化或真实可用能力；未接通时必须隐藏、禁用或明确说明；
- 面向 AI 的契约（能力索引、无界面校验、开发索引）必须与实现一致，不得有假声明；
- 软件内部重复状态、重复路径和无消费者旧实现持续减少。

本产品是 AI-native 轻量课件编辑器：工程/语义检查的主要消费者是 AI（CLI 与无界面链路），人类可视化诊断面板不再投入增强（Owner 裁决，2026-08-25）。

## 2. 当前产品与协议边界

- 作者工程：Course Project V9（软冻结；additive 可选字段独立合同提交并保持 `.strict()`）；发布：Published Course V2；Runtime API 2/3；Component API 4；Interaction Protocol V1。
- 不恢复 V8 `.h5lesson` 导入，不借内部重构创建 V10。
- 当前编辑器内没有可见 AI、聊天、Provider 或网络调用；internal/reserved 接口不得宣称为可用工作流；编辑器内 AI 统一延后到 2.0 以后。
- 教师控制器只在"全局层（全课）"持久化编辑；页面作者态 inert；运行态拖动只写 Session。不实现逐页/逐 location 控制器位置。
- 打包分发当前不是交付目标；恢复打包时须随新的固定候选补齐打包、性能与签名证据。
- 其余现状硬约束（由原 35 条合并的 24 组 must preserve、模块 Owner、carrier 矩阵、棘轮）见 [架构合同](docs/development-plan/ARCHITECTURE_CONTRACT.md)。

## 3. 统一架构的不变量

1. **一个可写工程真相**：所有持久化编辑最终只修改一个 `CourseProjectDocument`。
2. **恰好一个活动编辑会话**：Slide、Flow、Spatial 三种后端互斥激活。
3. **一次用户操作，一次逻辑提交**：文档、素材字节和组件资源同步进入一条撤销历史。
4. **延迟操作必须认原目标**：异步回调不能在切页后写入新页面。
5. **Surface 保留各自语义**：Slide 用 LayerItem；Flow 正文用 FlowBlock / FlowComponentBlock；Flow 浮层和 Spatial 世界用各自正确载体。
6. **Preview/Player/Export 只读**：不从 Player DOM、Canvas 或 Published payload 反建作者工程。
7. **Core 不依赖具体 Surface**：跨模块动作由应用用例组合。
8. **不新增第二套 Store、Session、History 或持久化模式**。
9. **不以目录移动证明解耦**：只有责任、消费者和返工实际减少才算完成。
10. **已有教师能力不得缩水**：低频能力可渐进披露，但必须可发现、可保存、可撤销。
11. **作者与交付的有效域必须闭合**：作者端允许保存的状态必须被 Preview、统一画布、Published Player 和适用导出接受。
12. **公开入口必须诚实**：禁止静默 no-op、伪成功和底层校验 JSON 直出。
13. **面向 AI 的契约必须诚实**：能力索引声明的检查、文档路由和能力状态必须与实现一致。
14. **控制器作者范围唯一**：页面 inert、全局层唯一持久化入口、运行态只写 Session。

---

## 4. 执行与验证

开发默认由一个 Integrator 协调最多三个 Worker 自动拆解、并行、验证、修复和回滚；角色分工、S0/S1/S2 风险分级、Policy v2 任务卡字段、文件防火墙、热点排他锁（Editor Store/History、App 保存恢复、Workspace/Properties、Published producer、contracts/Schema、main/preload、generated repo-index 各自单写入者）、验证预算（Task class → 固定 ceiling，V0–V4）、Done 定义、Legacy 删除八问与升级 Owner 条件统一见 [工作协议](docs/development-plan/WORKING_PROTOCOL.md)。

要点：每张卡 1–3 个最相关目标检查，只有自动化不能直接观察结果时才补一个最小真实行为；完整 E2E、打包与 `verify` 只在阶段门或最终候选运行；失败不得通过弱化断言、无限 retry 或第二套数据掩盖；自动化最多证明 `engineering candidate`。

---

## 5. 当前活动路线：2026-08-25 工程修复准入（REPAIR）

详细证据、逐码分类、批次估算与否决路线见 [修复方案](docs/development-plan/REPAIR_PLAN.md)。本节收录处置方向与准入边界，不维护实现状态；每项工作拆成任务卡写入 `docs/development-plan/tasks/repair/**` 后由任务板承载状态。本轮修复不含 skill 重构、黄金样例课例、真实课例生产与任何新产品能力（含声明式数据条件/行内公式），不修改 V9 Schema。

已随 2026-08-25 文档整合完成：`CAP-02`（能力索引 authoring 文档路由改指当前 skill 入口）、`CAP-03`（catalogStatus 手写快照不再复制可变值）、`HYG-04`（courseware-cases 9 个死链转发 script 与 README 历史课例段删除）。

| 修复项 | 计划结果 | 准入与边界 |
|---|---|---|
| `CAP-01`：能力索引 `project-health` 假声明 | `validate:project` 的 projectHealth 通道内容与能力索引声明一致 | Owner 已确认直接以 `SEM-B0` 兑现，不走窄声明止损 |
| `SEM-B0`：schema issue 未入 projectHealth 通道 | V9 Zod issue 按 path 映射为对应 `project-health:*` 码进入 CLI 报告；2 个纯 V8 码显式退役 | 第一波；零新增语义逻辑，不放宽 Schema |
| `SEM-B1`：V9 交付链离线合规零检查 | `inspectSourceNetworkUse` 等形状无关纯函数上移共享，4 个外联码接入 CLI 与 V9 导出预检 | 第二波；安全性回退修复，优先于其余语义码 |
| `SEM-B2`：语义分析器 V9 化（22 个零合成语义码） | 新建 `collectCourseProjectHealth`，以 CLI 接线为主战场（Owner 裁决：检查主要服务 AI）；GUI 面板仅做防错误信息的最小数据源对接，不投入可视化增强，定位路由重写取消，面板简化或退役拆卡时单独确认 | 第三波；新码一律 warning 落地，提级单独裁决；迁移前后诊断数对照表为验收材料 |
| `SEM-B3`：合成依赖的 6 码 | 新建 `src/shared/courseComposition.ts`，与 renderer 投影/Player 行为一致（契约测试为硬门），禁止 import renderer | 第四波 |
| `SEM-B4`：富导出预检困在 V8 形状 | 排版/对比度/画布几何/密度按 surface 类型分派迁 V9；画布几何仅 Slide 适用 | 第四波；`asset-unused` 等 2 码缓办 |
| `EXA-01`：示例工程为 V8、`verify:release` 必败 | `build-examples.ts` 迁 V9 工厂/归档；发布验证改用 `openDefaultCourseProject` 并真实跑通打开示例 | 第一波；否决 V8 编写 + migrate 兜底路径；示例只重新生成，不迁移旧内容 |
| `EXA-02`：`pretest:e2e` 无条件重写 tracked 生成物 | pretest 不再重写 examples；新增 `refresh:examples` / `check:examples`，语义漂移经显式刷新与 review 进库 | 第一波；连续两次 pretest 后工作树必须干净 |
| `EXA-03`：3.86 MB 内嵌 player HTML 等三个 diff 放大器被 tracked | render-host-benchmark 的 HTML/`project.json`/three runtime 转 ignored，测试改读现生成路径 | 第一波；否决"tracked + 全字节确定"路线 |
| `EXA-04`：旗舰示例 photosynthesis 为 V8 | 迁 V9 + Published Course V2 页面，E2E 选择器同步 | 第二波 |
| `EXA-05`：incline-motion 孤儿链 | 退役删除脚本与产物，legacy 台账减项 | Owner 已裁决删除（2026-08-25） |
| `EXA-06`：render-host-benchmark 工程与页面仍为 V8/Published V1 | V9 + Published V2 重建，场景 runtime 映射为 `RuntimeLayerItem`，配套测试重写 | 第四波 |
| `PRJ-00`：投影冗余计算与每按键全量投影 | 删丢弃计算、拆 ×2/×3 重复、以 `history.present` 对象身份做 size-1 memoize、Spatial 按键路径不刷新投影 | 第二波；禁止用 revision 数值作缓存键；不迁移任何消费者 |
| `PRJ-01`：投影域校验缝隙 G-1～G-6 | Slide 编辑态预览 payload 前置 `safeParse` 降级门，失败给出具体原因 | 第二波；逐条根治随渐进退役自然消亡 |
| `PRJ-02～05`：V8 投影渐进退役 | 浅字段→分析器→ViewModel→Workspace/预览管线四批迁移；棘轮白名单每批只减不增 | 第五波条件准入；预览管线归属 Owner 已裁决方案 A（编辑态与试运行统一为同一套 V9 Published 宿主，authoring patch 协议移植过去；保持 Runtime Authoring 原位编辑路线） |
| `HYG-01`：Flow 拖选修复靠内联样式 | `user-select` 下沉为 CSS 规则，对齐既有先例 | 第一波 |
| `HYG-02`：8 处裸 `'未变化'` no-op | 区分"值未变"与"未接线"，前者给具体原因、后者 `ok: false` + 字段名 | 第三波 |
| `HYG-03`：order 分配 O(n²) 批量路径 | 批量场景一次性分配器；单次路径不动 | 第三波 |
| `HYG-05`：已退役保真门的本地残留 | 清理 `output/editor-preservation/` 与陈旧 logs，记录退役事实 | 第二波；不修复、不复活 |
| `HYG-06`：6 分钟 Electron 用例混入 `npm test` | `coursewareAuthoringRunner` 的真实 Electron 用例移入 E2E 套件；脚本本体与 `--verify-report` 防伪入口保留 | 第二波；`run-courseware-authoring.ts` 是纯 V9 端到端交付验证器 |

执行顺序：第一波（契约与止血：CAP-01/SEM-B0、EXA-01～03、HYG-01）→ 第二波（安全合规与性能：SEM-B1、PRJ-00/01、HYG-05/06、EXA-04/05）→ 第三波（语义主体：SEM-B2、HYG-02/03）→ 第四波（合成与预检收口：SEM-B3→B4、EXA-06）→ 第五波（投影渐进退役：PRJ-02～05，按证据准入）。四波估算合计约 34–47 人日，第五波约 24 人日另行准入。新语义码默认 warning 落地、提级单独裁决。

明确排除：CLI 复用 V9→V8 投影喂旧分析器、tracked 生成物全字节确定化、revision 数值缓存键、`migrateProjectV8ToCourseProjectV9` 兜底 examples、复活 `verify-editor-preservation`、新建 eslint/图数据库/第二套依赖检查、无消费者证据的大规模文件拆分、新语义码直接 error 落地、GUI 诊断面板可视化增强，以及任何夹带范围外能力的修复卡。

## 6. 修复波成功门槛

- 能力索引声明与 CLI 实现不一致处：0；
- 连续两次 `pretest:e2e` 后 `git status --porcelain` 非空：0；
- `verify:release` 在"GUI 打开示例"段失败：0；
- V9 交付链对组件/运行时源码外联（`fetch`/`XMLHttpRequest`/`WebSocket`/外链）无检查：0；
- 中等工程文本输入路径的投影重算：从每按键 2–3 次全量降到 0 次（draft 期间不刷新投影）；
- "V9 作者态合法、Slide 编辑态预览拒绝"出现时：给出具体原因的降级提示，不再是通用 Payload 错误；
- 公开命令返回裸 `'未变化'` 且语义不明处：0；
- 新增语义码以 error 落地阻断既有工程导出：0；
- 已有教师能力缩水：0；热点并行写冲突：0。

## 7. 修复完成后的方向

修复波收口后，产品侧的下一步（skill 重构、黄金样例、真实课例生产、声明式数据条件等表达能力合同、编辑器内 AI）由 Owner 按当时证据另行启动，不在本总纲预填施工配额。历史机制说明：表达能力类合同沿用"3 份真实课件证据重开"的准入模式。

## 8. 当前状态与领取入口

当前任务状态、依赖与下一可领取项只看自动生成的 [任务板](docs/development-plan/TASK_BOARD.md)；任务板没有合格实现卡时，按准入规则允许只读盘点、满足 skip condition 或直接进入适用门禁。修复工作使用 `docs/development-plan/tasks/repair/**` 的新卡承载。

历史纪要：ARCH-0A/0B（治理与 repo-index）、ARCH-1（首个事务纵切）、ARCH-2（跨 Surface 公共能力）、ARCH-3（Surface 模块化）、ARCH-4（交付链收口）、ARCH-5（清理与最终候选）、2026-08-24 深度审计的 29 项稳定化，均已终态收口；阶段合同、门禁报告、审计原文与全部已终态任务卡由 Git 历史保存。
