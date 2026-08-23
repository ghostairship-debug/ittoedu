# 术语与状态

| 术语 | 含义 | 状态 |
|---|---|---|
| Course Project V9 | 当前作者工程合同 | current |
| Published Course V2 | 当前 V9 发布合同 | current |
| ProjectDocument / V8-shaped project | 旧作者形状及投影 | current-debt / legacy |
| Canonical document | 唯一可写 CourseProjectDocument | target，局部已成立 |
| Surface | Slide / Flow / Spatial 编辑与运行模型 | current |
| Carrier | 内容在具体 Surface 中的 canonical 容器 | current contract |
| LayerItem | Slide/Spatial/overlay/global 等图层载体 | current；不含 Flow 普通正文 |
| FlowBlock | Flow 稿纸正文载体 | current |
| FlowComponentBlock | Flow 稿纸组件 | current |
| CourseAuthoringSession | location/revision/generation 会话身份 | current，待演化 |
| AuthoringTarget | 事务的稳定 project/location/owner/item target | planned |
| CourseAuthoringScopeToken | global/surface/scene/world owner token | current |
| Surface selection | Slide/Flow/Spatial 局部选择 | current，保持局部 |
| Transaction port | 统一 document/resource/history 提交入口 | planned |
| Resource delta | asset/component bytes 的前后变化 | partial，已有基础 |
| 简洁编辑 | 当前 simple UI 文案对应的低学习成本界面 | current |
| 专业编辑 | 当前 professional UI | current |
| DeveloperTab | 当前专业模式中的 Runtime/object/rules/component 高级编辑入口 | current/preserve |
| Code Workspace | 可能的新增产品形态；不属于当前稳定化必经范围 | optional product epic |
| Code mode | 不作为当前事实；若未来采用仅为 UI 会话态 | undecided |
| Feature Facade | 窄公共 API | planned/partial |
| raw Store Hook | 完整 `useEditorStore` | current legacy API |
| V2 主路径 | V9 → Published V2 → CoursePlayer/Export | current/preserve |
| Legacy fallback | V8 projection/ExportPayload/PlayerApp 路径 | current-debt |
| Structural diagnostics | Schema/引用/包/动作一致性 | current/target V9 migration |
| Authoring analysis | 信息释放、视觉密度等建议 | current advanced |
| Export preflight | 目标格式可用性分析 | current partial |
| repo-index | 编码 AI 开发索引 | planned |
| Context Pack | 按任务生成的小上下文 | planned |
| sourceTreeHash | 严格生成输入 Hash | planned |
| Freshness | 查询时计算的索引状态 | planned |
| Golden task | 用于评估 Context Pack 命中的历史任务 | planned |
| current-must-preserve | 已成立且不可破坏 | semantic status |
| target-acceptance | 阶段完成后应成立 | semantic status |
| transitional-allowance | 迁移期允许、必须带删除阶段 | semantic status |
| engineering candidate | 自动化和工程门禁满足 | current governance term |
| art candidate | 真实视觉/互动复核通过 | current governance term |
| accepted | 教师明确验收 | current governance term |
