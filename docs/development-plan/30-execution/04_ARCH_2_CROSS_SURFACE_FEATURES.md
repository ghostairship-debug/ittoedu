# ARCH-2：跨 Surface 公共能力解耦

前置：ARCH-1 完整纵切通过。目标是把跨 Surface 能力变成可独立维护的 Feature，同时由 Surface 保持正确 carrier/placement。

阶段标题只界定候选问题域，不要求把每个名词建设成新抽象。剩余工作先证明可复现用户风险、当前真实 consumer/替代目标或可量化复杂度下降；否则执行 skip condition，允许 ARCH-2 余项以零张新增实现卡结束。

## 1. 候选域与历史波次

### W2-A 资源安全

- Media：AssetMeta、sidecar bytes、导入/替换 resource plan；
- Components：Catalog、工程包、实例资源、Authoring draft；
- Core History：复用 asset/component delta，逐步降低完整快照。

### W2-B 行为与共享范围

- Runtime / Interactions：typed commands、模板、authoring/Player 分工；
- Global Layers / Teacher Controller：全局单份、surface shared 与有效顺序；
- Diagnostics：structural/contextual/authoring/export 分层，按需计算。

保存/恢复由 App/Persistence 保持 Owner，不在 Feature 中复制生命周期。

### W2-B 剩余准入检查（无固定迁移顺序）

- Global Layers / Teacher Controller：只读检查 authoring → save/reopen → Published/Player 的真实纵切。若 ownership/order/单份控制器语义成立且没有待迁 raw consumer，记录无需实现，不新建统一层或 Controller API。
- Diagnostics：只处理已复现的 V8 ownership、错误归因或按需计算债务；不预建 structural/contextual/authoring/export 框架矩阵。
- Save/Recovery：继续由 App/Persistence 拥有。没有具体 bug、第二个真实 consumer 或明确旧入口替代目标时，不抽 Port、Service、session coordinator 或新生命周期。

三个候选域分别按风险和证据准入，可以并行盘点、跳过或按实际依赖排序；一个域无需等待另一个域先建立 seam。新抽象必须在同卡接入首个真实 consumer 或替代指定旧路径；只满足阶段目录、命名一致或未来复用的卡不得进入 `ready`。

## 2. Carrier 规则

- Slide/Spatial/Flow overlay 使用对应 LayerItem；
- Flow 稿纸组件必须是 FlowComponentBlock；
- 全局/共享层保持当前 V9 字段；
- Feature 提供资源或规则，Surface command 决定摆放；
- 任何把所有内容统一为 LayerItem 的设计立即停手。

## 3. 仅对已准入卡并行

Coordinator 按实际存在且写入范围不重叠的卡动态分配最多三个 Worker，不预留“两个 Feature + 一个测试/迁移/性能”配额，也不为占满并发制造卡。调查、纯 Feature 行为、focused tests 或独立 consumer 可以并行；Core/Store/App/Published 热点仍由 Coordinator 串行接入。

任务必须按一个用户行为拆卡。不同 Feature 只有各自通过必要性准入且目录独立时才并行；同一 Store/App/Published 符号不可并行。

## 4. Code Workspace 边界

本阶段只保护现有 DeveloperTab 和已有 Runtime/Component draft 提交，不建设第三全局 Mode，不新增 object/rules 通用编辑器，不扩张 diff/apply 产品范围。若现有草稿接入 transaction，只作为对应 Feature 的一张任务卡，并保持当前用户入口与能力。

## 5. 完成门槛

ARCH-2 的 phase gate 使用 V3 ceiling，而不是固定全量验证：复用本阶段仍有效的 implementation、integration 与 wave-gate 证据，只补被本阶段改动使失效的证据，以及下层任务尚未覆盖的跨 Feature、Surface、保存/播放/导出风险。

- 新持久化 Feature command 默认走已证明的 transaction；
- 若迁移资源快照 consumer，卡内精确 past/future 目标下降且有基线计数；未准入目标不要求为了阶段 KPI 改写；
- Flow carrier 无回退；
- 发生迁移时，卡内精确旧 Store/history consumer 数量下降且不新增旁路；明确保留项可继续非零；
- 新 Feature 公共入口窄且有真实消费者；
- 三份代表工程只运行与本阶段实际修改能力相关、或既有证据已失效的媒体、组件、Runtime、互动、共享层和控制器流程；未失效流程复用原证据，不为 phase gate 固定重跑 3/3；
- 只有本阶段命中热路、性能测量口径/工具、fixture、运行环境或使既有性能证据失效时，才按 ARCH-0A 约定阈值复测适用性能。

完成门槛按本阶段实际修改的能力适用，不要求为未改能力重复实现或逐卡跑全量验证。无需为了阶段完成一次迁完所有命令；达到稳定化指标即可把低风险余项留到后续批次。若余项没有通过准入条件，只读盘点、consumer 证明和至多一次按上述范围执行的 V3 phase gate 足以关闭，不制造实现卡。固定完整验证只属于 ARCH-5 final-candidate / V4，且只执行一次。
