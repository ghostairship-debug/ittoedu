# 当前进度与路线图

本文回答"果铃工作台现在走到哪一步、下一步是什么"。历史规划、被取代方案与各轮评估只保留在 [archive/](archive/)，不再视为当前实施清单。详细里程碑时间线见 [CHANGELOG.md](CHANGELOG.md)。

## 当前状态：2.0 已收官

- **2026-10-02：M30-T08 Owner 终局签收完成**，扩展 2.0 范围（M25–M30、B19–B24、30 项新增验收）整体闭合。证据：[M30-T08-OWNER-SIGNOFF-2026-10-02.md](../GPTpro方案/guoling_2_0_execution_plan/evidence/M30-T08-OWNER-SIGNOFF-2026-10-02.md)。
- 旧 38 项任务、205 项开发用例、REL 六段与 M14-T05 原范围接受保留，不替代、不重写本次增量签收。
- 自动化最多证 `engineering candidate`；M30-T08 由 Owner 日常会话中明确"现在其实可以签收了"落盘。

<!-- BEGIN GENERATED ROADMAP_STATUS -->
权威登记（由 `GPTpro方案/guoling_2_0_execution_plan/tools/refresh_plan.py` 从同源 JSON 派生；请勿手改本段）。

当前开发范围有 **44 个实施任务、232 个验收用例**；任务状态：`verified` 44；当前验收状态：`passed` 232；Owner 待验收：无。后续发行准备另有 **4 个用例**（`not_run` 4），未列入当前开发完成门。媒体后续验收另有 **5 个用例**（`not_run` 5），不进入当前完成门。统计来自同源 JSON；`verified` / `passed` 是工程状态，不等于 Owner `accepted`，延期用例也不算通过。

权威状态详情：[GPTpro方案/guoling_2_0_execution_plan/evidence/STATUS.md](../GPTpro方案/guoling_2_0_execution_plan/evidence/STATUS.md)。
<!-- END GENERATED ROADMAP_STATUS -->

## 当前范围之外（不计入 2.0 完成门）

### 发行准备 `release-preparation`（4 项 `not_run`）

| 用例 | 内容 |
|---|---|
| M12-T01 | 无 CLI 的安装包首次使用 |
| M12-T04 | 重装卸载与用户文件保留 |
| REL-T08 | 分发包资产与许可 |
| REL-T10 | 发布前范围核对 |

属发行阶段动作，正式发行前由 Owner 单独签收；不并入 2.0 完成门。

### 媒体/委派跟进 `media-followup`（5 项 `not_run`）

| 用例 | 内容 |
|---|---|
| M29-T03 | 首个语音或视频闭环（供应商与账号未定） |
| M29-T04 | 单执行器有限委派 |
| M30-T05 | T2 多资料研究压缩续接（部分组合未运行） |
| M30-T06 | T3 独立图像交互 HTML（账号/权限边界） |
| M30-T07 | T4 外部工具异步继续 |

### 可选 UI/UX 治理

R3 之后的美学与 rework 不进入 2.0 验收；Owner 后续单独定优先级与范围，不阻塞当前可用性收口。

## 新架构提案（待评审，未启动实施）

- [统一内容架构与重构方案](archive/README.md#历史原文)（2026-10-03）：通用 Agent 与软件职责、Skill/执行方式、Web 与专业节点融合、持续布局、三表面、资产及多格式工作台；包含设计语言、源码迁移工作包和最小验证。当前仅完成方案，不替换现行合同、不改写 2.0 签收与任务状态。

## 长期方向（不进 2.0 完成门）

`GPTpro方案/guoling_2_0_execution_plan/long_term/` 内的方案描述 2.x–3.0 的探索方向；L06 已前移为当前 2.0 收口并交付，下列路线仍在研究期：

- [L02 多格式路线](../GPTpro方案/guoling_2_0_execution_plan/long_term/L02.md)：原格式保真、有限编辑与可视化共编。
- [L03 自有执行器路线](../GPTpro方案/guoling_2_0_execution_plan/long_term/L03.md)：2.0 基线的后续演进。
- [L04 全画布实时共创](../GPTpro方案/guoling_2_0_execution_plan/long_term/L04.md)：过程可见、可干预与协作边界。
- [L05 长尾能力与平台边界](../GPTpro方案/guoling_2_0_execution_plan/long_term/L05.md)：布局、性能、连接器与扩展生态。

未排入当前登记与 DAG，不视为承诺的实现节点。

## 历史归档

| 位置 | 内容 |
|---|---|
| [archive/2026-09-planning/](archive/2026-09-planning/) | 2026-09 各 AI 会话"最短路径"评估、综合核验、技术设计与开发路线历史 |
| [archive/2026-09-worktree-cleanup/](archive/2026-09-worktree-cleanup/) | 工作树清理与分支交接快照 |
| [development-plan/reviews/](development-plan/reviews/) | 历次实施与只读评审记录（按日期归档） |
| Git 标签 `internal-prototype-1.7.0` | 旧 1.6/1.7 二进制、哈希与构建说明 |

归档材料仅作历史参考；当前决策以 [AGENTS.md](../AGENTS.md) 长期授权段、归档 [果铃2.0收敛方案.md](archive/2.0-历史收敛方案.md) 与 `task_registry.json` / `acceptance_cases.json` 同源 JSON 为准。
