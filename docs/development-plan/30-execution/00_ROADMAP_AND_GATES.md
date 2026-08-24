# 稳定化路线、阶段门禁与停止权

## 1. 长期决策与状态入口

本路线已获稳定化授权，但不把“拆完所有目录”当作结果。第一目标是保护教师现有课件的编辑、保存、撤销、播放和导出；第二目标才是降低后续修改的耦合与返工。当前阶段、任务状态和下一可领取项只看 [`TASK_BOARD.md`](../TASK_BOARD.md)，本文件不维护静态当前状态。

不做：V10、破坏性 V9 变化、全面重写 Store、三种 Surface 同时接入热点、完整知识平台、每张任务卡跑全量验证、借重构扩建 Code Workspace 或其他产品能力。

## 2. 候选阶段依赖（非当前状态）

```text
ARCH-0A  治理、合法 V9 基线、代表课件与事实矩阵
    ├──────────────┐
    │              │
    └── ARCH-0B  轻量 repo-index、Context Pack 与盲测门禁
                    ↓
ARCH-1   无环边界 + 第一个完整 transaction/history 纵切
                    ↓
ARCH-2   跨 Surface 公共能力：Media / Components / Runtime / Layers / Diagnostics
                    ↓
ARCH-3   Slide / Flow / Spatial 纵向模块化
                    ↓
ARCH-4   Preview / Player / Export 与 Legacy consumer 迁移
                    ↓
ARCH-5   合格删除目标清理、最终工程与人工结果复核
```

ARCH-0A 与 ARCH-0B 并行。二者的最小安全门禁都通过前，不启动广泛的多智能体产品代码施工。ARCH-1 必须先证明一个完整纵切，之后才允许扩到多个 Feature 或 Surface。

## 3. 全局成功指标

- 持久化 Course Project 写入真相为 1；
- 异步或延迟操作写错 project/location 为 0；
- 一个明确用户动作产生一条逻辑历史；
- 已有 V9 字段、判别器和语义变化为 0；
- Slide-heavy、Flow-heavy、Mixed/Spatial 三份代表工程 3/3 可打开、保存重开和播放；
- 适用导出无关键回归；
- 新增公开 raw Store 旁路和跨模块 deep import 为 0；
- 发生迁移时，卡内精确 Legacy consumer 目标下降且不新增旁路；只有明确删除的目标必须为 0，已说明 owner/用途的保留项允许非零；
- 核心操作相对 ARCH-0A 基线原则上不退化超过约定阈值；
- 教师现有高级能力缩水为 0。

阈值在 ARCH-0A 按同一机器、同一代表工程、相同操作固定。没有可靠基线时不伪造精确百分比。

## 4. 阶段退出门禁（phase-gate / V3 ceiling）

Phase gate 的 V3 是允许上限，不是固定全量清单。每个修改产品代码的阶段最多运行一次 phase gate：先复用本阶段 implementation、integration 与 wave-gate 中仍有效的证据，只补被本阶段改动使失效的证据和未被下层任务覆盖的跨系统风险；纯盘点、skip 或文档阶段不因此升级到产品全量验证。每个阶段同时满足：

1. 已准入的阶段产品行为完成；未准入候选项已有可复核的 skip condition 结论；
2. 已创建任务卡进入 `wave-validated`、`done`，或以不阻断后续的 `parked` 记录；没有实现卡的候选域可凭只读盘点和 skip evidence 退出；
3. 目标测试与本阶段实际改动、失效证据及跨系统风险所需的阶段相关验证通过；
4. 三份代表工程只在本阶段实际修改范围需要其流程，或既有证据被改动使失效时运行；其余流程复用仍有效证据，纯盘点/skip 阶段不重跑；
5. 发生迁移时更新精确 consumer delta；热点 Owner 和剩余风险按适用范围更新；性能只在热路、测量口径/工具、fixture、运行环境或已声明性能证据被本阶段改动使失效时复测；未迁移项不要求制造下降数字；
6. 未引入第二份真相、Schema 偷渡或产品能力扩张；
7. 阶段可独立回退；
8. 未解决项已 `parked` 且不阻断下一阶段、满足明确 skip condition，或进入 `product-decision`。

只有 ARCH-5 的 final-candidate / V4 固定执行一次完整验证与发布产物复核；若其 product commit 与仍有效的 V3 证据相同，也只补 V4 特有检查，不重复相同套件或构建。

## 5. 阶段停止权

达到总体稳定化指标后，可以停止后续纯整理型拆分。以下情况立即停止当前路线并回滚最近接入提交：

- 需要修改未授权持久化合同；
- 一个动作仍产生多条不一致历史；
- stale guard 无法阻止错页/错项目写入；
- 新路径必须与旧 Project 双写；
- 为继续工作必须导出完整 Store Hook；
- 代表工程保存重开或播放出现系统性回归；
- 任务只有目录移动，没有降低耦合、风险或返工；
- 连续三次使用同一设计仍无法通过目标行为。

## 6. 结果状态

阶段报告始终分开：

```text
pipeline status     构建、类型、测试、索引
engineering status  边界、consumer、迁移和回滚门禁
outcome status      代表工程的真实编辑、播放和导出
```

自动化不产生 `art candidate` 或教师 `accepted`。
