# Feature Matrix：当前状态、Canonical Carrier 与目标 Owner

> 当前为 ARCH-0A 人工基线视图；repo-index 落地后由权威模块元数据生成。任务状态不得在本表维护。

状态枚举：`existing/preserve`、`partial`、`missing`、`legacy-consumer`、`planned`。

| Feature | 当前状态 | Canonical data / carrier | 当前主要入口 | 目标 Owner | 本轮动作 |
|---|---|---|---|---|---|
| 新建/打开 V9 | existing/preserve | CourseProjectDocument + archive | App/project/main IPC | App/Persistence | 保护，抽窄编排 |
| 保存/另存为 | existing/preserve | active V9 + sidecars | `currentCourseArchiveData` | App/Persistence | 不重建，补稳定接口 |
| Recovery | existing/preserve | V9 snapshot | RecoveryWriteCoordinator | App/Recovery | 保留 single-flight/cancel |
| 课程树/location | partial | locations/surfaces | ScenePanel/course commands | Core identity + App routing | 收口身份，不新造 projectMode |
| Mixed | existing/preserve | locations/surfaces | course navigation | App routing | 保护 |
| Slide 编辑 | partial | scene.layerItems | Phaser/slide commands | Surface/Slide | 渐进迁移 |
| Flow 稿纸 | partial | FlowBlock[] | FlowWorkspace/flow commands | Surface/Flow | 保留文档流语义 |
| Flow 浮层 | partial | surfaceLayerItems/LayerItem | flow overlay authoring | Surface/Flow | 与 blocks 严格区分 |
| Spatial 编辑 | partial | world.layerItems/camera/path | spatial commands/UI | Surface/Spatial | 渐进迁移 |
| Native 图文公式 | partial | Surface-specific carrier | Properties/commands | Surface + shared native | 不错误统一为 LayerItem |
| 媒体 | partial | AssetMeta + sidecar bytes + carrier ref | App/MediaTab/commands | Media + Surface placement | 原子 document/resource 事务 |
| global/surface layers | existing/preserve | ScopedLayerItem[] | layer commands/UI | Global Layers | 保护入口与有效顺序 |
| 教师控制器 | existing/preserve | global NativeLayerItem | Elements/Nodes/Properties/Player | Teacher Controller | 保持全局单份 |
| Component Catalog | existing/partial | Catalog snapshot，非工程真相 | ComponentsTab/main catalog | Components/Catalog | 当前外部快照 available/4 包，但外部状态可变；空源仍可用，本轮不建远程平台 |
| 工程组件包 | existing/preserve | componentPackages + files | package store/lifecycle | Components/Packages | 统一公共入口 |
| Slide/Spatial 组件实例 | existing/preserve | ComponentLayerItem | Surface commands | Surface placement + Components | 分工不复制生命周期 |
| Flow 稿纸组件 | existing/preserve | FlowComponentBlock | Flow commands | Surface/Flow + Components | 修正原方案模型 |
| 组件 Authoring | partial | Manifest/Runtime draft | DeveloperTab | Components/Authoring | 保留现有 draft/apply 并接 transaction；不扩建新 diff UI |
| Runtime | partial | CourseRuntimeDefinition / RuntimeLayerItem | Developer/Host | Runtime | 保留 API 2/3 |
| 互动规则 | partial | InteractionRule | Automation/InteractionEditor | Interactions | 简洁模板与专业规则共链 |
| 常用动画模板 | existing/preserve | 标准 InteractionRule | Properties/automation | Interactions/Templates | 保护 |
| 简洁/专业模式 | existing/preserve | UI preference | Toolbar/Sidebar | UI Composition | 集中 capability map |
| 现有 DeveloperTab | existing/partial | 专业模式内的受控草稿与结构编辑 | DeveloperTab | UI Composition + Feature editors | 保留现有 Runtime/Object/Rules/Component 能力并接 transaction；不新建入口或第三 Mode |
| 结构完整性 | legacy-consumer | V9 refs/contracts（目标） | projectHealth/CLI | Diagnostics/Structural | 从 V8 health 迁移 |
| 教学/视觉分析 | existing/partial | derived report | informationRelease/visualDensity | Diagnostics/Authoring | 改为按需 |
| 导出预检 | partial | target-specific report | exportPreflight | Diagnostics/Export | 明确格式覆盖，DOCX 不假装已支持 |
| Try-run | existing/preserve | Published V2 | Workspace/CoursePlayer | Preview | 不重建 producer |
| Full Preview | existing/preserve | Published V2 | App/CoursePlayer | Preview | 不重建 producer |
| HTML/Web 主路径 | existing/preserve | Published V2 | export/course | Export | 保护 |
| HTML/Web no-source fallback | legacy-consumer / reachability-unproven | ExportPayload/V8 projection | App legacy branch | Export Legacy | 正常 V9 始终有活动 sources；先证明可达性，不可达则删除，不建 sessionless V9 |
| PPTX/PDF | partial/legacy-consumer | V2/static plan + V8 fallback | export | Export | ARCH-4 交付链 |
| DOCX | existing/preserve（Flow only） | Flow print/doc model | flowDocx | Export | 不扩大范围 |
| AI 产品能力索引 | existing/preserve | artifacts/ai-capabilities | generator/skills | Product Capability Index | 与 repo-index 分离 |
| 编码知识索引 | missing | repo-index | 尚未落地 | Repo Knowledge | ARCH-0B |
| 历史任务/评估 | frozen evidence | Git 历史 / docs reviews | docs/tasks/reviews | Archive | 不再派工；根 dated 方案与评估已移除 |

## 使用规则

- `existing/preserve` 不得被重写任务重复建设；
- `partial` 必须先列已成立部分，再列缺口；
- `legacy-consumer` 是迁移对象，不代表源文件可立刻删除；
- Feature owner 负责业务语义，Surface owner 负责具体 carrier 和 placement；
- 任何矩阵变更要给出源码或合同证据。
- 当前 normal lifecycle 是 exactly-one-active V9 session；不得将 nullable 字段 fallback 链误写为三份同时活动的工程真相。
- 本轮做减法；任何新入口、第三模式或产品能力扩张不进入架构稳定化必经路线。
