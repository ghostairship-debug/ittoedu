# 1.2 次旗舰模型执行指南

> 使用条件：产品 Owner 已明确指派“实施 1.2”或某个 1.2 节点。本文不产生协调状态，也不替代任务板。单执行者单会话不建卡；跨会话或多人协同时按工作协议只为当前节点建立任务卡。

## 1. 执行入口

开始整个版本只读以下四层，然后进入首个节点，不做全仓重新规划：

1. [1.2 版本结果与 DAG](README.md)
2. [1.2 决策闭合实施合同](IMPLEMENTATION_CONTRACT.md)
3. 当前节点的独立规格
4. 节点 `Read first` 中的源码、直接 consumer 与测试

产品事实冲突时按总纲/架构合同/正式 Schema/源码证据裁决；文件改名但 Owner 未变时更新 spec 指针继续。只有改变持久化语义、能力取舍或导出承诺才停止问 Owner，不能把普通 symbol relocation 当阻断。

## 2. 当前收尾顺序（2026-09-05 本地复审）

本地复审确认原报告 F1–F5，并新增 L1–L6；精确复现、代码定位和未验证范围见 [复审基线](../../reviews/1.2-local-review-2026-09-05.md)。当前已有初始 Native parser 接线、Table/Chart commands、常用色板、统一图表入口、背景 resolver 和六 owner UI；保留有效实现，不按完整版本顺序从头开发。下表定义优先顺序与退出门，不产生协调状态。

| 顺序 | 责任节点 | 当前问题与退出证据 |
| --- | --- | --- |
| 1 | `r12-008-native-authoring-transport` | L1 / P1：初始快照正确，后续 producer 经旧六类投影漏掉 Table/Chart/input。初始与增量使用同一正式 Native 输入，数据/样式/几何与 Undo/Redo 在真实作者宿主即时呈现并 ACK；保留 strict、身份和 barrier，不扩 legacy SceneNode。 |
| 2 | `r12-010-table-core`，随后 `r12-020-chart-core` | L2、L3 / P1：修复命名状态误写 base 和合法 surface target 被拒绝。两者复用既有 effective owner/state 边界，无第二 writer；base、两个 named state 与 surface 独立，失败零写入。Table core 同时提供 L5 的末格文本提交+追加行原子命令，UI 接线留给 Table delivery。 |
| 3 | `r12-007-input-response-delivery` | F1 / P1：在共同传输通过后完成 factory/简洁配置/规则族、双键原子写入、真实 Slide port、try-run/Player/HTML、PPTX 静态填写区和诊断。禁止只删除 unsupported 分支；输入先写双键再恰好执行一支规则。 |
| 4 | `r12-011-table-authoring-delivery` | L5、L6 / P2：末格 Tab 一次提交文本和追加行，焦点到新行稳定 ID，无 stale 误报且一次 Undo 恢复；填充和边框分别消费 alpha，文字不随之透明。同时用真实 UI 闭合 core 的 owner/state 与同步修复。 |
| 5 | `r12-021-chart-authoring-delivery` | F3–F5 / P2：pie/donut 单一非零数据完整成圆/环；轴、网格、标签、四向图例真实生效；bar 无折线/点叠画，自定义轴范围的几何留在 plot。覆盖作者、Player/HTML 与适用原生 PPTX，不因 UI 开关存在判为完成。 |
| 6 | `r12-040-background-authoring` | L4、F2 / P2：合法 HEX 在 focus→Esc→blur 后零提交；真实颜色 consumer 接通 transient preview，最终一次提交，取消/切目标清除预览。保留常用色、稳定控件身份及 Chart 整表草稿；原生连续拖动仍需真实 carrier 验证。 |
| 7 | `r12-050-native-closure` → `r12-060-release` | 所有上游 Acceptance 通过后，汇总本轮全部反例的正式回归和真实 UI/保存重开/历史/Player/HTML/导出证据，再形成 engineering candidate。closure 不接管上游修复；70 项既有通过与局部 build 不等于本版已完成。 |

按用户本轮交接要求，只为依赖已具备、失败明确的 transport、Table core、Chart core 与颜色修复创建当前任务卡；具体状态/Owner 以 [任务板](../../TASK_BOARD.md) 为准。input、Table/Chart delivery 等待其全部依赖 Acceptance，再按协议实例化；closure/release 不预建占位卡。上述修复共享 `authoring-slide` 等写锁，默认单 writer 顺序执行，多个可启动节点不表示可在共享工作树并行写。完成卡删除后，下一执行者据依赖证据进入后续规格。

