# 三份评估问题处理追踪

> 冻结证据：记录 2026-08-21～24 方案整合依据，不承担当前任务状态。原三份根评估和 dated plan 已从当前工作树移除，完整原文仍可由 Git 历史恢复。当前裁决以根总纲和本计划的权威文档为准。

本表确保评估意见被裁决，而不是简单复制。`采纳` 表示进入方案；`调整采纳` 表示保留问题但修改建议；`不单独立项` 表示已统一修文档，不制造开发任务。

## 1. 严格并行评估

| Finding | 裁决 | 落点 |
|---|---|---|
| B0-01 治理/编号/accepted 冲突 | 调整采纳：先治理激活；accepted 限制发布而非绝对阻止稳定化 | foundation/01、ARCH-0A |
| B0-02 Flow block/LayerItem | 完全采纳 | Surface carrier、Components、Feature Matrix |
| B0-03 Core 循环、ActiveEditor、stale target | 完全采纳；演化 Session | Target DAG、Core、ARCH-3 |
| B0-04 freshness 自相矛盾 | 完全采纳 | knowledge/03 |
| B0-05 TS7 API | 完全采纳 | knowledge/02、ARCH-0B |
| B0-06 未按现状重基线 | 完全采纳 | current facts、Feature Matrix、ARCH-2 |
| B0-07 Epic/FAC raw Store | 采纳；后期 Epic 当前不写伪精确卡，阶段前再生成 S2 | ARCH-1/5/6、S2 模板 |
| H1 current/target/transitional | 完全采纳 | appendix 00/01、semantic provenance |
| H2 file/consumer/release matrix | 完全采纳 | owner map、ARCH-0A/2、Legacy 模板 |
| H3 cross-cut owners | 完全采纳 | module owner、STATE ADR |
| H4 repo-index 最小合同 | 完全采纳；初始 15、依赖前 25 黄金任务 | knowledge 00～04 |
| H5 outcome/performance/IME | 完全采纳 | baseline、validation、ARCH-5 |
| H6 S0/S1/S2 | 完全采纳 | development/01 |
| H7 links/bootstrap/count/token/aliases | 完全采纳 | reading matrix、manifest、knowledge model |

## 2. 126 条详细评估的全局问题

| Finding | 裁决 | 落点 |
|---|---|---|
| G-01 唯一计划衔接 | 采纳，采用激活提交而非长期双总纲 | foundation/01、ARCH-0A |
| G-02 规划设施伪装现状 | 采纳，所有术语有 current/planned 状态 | current facts、glossary |
| G-03 TS7 | 采纳 | knowledge/02 |
| G-04 repo-index 前史 | 调整采纳：作为本地可选素材，不作为权威/阻塞 | knowledge/00 |
| G-05 双 Producer | 完全采纳 | Player/Export、ARCH-2 |
| G-06 任务协议双轨 | 采纳，ARCH-0A 合并治理；本包提供风险层 | workflow/任务协议 |
| G-07 Code mode/简洁术语/能力现状 | 完全采纳 | capability modes、glossary |
| G-08 文件地图遗漏 | 完全采纳 | owner map |

## 3. 详细评估中的重要分项

