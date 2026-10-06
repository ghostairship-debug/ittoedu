# 变更日志（时间倒序）

只记录影响产品合同、范围、Owner 授权或工程基线的里程碑；日常实施与评审细节按日期归档于 [development-plan/reviews/](development-plan/reviews/)。权威状态以 `task_registry.json` + `acceptance_cases.json` 同源 JSON 为准，本文不从聊天推断。

## 2026-10-02 — M30-T08 Owner 终局签收，扩展 2.0 闭合

- Owner（产品经理）在日常会话中明确"现在其实可以签收了"，[M30-T08 终局签收](../GPTpro方案/guoling_2_0_execution_plan/evidence/M30-T08-OWNER-SIGNOFF-2026-10-02.md) 落盘。
- 扩展范围 M25–M30 / B19–B24 全部 44 任务 `verified`；241 项验收中 232 项 `passed`、9 项 `not_run`（不计入 2.0 完成门）。
- 同日 R3 收口 starter：[R3_IMPLEMENTATION_2026_10_02.md](../GPTpro方案/guoling_2_0_execution_plan/evidence/R3_IMPLEMENTATION_2026_10_02.md) 报告 M29-T01（真实搜索）、M30-T01（变更审阅逐文件回退）、M30-T02（计划/只读并行/回溯）、M30-T04（跨域综合）通过。
- 不动：旧 38 任务、205 项开发用例、REL 六段、M14-T05 原范围接受保留；`release-preparation` 4 项与 `media-followup` 5 项持续 `not_run`。

## 2026-10-01 — R3 收口 starter

- 启动 R3（最后一轮收口）：聚焦 `task_registry.json` 中残留的 blocked/failed/partial，按"L06 v2 完整前移"边界本地验证；不打新款，不发新凭据。
- 详细执行链与真实运行证据见 [2026-10-02 实施记录](archive/README.md#历史原文)。

## 2026-09-29 — 完整 L06 v2 前移为当前 2.0 最终收口

- 完整 [L06 v2.0](../GPTpro方案/guoling_2_0_execution_plan/long_term/L06.md) 由长期后置前移至当前 2.0 最终闭合；新增 M25–M30（B19–B24）与 30 项验收进入权威登记，旧 38 任务/205 通过、REL 六段、partial 与 M14-T05 原范围接受保留。
- 收敛根方案追加 §7E；本轮只改方案、登记、阅读器与计划维护工具，不改产品、不发模型调用。详见 [归档的果铃2.0收敛方案.md](archive/2.0-历史收敛方案.md) §7E。

## 2026-09-28 — B18 创作链收口

- M25 之前最后一棒：M23 / M24 / M18 整合的 B18 创作链落地——HTML 预览轻编辑、AI 通用工具与框架 HTML 创作链、教学 Skill 切换；见 [AGENT_HANDOFF.md](../GPTpro方案/guoling_2_0_execution_plan/delivery/AGENT_HANDOFF.md) 与任务板 B18 行。
- Rel-T11 与 M14-T05 按 Owner 决策置后置；不进入本轮完成门。

## 2026-09-27 — M18 创作链启动

- M18 启动"教学主题 → 编排 → 框架 → 组装 → 视觉精修"完整创作链：内置 AI 定位为通用 Agent；默认两次确认；明确"自动创作"时全跳过不追问；框架 HTML 为整课分页单文件无素材、按页导入；组装后须视觉精修；删除 8 张旧卡。
- 配套：M17 保真基准已定（React 打包单文件、零静态字、图音 base64 内嵌）。

## 2026-09-26 — M17 HTML 高保真导入

- M17 启动 HTML 高保真导入：把 HTML 当作 LLM 改写的 Runtime，嵌资源进工程、保留静态/行为/数据；不静默剥字段，不丢已支持轻编辑能力。
- 同日 Owner 决策：删 repo-index；新建/打开不问放弃；坏文件不修复是有意；关闭对话框保持；`__proto__` 不支持；接受 T6 守卫放宽。

## 2026-09-25 — S01–M14 基线 verified

- S01–M14 全部工程验收并 frozen 为 2.0 基线 commit `25b12b4b`；后续按收敛方案 §7B/SEQUENCE 整合推进 B13–B18。
- 同日 B13–B18 整合顺序确定，Owner 反馈（快捷条 + 元素级临时 AI 卡、编辑器唯一入口、另存为、会话所属、`.txt`）进入决定 `36c507d4` 并推送。

---

## 关于本文维护

- 新增条目按时间倒序插到顶部；写"是什么结果 + 是谁的决定 + 哪个权威登记/证据承载"，不复制任务卡正文。
- 日期一律使用文件落盘日期；范围变化（新增/收回任务或验收）必须在 `task_registry.json` / `acceptance_cases.json` 同步落条目并跑 `tools/refresh_plan.py`，本文只做指针与摘要。
- 完整过程证据与历史方案见 [archive/](archive/)；本文不替代 Owner 签收记录，也不重新签发任何已 accepted 用例。
