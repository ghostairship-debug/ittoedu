# 当前状态与剩余范围

更新：2026-10-06。正式承载 `D:/果铃工作台` / `main`。这是工程事实和已知剩余范围的状态入口；具体任务协调只看[任务板](TASK_BOARD.md)，不将历史卡片或 planned 工作包表示为当前 writer。

## 当前正式实现

| 项目 | 当前事实与依据 |
|---|---|
| 工程格式 | Project V10；[Schema](../../src/shared/contracts/component-platform/schema.ts) 的 schemaVersion=10 |
| 运行发布投影 | Published V3；[源合同](../../src/shared/contracts/component-platform/published.ts) 的 schemaVersion=3 |
| 组件合同 | Component API 5；[当前机器索引](../../artifacts/ai-capabilities/index.json)与[运行合同](../../src/shared/contracts/component-platform/runtime.ts) |
| 正式 writer/History | 每文档 DocumentSession；[Main DocumentHost](../../src/main/workbench/DocumentHostService.ts)注册 Markdown、Text、CourseV10 driver，旧 V9 类型/测试仍有遗留，不构成公开旧工程兼容承诺 |
| 编辑与布局 | Slide/Spatial 自由 frame/编组/顺序，Flow 正文顺序；组件内容、专业数据与程序共用正式定义/实例语义 |
| AI 与外部客户端 | 内置通用执行器；外部客户端经同源 Gateway/HTTP MCP。后台入口已交付，不挂载主 App，观察/导出按需 worker |
| 发布状态 | 发行继续暂停；本页不承诺安装包验收、未配置供应商或新的收费路径 |

## 已记录的验证

[2026-10-06 修复结果](20261006-required-fixes-result.md)记录 L/M/R1–R5 与有界 R6 的具体提交、最小检查和独立 review。零模型 SDK 实际完成创建/应用、局部可编辑修改、保存 revision 4、dirty=false、新 Main 冷开、HTML 输出、attach/detach 与正常 owned stop；受影响最终公开首图和导出画面完整。

同原 rev32/pg4 的唯一实际性能对照为 wall 7.53→3.42 秒、应用 private 采样峰 8.23→4.54 GB、targets JSON UTF-8 17,487,884→38,158 B；不同环境和本批多项变更不允许单变量归因。原作品既有碎片叠层没有在性能包中重做。

[主线归并](20261006-main-consolidation.md)记录候选 125d52fd 的快进与保全；源码未因目录整理重新叠加旧分片，主目录后台启动/只读 SDK/正常退出已验证。

## 仍需明确保留的边界

- 全仓类型和旧测试尚未清零。本批共享 helper 的 8 条直接诊断已消除；App 窄闭包仍有源码遗留，含 inactive V9 observation controller 的 4 条类型漂移；旧 productivity 的 9 个 V9 用例尚未迁移。
- 历史 native trap 根因未完全验证。payload 减量、一次正常观察和释放不等于已消除崩溃或证明长期无泄漏。
- 最新零模型闭环不代替完整三路真实模型创作、完整互动质量或 Owner 对作品/成熟编辑器全部操作的接受。旧任务卡中的未签收范围留在[历史协调记录](../archive/README.md#历史原文)，不据此制造 active 产品任务。
- 旧执行包的发行准备、媒体/账号与外部环境范围保留原决定；当前发行仍暂停。旧已签收范围不迁成 V10 整体通过，新供应商或收费路径也不从旧文档取得授权。

这次文档卫生整理只改变入口、存放位置和状态表达，不增加核验门、不改产品行为、不重跑模型或全量审计。当前无产品写锁的历史卡已退出实际任务板；后续有真实派发再按工作协议建卡。
