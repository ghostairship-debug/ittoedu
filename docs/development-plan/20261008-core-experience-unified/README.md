# 核心体验统一实施包

更新：2026-10-09。首轮分析基线 `423a96dc`，当前方案接手 HEAD `3095ea02`，产品源码 cut `95ce7eaf`；保全后续有效未提交成果。

**Owner 2026-10-09 最新范围：原生 `.glx`、果铃工作台名称／图标、本地 Windows 打包，随后清理可再生文件并整合文档、退役过期 D 盘工作树。§9＋§10 原目标、有效成果和未通过证据保留，不据旧计划自动派发。实际状态只读当前状态，完成事实只记既有结果；不上传、推送或远端发布。** 开发组织按[工作协议](../WORKING_PROTOCOL.md)，唯一事实见[既有结果](REVIEW_RESULT.md#brand-release-cleanup-20261009)，当前剩余见[CURRENT_STATUS](../CURRENT_STATUS.md)。


| 用途 | 文件 |
|---|---|
| 非 Office 近期范围与八个 NI 包 | [EXECUTION_PLAN §9](EXECUTION_PLAN.md#non-office-report-integration) |
| 架构边界、行为基线、Skill 分层与独立验收权限的实现 | [EXECUTION_PLAN §10](EXECUTION_PLAN.md#enforced-capability-methodology)，同一包表 `report_integration_20261008.methodology`；实施与缺口按实际结果记录 |
| 当前存量机械职责覆盖、差额与结构保证机制 | [EXECUTION_PLAN.md §8](EXECUTION_PLAN.md#8-存量机械职责梳理与结构约束owner-2026-10-08-最新范围)，审计/迁移/真实行为分列 |
| 共同业务完整覆盖、当前状态/源码、三端能力、机械移交、结果判定、防回退及防再分叉 | [EXECUTION_PLAN.md §7](EXECUTION_PLAN.md#7-共同业务实质统一与完整创作收口方案) |
| 既有23包及后续S0–S6差额、依赖、唯一共享writer与最低证据 | [WORK_PACKAGES.json](WORK_PACKAGES.json)，实施读 `followup` |
| 下一窗口完整启动指令 | [START_PROMPT.md](START_PROMPT.md) |
| 本计划的独立审查和结构校验记录 | [REVIEW_RESULT.md](REVIEW_RESULT.md) |

接手先读最新用户指令、当前状态及必要任务卡；恢复开发的产品入口为 §0/§9/§10，§8 按相关差额取用。作者模型、费用和真实创作约束保留，不整体继承旧固定开发角色。主执行者直接实现、自检和交付，独审按工作协议 §3.1；只读必要源码与合同，不通读历史，不改 AGENTS。

包表是静态派发输入，不是运行平台或第二任务板。当前规划读 `followup.report_integration_20261008` 及其 `methodology`；机械审计/其他 followup/旧 packages 保留原范围及证据，均不据旧 authorized 字段自动派发。实际运行/候选/评审/集成只在现有任务机制记录；按当前HEAD与有效未提交成果接手，不回退基线。


## 两份最新报告的非 Office 近期整合规划

新增 [EXECUTION_PLAN §9](EXECUTION_PLAN.md#non-office-report-integration) 及同一 `WORK_PACKAGES.json.followup.report_integration_20261008` 将报告与 MECH／原 S0–S6 剩余归并为八包，保留依赖、共享 writer、最低充分验收和 Office 增量暂缓边界。Owner 启动后按就绪切片实施，不另建执行入口。

方法论实现不是另一套治理工程：六项 MTH 横切交付已绑定 NI 包。每个能力交付须留下唯一实现、受保护行为和防旧旁路回来的检查；远端权限未落实不能写成硬约束已启用。长期规则见[工作协议 §1.4](../WORKING_PROTOCOL.md#enforceable-methodology)。
