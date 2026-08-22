# 风险登记与控制措施

| 风险 | 发生方式 | 影响 | 控制 |
|---|---|---|---|
| 双写长期存在 | 新 Core 加入但旧 Store 仍更新 | 随机回归 | 每个迁移任务定义删除条件；同阶段清理 |
| 一次性重写 Store | 修改面过大 | 软件不可用 | selectors→transaction→history→删除，逐步 |
| 模式能力丢失 | UI 简化时删除专业入口 | 产品降级 | Feature Matrix 与模式矩阵 |
| Code 模式旁路 | 直接 setState | Schema/history 失效 | draft→validate→diff→command |
| Component 包与实例混淆 | Catalog UI 直接写实例 | 保存/更新异常 | 四子域拆分 |
| sidecar history 过大 | 全快照 past/future | 内存与性能 | binary delta |
| 投影反向写 V9 | 旧 UI 继续作为真相 | 数据漂移 | legacy-read-only + consumer migration |
| Surface 过度统一 | 万能接口 | 新抽象复杂 | 只统一 Core 合同 |
| 索引成为新事实源 | semantic 过多 | 再次漂移 | 自动生成路径/符号；semantic 只写意图 |
| 图谱过度设计 | 引入 DB/embedding | 维护负担 | V1 JSONL + CLI；阈值后优化 |
| 历史文档污染 | AI 读取过期任务 | 重做/回退 | exclusions + 活跃入口 |
| 验证过重 | 每卡全量 E2E | 开发低效 | V0–V3 分级 |
| 验证不足 | 核心写入只跑 UI 单测 | 数据错误 | 风险映射扩大到 save/reopen |
| 并行冲突 | 多 Agent 改热点 | 语义冲突 | 文件防火墙 + 热点串行 |
| Published producer 分叉 | Preview/Export 各自解释 | 表现不一致 | 单一 producer |
| Schema 被顺手修改 | 内部重构牵连 persisted 数据 | 兼容风险 | Schema 任务独立，默认禁止 |
| CSS 清理误删 | 动态类无法搜索 | UI 回退 | 跟随 Feature、小批删除、目标截图 |
| 性能回退 | selector 每次创建大投影 | 卡顿 | stable selector、按需诊断、测代表工程 |
