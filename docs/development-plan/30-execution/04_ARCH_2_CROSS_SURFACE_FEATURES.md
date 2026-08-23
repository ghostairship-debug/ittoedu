# ARCH-2：跨 Surface 公共能力解耦

前置：ARCH-1 完整纵切通过。目标是把跨 Surface 能力变成可独立维护的 Feature，同时由 Surface 保持正确 carrier/placement。

## 1. 波次顺序

### W2-A 资源安全

- Media：AssetMeta、sidecar bytes、导入/替换 resource plan；
- Components：Catalog、工程包、实例资源、Authoring draft；
- Core History：复用 asset/component delta，逐步降低完整快照。

### W2-B 行为与共享范围

- Runtime / Interactions：typed commands、模板、authoring/Player 分工；
- Global Layers / Teacher Controller：全局单份、surface shared 与有效顺序；
- Diagnostics：structural/contextual/authoring/export 分层，按需计算。

保存/恢复由 App/Persistence 保持 Owner，不在 Feature 中复制生命周期。

## 2. Carrier 规则

- Slide/Spatial/Flow overlay 使用对应 LayerItem；
- Flow 稿纸组件必须是 FlowComponentBlock；
- 全局/共享层保持当前 V9 字段；
- Feature 提供资源或规则，Surface command 决定摆放；
- 任何把所有内容统一为 LayerItem 的设计立即停手。

## 3. 自动并行

每批最多三个 Worker：

- Worker A：一个纯 Feature model/command；
- Worker B：另一个不重叠 Feature；
- Worker C：目标测试、consumer 迁移或性能对比；
- Coordinator：Core/Store/App/Published 热点串行接入。

任务必须按一个用户行为拆卡。不同 Feature 新目录可并行；同一 Store/App/Published 符号不可并行。

## 4. Code Workspace 边界

本阶段只保护现有 DeveloperTab 和已有 Runtime/Component draft 提交，不建设第三全局 Mode，不新增 object/rules 通用编辑器，不扩张 diff/apply 产品范围。若现有草稿接入 transaction，只作为对应 Feature 的一张任务卡，并保持当前用户入口与能力。

## 5. 完成门槛

- 新持久化 Feature command 默认走已证明的 transaction；
- 资源完整 past/future 快照显著减少且有基线计数；
- Flow carrier 无回退；
- 旧 Store/history consumer 数量下降；
- 新 Feature 公共入口窄且有真实消费者；
- 三份代表工程的媒体、组件、Runtime、互动、共享层和控制器适用流程通过；
- 性能不超过 ARCH-0A 约定阈值。

无需为了阶段完成一次迁完所有命令；达到稳定化指标即可把低风险余项留到后续批次。
