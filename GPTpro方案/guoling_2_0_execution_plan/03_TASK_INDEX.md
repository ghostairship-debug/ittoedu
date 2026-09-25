# 问题与任务索引

当前修订 v2.1：33 个 S/M 实施任务属于当前开发；验收按 `required_for` 区分当前开发和后续发行准备，延期用例不进入当前完成门。

先读[根目录收敛稿](../../果铃2.0收敛方案.md)。任务依赖/批次以 task_registry.json 为准，验收以 acceptance_cases.json 为准。

## 短期：基础设施

| 编号 | 任务 | 实施依赖 |
|---|---|---|
| [S01](short_term/S01.md) | 开发基线、能力保全与重构边界 | 无 |
| [S02](short_term/S02.md) | 每文档会话内核与视图解耦 | S01 |
| [S03](short_term/S03.md) | 事务、资源、撤销与崩溃恢复 | S02 |
| [S04](short_term/S04.md) | 同源领域工具、短句柄与直接操作 | S02、S03 |
| [S05](short_term/S05.md) | 统一自建执行器与 API、套餐、OAuth 连接 | S04 |
| [S06](short_term/S06.md) | 正文编辑流、源文保真与位置映射 | S03、S04 |
| [S07](short_term/S07.md) | 统一过程事件、运行状态与分段存储 | S02、S05 |
| [S08](short_term/S08.md) | 上下文、附件快照与真实输入编译 | S02、S05 |
| [S09](short_term/S09.md) | 文件服务、路径绑定与系统操作 | S02、S03 |
| [S10](short_term/S10.md) | 空间、独立会话与模型角色配置 | S02、S07、S08、S09 |
| [S11](short_term/S11.md) | 通道性能、分层测试与依赖收敛 | S03、S04、S05、S06、S07、S08、S09、S10、S12、S13、S14 |
| [S12](short_term/S12.md) | 外部 MCP 开放、授权与任务交接 | S04、S07、S09 |
| [S13](short_term/S13.md) | 受控代码构建、修复与正式导入 | S03、S04、S05、S07、S09 |
| [S14](short_term/S14.md) | 多模型图片生成、编辑与资源闭环 | S03、S04、S05、S07、S08、S10 |

## 中期：完整产品体验

| 编号 | 任务 | 实施依赖 |
|---|---|---|
| [M01](mid_term/M01.md) | 默认布局、面板收展与空间利用 | S02、S10 |
| [M02](mid_term/M02.md) | 新建、标签、关闭与多文档生命周期 | S02、S03、S09、S10、M01 |
| [M03](mid_term/M03.md) | 轻量内容区与深度编辑共用内核 | S02、S04、M01、M02 |
| [M04](mid_term/M04.md) | 四表面一致的选区共编与持续高亮 | S04、S06、S10、M03 |
| [M05](mid_term/M05.md) | Markdown 正文编辑、选区与源文一致性 | S06、M02、M04 |
| [M06](mid_term/M06.md) | 正文即时生成、自动替换与撤销 | S06、S07、M05、M07 |
| [M07](mid_term/M07.md) | 独立会话、统一输入框与可见模型配置 | S07、S08、S10、M01 |
| [M08](mid_term/M08.md) | 图片和文件添加、粘贴、拖入与附件状态 | S08、S09、S14、M07 |
| [M09](mid_term/M09.md) | 可展开的完整 AI 过程与任务控制 | S05、S07、S12、S13、S14、M07 |
| [M10](mid_term/M10.md) | 资源管理器完整操作与文件位置同步 | S09、M02 |
| [M11](mid_term/M11.md) | 保存、撤销、冲突、停止与恢复体验 | S03、S06、S09、M02、M06 |
| [M12](mid_term/M12.md) | 首次使用与连接设置 | S05、S08、S10、S11、S12、S13、S14、M07、M08、M09 |
| [M13](mid_term/M13.md) | 现有课件、资源、试运行与导出保全 | S03、S04、S05、S13、S14、M03、M04、M11 |
| [M14](mid_term/M14.md) | 整体可用性、长会话与无障碍收口 | S11、M01、M02、M03、M04、M05、M06、M07、M08、M09、M10、M11、M12、M13 |
| [M15](mid_term/M15.md) | Runtime／Component 轻编辑与自动图文发现 | M14 |
| [M16](mid_term/M16.md) | Flow 混合画布、自由原生图层与页面 Runtime | M15、M05、M13 |
| [M17](mid_term/M17.md) | HTML 高保真机械导入与 Runtime 承载 | M15、M16、S13 |
| [M19](mid_term/M19.md) | Slide 有限画布尺寸参数化 | M17 |
| [M18](mid_term/M18.md) | 理想呈现后置的 Representation Planning 与创作链 | M15、M16、M17、M19、S14 |

## 长期：2.x–3.0

- [2.x–3.0｜完整 AI 工作台的产品方向](long_term/L01.md)
- [多格式路线｜原格式保真、有限编辑与可视化共编](long_term/L02.md)
- [自有执行器路线｜2.0 基线与后续演进](long_term/L03.md)
- [全画布实时共创｜过程可见、可干预与协作边界](long_term/L04.md)
- [长尾能力与平台边界｜布局、性能、连接器和扩展生态](long_term/L05.md)