1.3 的 Flow/Spatial 图表是独立必选扩展，详见 [1.3 路线](../1.3/README.md)；本次 1.2 修复不提前放开容器。表格跨 Surface 扩展不在本次范围。项目色板/Design Token 范围应用在 1.3 接同一颜色控件，1.2 不为它预建主题框架。

## 3. 完整版本的依赖顺序

下表保留完整版本的依赖关系，便于检查遗漏；当前修复入口以 §2 为准，不能把它解释为重做合同、工厂或已通过的背景纵切：

| 顺序 | 节点 | 退出后必须成立 |
| --- | --- | --- |
| 1 | `r12-000-native-contract` | Table/Chart strict 合同与 fail-loud consumer 完整 |
| 2 | `r12-006-input-response-contract` → `r12-008-native-authoring-transport` | 三类新增 Native 内容完整通过作者态 parser/guard，既有类型不退化 |
| 3 | `r12-010-table-core` → `r12-011-table-authoring-delivery` | Table 从可见 UI/真实宿主到 PPTX 闭环 |
| 4 | `r12-020-chart-core` → `r12-021-chart-authoring-delivery` | 五 Chart 经统一入口、真实宿主到 PPTX 闭环 |
| 5 | `r12-007-input-response-delivery` | input 从可见 UI 到 session/PPTX 闭环 |
| 6 | `r12-030-line-authoring` | additive 合同提交后完成 Line 纵切 |
| 7 | `r12-040-background-authoring` | 六 owner 背景及共享常用色/连续调色闭环 |
| 8 | `r12-005-flow-native-authoring-parity` → `r12-045-flow-docx-fidelity` | Flow 作者能力与连续 DOCX 闭环 |
| 9 | `r12-050-native-closure` → `r12-060-release` | 跨功能闭合与 engineering candidate |

该顺序不是状态机。若任务板已有 active writer，必须服从写锁；只有依赖通过且写入边界不重叠才可并行。`contracts-schema` 的 root 写入始终串行；本轮复审不要求再次修改持久化合同。

## 4. 每节点固定循环

1. 记录当前 HEAD 与 `git status --short`，把既有 dirty paths 视为用户所有；只在本节点写锁和 Write scope 内改动。
2. 复现 `Outcome / current evidence`。若行为已经完整存在，直接用 Acceptance 验证并报告，不重写。
3. 按 Execution 顺序实现；所有 candidate 先完整校验再走 canonical command/session transaction，失败零部分写入。
4. 运行 Focused validation 的 1–3 条命令。先修本节点新增失败；基线失败要给出原命令与对照证据，不能改断言逃门。
5. 查看 diff，确认没有双写、silent fallback、越界路径、手改 generated JSON 或未解释格式化；完成后才进入依赖节点。

合同节点或节点内的 additive 合同阶段必须先形成可独立审阅的 contract-only diff，并立即恢复 typecheck；不能把编译红态跨到下一节点。只有 `r12-007-input-response-delivery` 与 `r12-050-native-closure` 按规格生成能力索引，其他节点不碰 generated index。

## 5. 上下文耗尽与恢复

跨会话时，交接只需下面六项，写入当前任务卡而不是另建进度文档：

- Status / Owner：当前节点与唯一执行者；
- Outcome / evidence：已可观察结果、首个尚未通过的验收；
- Write scope：实际改动路径与仍允许路径；
- Write locks：与 manifest 完全一致；
- Acceptance：已通过/未通过条目；
- Validation：已运行的精确命令、结果、相关输入是否随后变化。

恢复者先看 diff、失败断言和当前节点规格；已有证据的依赖闭包未变化时不重跑。不要从 1.2 README 重新“规划一遍”，也不要同时继续两个半完成节点。

## 6. 完成与发布边界

整个 1.2 只有在 `r12-060-release` 清单完整时才可称为 engineering candidate。实现任务授权不自动包含 Git commit、push 或 tag；只有指派明确包含这些动作时才执行。即使 rc 全绿，也不得创建无后缀 `v1.2.0`、更新 Preservation Matrix 或宣称 Owner accepted；这些属于 1.3 后的 S1。

最终交付必须给出：完成的节点、核心用户结果、三条以内最高价值验证、未执行的 S1 人工检查，以及因环境缺失无法验证的真实 carrier。不得用文件数量、代码行数或“所有测试大致通过”替代结果证据。
