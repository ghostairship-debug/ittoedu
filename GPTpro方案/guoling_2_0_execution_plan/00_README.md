# 果铃工作台｜2.0完整收口实施方案

> **当前入口（2026-10-02）：** 本执行包已全部 verified 并作为历史实施规格存档。当前 2.0 收口完成事实与下一步（发行准备 + media + ACP + 长期方向）以 [ROADMAP.md](../../docs/ROADMAP.md) 为准；长期技术合同见 [docs/development-plan/ARCHITECTURE_CONTRACT.md](../../docs/development-plan/ARCHITECTURE_CONTRACT.md)。

**当前修订：执行包v2.5 · L06 v2.0 · 2026-09-29。** 先读[归档的根目录收敛方案§7E](../../docs/archive/2026-09-convergence/果铃2.0收敛方案.md)，再读[L06完整技术方案](long_term/L06.md)。L06虽然保留long_term路径，已经整体前移为当前2.0最终闭合项。

## 当前范围与状态

Owner要求整合各轮架构/过度防御/体验核查和四项使用故障，形成可直接实施方案。本轮只改方案、任务/验收定义、派生阅读器及计划维护工具；不改产品、用户配置和课件，不登录或运行付费测试。

旧38项S/M任务和205项开发用例的通过记录保留；REL六段修复续接、首轮失败、最终partial及M14-T05原范围接受不重写。新增M25–M30均planned，30项新增验收均not_run；旧范围接受不等于扩展后的2.0闭合。最终须M30-T08 Owner增量签收。

| 当前完成批次 | 任务范围 |
|---|---|
| B19/M25 | 窗口、会话恢复/标签关闭、HTML尺寸及Player兼容、受管载体保全与课件副本修复 |
| B20/M26 | 两Provider恢复、相关观察/句柄、真实终态、截图Pruning与落盘热路径 |
| B21/M27 | 原A1–A5及A6：通用文件/材料、轻改、工作记录、用户Skill、工具与Batch连续性 |
| B22/M28 | 原B0–B3：真实通用执行、必要进程、异步等待、无V9图片/HTML观察 |
| B23/M29 | 原C1–C3、首个语音或视频XM、一个薄委派XD |
| B24/M30 | 项目审阅/回退、计划/只读并行/用户回溯、卡片/配置、T1–T4与终局签收 |

原H01–H09最小完整范围都在L06保留，不借旧“扩展/待触发”拖后；音乐全套/完整Office/IDE/递归平台等原非目标不扩入。原4项安装/分发等发行准备仍独立延期。后端/服务未知是本期依赖阻断，新的费用/测试写入仍需具体授权。

## 直接执行与维护入口

[L06 §15](long_term/L06.md#s15)定批次和分工，[§20](long_term/L06.md#s20)给每项文件/函数/时序/边界/1–3组检查，[§21](long_term/L06.md#s21)给全部D/G核查去向。原V9/单writer/History/M23/M24能力与有效证据复用，不再全仓重复审计。

状态/依赖在task_registry.json，验收在acceptance_cases.json，覆盖在requirements_traceability.json；HC仅工作单元，不建第二状态台账。完成依赖在登记与任务入口明确；稳定接口后的独立叶子可提前。TASK_BOARD只记录实际协调，不因本轮计划自动建实现卡。

修改上述源文件后运行 `python tools/refresh_plan.py`，再运行 `python tools/validate_plan.py`；维护工具变动时用 `python tools/selfcheck_plan.py` 在临时副本验证反例。它们只检查方案，不执行产品或模型测试。不得手改派生验收、批次表和阅读器正文。

[任务索引](03_TASK_INDEX.md) · [批次](delivery/SEQUENCE.md) · [验收总表](delivery/ACCEPTANCE.md) · [发布门](delivery/RELEASE.md) · [交接](delivery/AGENT_HANDOFF.md) · [证据状态](evidence/STATUS.md) · [审计输入](evidence/L06_AUDIT_INPUTS_2026_09_29.md) · [离线阅读器](index.html)

开发分工沿用Sol xhigh主控/主力、Astra xhigh架构/高难、Luna max明确机械任务；核对实际配置，精确写域单writer，不改变产品模型默认。真正实施须下一轮明确指令，连接费用只在有效授权内执行。