| 主题 | 处理 |
|---|---|
| contracts 八子合同与 docs/contracts 遗漏 | 纳入 Contract 节点、owner map 和 Forbidden |
| Player 独立 build 链 | 在 current facts、validation、owner map 保留 |
| 两个 Skill 与安装脚本 | current-must-preserve |
| release/examples/fixtures/tests 分层 | owner map、Legacy consumer 证据 |
| Feature 内 tests 与顶层 tests 双轨 | 不要求 Feature 内 tests；测试保持顶层，索引映射 |
| 简洁模式组件入口是目标非现状 | 明确标 partial/planned |
| 简洁高级属性当前隐藏 | 目标改为可发现“更多”，需 UI 验收 |
| 全局层不得模式隐藏 | current-must-preserve |
| AssetMeta 无持久化 hash | 明确不加字段 |
| Blob registry 虚构接口 | 对齐实际接口 |
| DOCX preflight 未覆盖 | 明确适用范围，不假装已有 |
| `courseProjectTypes.ts` 是 re-export 桩 | contract 目录作为真正热点/Forbidden |
| generated 入 Git与确定性 | 保留入 Git，修正 Hash/时间/冲突策略 |
| aliases 双维护 | aliases 仅存 Feature semantic |
| git diff --check 漏 untracked | V0 增 untracked 检查 |
| P5/P6 只有标题 | 改为 Epic 合同，阶段开始再拆 S2 |
| Facade 仍暴露 Store | 禁止，DoD 明确 |
| diagnostics 与现有 CLI 重叠 | 复用现有 validators/CLI，不重建 |
| 删除问答漏 Recovery/flush | 增第八问 |
| current facts/target invariant 混写 | 拆为两份附录 |
| performance/keyboard/focus/DnD/IME | 加入 baseline/validation/outcome |
| 每任务完整 card 过重 | S0/S1/S2 |
| Context Pack 精确 token | 改用字节/行预算 |
| Package manifest 37/38 口径 | 新清单自动按实际文件生成 |

## 4. 12 项正向评估

| ISSUE | 裁决 |
|---|---|
| 01 失效内链 | 修复并自动检查 |
| 02 P 编号冲突 | 改 ARCH-* |
| 03 采纳程序 | ARCH-0A GOV-00 |
| 04 accepted 时序 | 调整：Owner 激活稳定化；发布结论不变 |
| 05 contract 热点指错桩 | contract 目录 Forbidden |
| 06 后期工作包标题 | 采纳其“阶段前细化”，同时补 Epic Goal/Stop |
| 07 setState 表述 | 明确现状 actions 已存在，缺 transaction 语义 |
| 08 TS7 未验证 | 已由另一评估实测并写 spike |
| 09 清单口径 | 自动清单 |
| 10 工作树干净 | BSL-00 |
| 11 docs/contracts | 纳入索引和 owner map |
| 12 风险补充 | 风险登记扩展 |

## 5. 不单独制造任务的问题

以下已在文档统一处理：措辞夸张、示例路径、文件计数、章节编号、术语“简单/简洁”、目标语态、缺失前缀、轻微格式。它们不进入产品开发 backlog。

## 6. 2026-08-23～24 最终复核新增裁决

| Finding | 裁决 | 最终落点 |
|---|---|---|
| Owner 决定立即稳定化 | 完全采纳；accepted 不再是技术前置 | 根总纲 13.0、ARCH-0A |
| 软件做减法而非缩短方案 | 完全采纳；详细文档保留但一个事实一个权威 | README、文档维护协议 |
| repo-index manifest 写 HEAD 会自差异 | 完全采纳；HEAD 只作运行时诊断 | knowledge/03 |
| contracts Forbidden 与 Bootstrap 冲突 | 完全采纳；Required read / Forbidden write | 文件防火墙 |
| “无活动 session 的合法 V9”前提错误 | 完全采纳；先做可达性，正常无 session 显式失败 | Player/Export、ARCH-4 |
| 三个 V9 session 同时竞争的描述不准确 | 完全采纳；改为 exactly-one-active + V8-shaped projection 债务 | Current Facts、Editor Core |
| dbe518e 不是纯文档提交 | 完全采纳；记录三份能力生成物刷新 | Current Facts、Source Evidence |
| 旧 0c12bb0 repo-index 对象可读取 | 调整采纳；只作当前重建参考，不 cherry-pick | knowledge/00 |
| TS7 只覆盖根 tsconfig 不足 | 完全采纳；覆盖 renderer/player、main/preload、e2e 三套配置 | knowledge/02 |
| Code Workspace 混入稳定化产品扩张 | 完全采纳；只保护现有 DeveloperTab，新增体验另列产品 Epic | Capability、UI、ARCH-2 |
| 49 个 work item 不等于可派发任务卡 | 完全采纳；S1/S2 增 Ready 门、dependsOn、热点锁、预算和回滚 | 任务协议与模板 |
| 用户不能逐任务监督 | 完全采纳；1 Integrator + 3 Worker 自动派工、有限重试和产品级升级 | 自动执行工作流 |
