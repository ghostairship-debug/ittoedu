# 风险登记册

| 风险 | 触发信号 | 影响 | 缓解/停手 |
|---|---|---|---|
| 旧入口继续派工 | Agent 仍读取旧总纲/任务包 | 两套路线冲突 | ARCH-0A 冻结旧入口；唯一总纲 13.0 |
| 阶段编号撞车 | 出现“执行 P1”歧义 | 重做历史任务 | 只用 ARCH-* |
| Flow carrier 被抹平 | Flow component 被建成 LayerItem | 排版/导出损坏 | 合同测试，立即停手 |
| Core 循环依赖 | Core import Surface/Feature | 模块再次耦合 | DAG 棘轮 |
| 新导航真相 | ActiveEditor 与 CourseAuthoringSession 并存 | 错页/同步 bug | 演化现有 Session |
| stale async write | 切页后导入/代码提交落错页 | 数据损坏 | AuthoringTarget guard |
| history 双写 | 同动作多条 undo | 用户不可预测 | 一条纵切先证明 |
| sidecar 快照内存膨胀 | past/future 复制大文件 | 崩溃/卡顿 | 复用 resource delta |
| V2 主路径回退 | 新代码重新走 V8 projection | 运行/导出退化 | current-must-preserve |
| Legacy consumer 漏查 | 删除后 fixture/release 失败 | 发布回归 | 删除八问 |
| raw Store Facade | 新模块任意读写 Store | 边界失效 | public API test |
| Facade 空壳 | 只 re-export 上帝文件 | 复杂度未降 | narrow API DoD |
| TS7 API 变化 | unstable adapter 构建失败 | 索引卡死 | 薄适配层/spike/ADR |
| repo-index 自过期 | 提交后 HEAD 不同 | 永远 stale | 输入 Hash，不用 HEAD |
| 非确定生成 | 同输入 diff 变化 | CI/合并噪声 | generatedAt null、排序 |
| Dirty 输入漏报 | HEAD 相同但源码变 | Context 错误 | 当前 input hash |
| 外部 Catalog 越界 | 索引声称覆盖外仓 | 定位错误 | 只摄取摘要 |
| Semantic 维护膨胀 | 每文件人工关系 | 新负担 | 只高信号 Feature |
| 任务文档爆炸 | 小修也建完整卡 | AI 阅读噪声 | S0/S1/S2 |
| 多 Agent 热点冲突 | 同时改 Store/Workspace | 合并与回归 | 单一 owner/worktree |
| 过早大搬目录 | move 与行为混合 | 难回滚 | seam 先行、move 分离 |
| 验证过度 | 每卡完整 verify | 速度极慢 | V0-V3 分级 |
| 验证不足 | Core 只跑单测 | 系统回归 | S2/V2 + 代表工程 |
| 测试过拟合实现 | 断言文件/内部结构 | 重构脆弱 | 用户/协议行为测试 |
| UI/IME 回归 | typing/focus/DnD 异常 | 几乎不可用 | characterization + 手工 |
| 性能回归 | Mixed/undo/save 变慢 | 高可用目标失败 | 基线对比，必要时 profiling |
| Schema 偷渡 | 为重构新增字段 | 兼容破坏 | 合同 Required read / Forbidden write；独立 Owner 决策 |
| AssetMeta hash 误加 | 索引 hash 混入工程 | V9 变化 | 明确两类 hash |
| Code Workspace 过度设计 | 借稳定化新增第三模式或新入口 | UI 复杂度增加、偏离软件减法 | 只保护现有 DeveloperTab；新增体验另列产品 Epic |
| 详细计划重复真相 | 多份摘要同时维护状态 | Agent 读取不同当前结论 | 一个事实一个权威；任务板和生成视图不可手改 |
| 自动调度失控 | 多 Agent 同时写热点 | 合并冲突和系统回归 | 1 Integrator + 3 Worker；热点排他锁 |
| 简洁能力不可发现 | 高级项完全隐藏 | 教师误认为没有 | capability map + UI 验收 |
| 误删高级能力 | 以低频为理由删除 | 产品上限下降 | 删除仅针对 Legacy |
| 历史证据误删 | accepted/决策丢失 | 无法审计 | 接管后归档，不先删 |
| Recovery 调用死代码 | 删除后延迟 flush 调用 | 崩溃/数据丢失 | 删除第八问 |
| Generated 合并冲突 | 多分支更新 JSONL | 噪声/错误 | Integrator 重建 |
| 自动化冒充结果 | verify 绿即称发布 | 错误结论 | pipeline/outcome 分离 |
