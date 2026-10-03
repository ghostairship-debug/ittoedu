# 五个真正入口

果铃工作台只承认以下五份文档为"进入仓库后必读"的真正入口。其他文档（用户指南、组件/运行时指南、合同、复盘）按这五份入口的指引触达；本文不复制其正文，只说明各自承担的角色和不重复承担的部分。

## 1. [AGENTS.md](../AGENTS.md) — 开发原则与长期授权

- 角色：项目级 AI 助手默认加载的开发原则；命令、长期授权、自动加载硬边界的唯一落点。
- 包含：分阶段 Owner 授权（2026-09-22 ~ 2026-09-30）、课件 Skill 路由协议、长期开发原则（不过度设计、最小充分验证）、自动加载硬边界。
- 不重复承担：不复制任务卡进度；不重复 SKILL.md 内的具体提示词；不取代源码注释。

## 2. [ROADMAP.md](ROADMAP.md) — 当前进度与路线

- 角色：回答"现在走到哪一步、下一版是什么、不再做什么"。
- 包含：当前阶段（2.0 收官）的实际验收面、`release-preparation` / `media-followup` 仍 `not_run` 的清单、long_term L02–L05 研究入口、归档地图。
- 不重复承担：不写日报；不替代 TASK_BOARD；不取代 `task_registry.json` / `acceptance_cases.json` 同源 JSON 的状态权威。

## 3. [development-plan/ARCHITECTURE_CONTRACT.md](development-plan/ARCHITECTURE_CONTRACT.md) — 架构不变量

- 角色：什么不能坏。Schema 边界、Player/导出/Session/信任模型/保存等 Must-Preserve 与 Must-Achieve。
- 包含：协议版本（V9、Published V2、Runtime API 2/3、Component API 4）、1.9 / L06 增补、"禁止动作"清单。
- 不重复承担：不解释每条规则的实现出处（由源码承担）；不罗列已通过用例（由 acceptance cases 承担）。

## 4. [GPTpro方案/guoling_2_0_execution_plan/00_README.md](../GPTpro方案/guoling_2_0_execution_plan/00_README.md) — 任务 / 批次 / 验收

- 角色：当前 2.0 收口实施包的主索引。S/M 任务、批次 B00–B24、验收用例、发布门、需求追踪、证据状态全部从这里进入。
- 包含：`task_registry.json`、`acceptance_cases.json`、`requirements_traceability.json` 的来源权威；派生表（`ACCEPTANCE.md`、`SEQUENCE.md`、`TRACEABILITY.md`、`STATUS.md`、`index.html` 阅读器）由 `tools/refresh_plan.py` 重新生成。
- 不重复承担：不替代工程源码注释；不复制 ARCHITECTURE_CONTRACT 的不变量；不写产品 Owner 的主观签收（M30-T08 证据独立保存）。

## 5. [development-plan/WORKING_PROTOCOL.md](development-plan/WORKING_PROTOCOL.md) — 开发规则

- 角色：日常开发怎么干。结果驱动闭环、停止条件、敏感变更触发器、写锁/协调、验证最小化。
- 包含：默认闭环五段、何时停止、何时补读架构合同、单 writer/CAS/授权根不可削弱的边界。
- 不重复承担：不复制 TASK_BOARD 当前状态；不写业务路由（业务/创作规则见 [AGENTS.md](../AGENTS.md) 顶部与 SKILL）；不替代源码自身文档字符串。

---

## 使用建议

- 写代码前：读 [WORKING_PROTOCOL](development-plan/WORKING_PROTOCOL.md) 第 1–3 节，再按需补 [ARCHITECTURE_CONTRACT](development-plan/ARCHITECTURE_CONTRACT.md) 相关条目。
- 评估"现在做什么"：看 [ROADMAP.md](ROADMAP.md)；细节进 [TASK_BOARD](development-plan/TASK_BOARD.md)（自动维护，不手改）。
- 接手 2.0 收口：从 [00_README.md](../GPTpro方案/guoling_2_0_execution_plan/00_README.md) 进入；改登记源文件后跑 `python tools/refresh_plan.py` 与 `python tools/validate_plan.py`。
- 历史不再使用：[archive/](archive/) 是只读快照；L06 v2 已前移为当前闭合，其余 long_term/L02–L05 仅为研究入口。
