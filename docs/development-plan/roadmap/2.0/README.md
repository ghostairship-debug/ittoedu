# 2.0：内部生产创作与插件工作流对标

## 结果与边界

按2026-09-07[当前开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)，在1.8可用编辑和1.9持续会话上完善生产设置、整课与三表面QA、Skills/数据控制、可访问性，并实测对照VS Code Codex与Claude Code插件。核心编辑/模型/模式/观察已属于1.8门，2.0不再以“开放Chat入口”充当产品结果。

以相应教师工作流的上下文可达性、行动、控制、审阅、验证和恢复为最低要求，并证明课件结构/画面/运行的同源理解。025是必选实测门；没有真实插件对照不能宣称达到插件级体验。平台专有的Git worktree/云环境/MCP配置如实单列，不把未实现能力说成全功能复制。

产品仍是受控团队与受信代码环境中的内部生产版。三CLI由用户自行安装认证，应用不接管凭据/模型循环，不建MCP、第二工具目录或写通道；历史ID中的public只是稳定标识。首次发送说明和数据控制延续既定范围，不按教材/PDF/学生作业类别禁止发送，应用删除不承诺删除CLI历史。

S4由Owner实际签署1.9–2.0新增行为；然后发布同一 `v2.0.0` 源码与 `examples/render-host-benchmark/render-host-benchmark-v2.html` 离线HTML。HTML在签署前生成并冻结identity，签署后不重生成。AI验收工作区与纯课程发布HTML各证明自己的目标。无安装器，AI失败不得影响人工编辑/保存/Player/导出。

PPTX生产验收继续为必选并列线，范围见[PPTX能力增强计划](../../PPTX_IMPORT_ENHANCEMENT_PLAN.md)。PPTX不得依赖外部转换软件，旧PPT转换和复杂特性的明确边界保留。

## 任务 DAG

| Task ID | 结果 | Dependencies | Optional | Write locks | Acceptance |
| --- | --- | --- | --- | --- | --- |
| `r20-000-public-governance` | 冻结内部生产支持矩阵数据边界与发布政策 | `r19-060-release` | 否 | `contracts-schema`, `generated-index`, `workspace-shell` | 支持矩阵由真实能力与当前源码生成/核实，三CLI共同任务可完成；人工编辑在所有AI不可用状态继续。 [完整规格](r20-000-public-governance.md) |
| `r20-010-cli-setup-ui` | 完善CLI安装登录诊断与既有模型控制的生产设置 | `r20-000-public-governance`, `r16-030-cli-lifecycle` | 否 | `workspace-shell`, `cli-adapters` | 三CLI分别从可用/缺失状态完成设置与恢复，真实模型配置生效；错误能定位到下一步动作。 [完整规格](r20-010-cli-setup-ui.md) |
| `r20-011-first-use-risk-notice` | 首次外部 CLI 使用前显示一般数据发送风险并记录本地确认 | `r20-000-public-governance` | 否 | `workspace-shell` | 首次发送说明与实际引用一致；取消无外部启动/发送，确认只留应用本地且可查。 [完整规格](r20-011-first-use-risk-notice.md) |
| `r20-020-public-authoring` | 贯通整课生成三表面连续编辑与实际效果QA的生产工作流 | `r20-010-cli-setup-ui`, `r20-011-first-use-risk-notice`, `r18-046-stop-undo-stale` | 否 | `chat-ui`, `store-kernel`, `ai-session` | 真实三表面课例含Native/Component/Runtime，生成/局部修改/QA修复/保存重开/Player/适用导出全部成立；课程内容保留教学路径。 [完整规格](r20-020-public-authoring.md) |
| `r20-021-profile-controls` | 完善内置Skills选择与助手Builder共用发现的生产控制 | `r20-000-public-governance`, `r18-050-three-cli-benchmark`, `r18-104-builder-skill-discovery` | 否 | `generated-index`, `workspace-shell` | 教师可按目的选择Skill并看到真实生效；同一能力在应用/Builder的scope/输入/限制一致，简单任务继续按需读取。 [完整规格](r20-021-profile-controls.md) |
| `r20-022-materials-privacy-controls` | 统一材料引用应用记录删除与Save As数据控制 | `r20-011-first-use-risk-notice`, `r15-020-material-tools-citations`, `r19-040-session-persistence-deletion` | 否 | `main-preload`, `workspace-shell` | 取消引用与实际输入一致，删除可复查且不误删课程内容，Save As新会话；导出数据边界成立。 [完整规格](r20-022-materials-privacy-controls.md) |
| `r20-025-plugin-workflow-parity` | 实测对照Codex和Claude插件并关闭课件工作流体验差距 | `r20-020-public-authoring`, `r20-021-profile-controls`, `r20-022-materials-privacy-controls` | 否 | `chat-ui`, `cli-adapters`, `workspace-shell` | 所有适用于课件的基线工作流有双方实际结果，本产品可完成且无明确能力/控制缺口；课件当前状态理解含结构/画面/运行增量优势证据。 [完整规格](r20-025-plugin-workflow-parity.md) |
| `r20-030-docs-accessibility` | 完成内部设置 / Chat / timeline 的键盘、读屏、错误恢复与用户文档 | `r20-020-public-authoring`, `r20-021-profile-controls`, `r20-022-materials-privacy-controls`, `r20-025-plugin-workflow-parity` | 否 | `workspace-shell`, `generated-index` | 实际键盘/读屏可完成完整流程，状态和重要错误可感知；帮助步骤在当前候选真实可执行。 [完整规格](r20-030-docs-accessibility.md) |
| `r20-040-three-cli-acceptance` | 完成三CLI完整自然语言矩阵与持续创作的最终验收 | `r20-020-public-authoring`, `r20-021-profile-controls`, `r20-022-materials-privacy-controls`, `r20-025-plugin-workflow-parity`, `r20-030-docs-accessibility` | 否 | `cli-adapters` | 三CLI完整矩阵和025对照成立，无当前核心流程阻断、假完成或数据错误；每项结果对应真实实现/环境。 [完整规格](r20-040-three-cli-acceptance.md) |
| `r20-041-pptx-production-acceptance` | 完成 PPTX 导入增强的内部生产创作验收 | `r19-051-pptx-media-effects`, `r20-030-docs-accessibility` | 否 | `app-save-recovery`, `workspace-shell`, `generated-index` | 支持范围可编辑且实际显示/播放正确；每类未支持项准确标页码/类型/原因，人工导入全过程可完成。 [完整规格](r20-041-pptx-production-acceptance.md) |
| `r20-050-owner-acceptance` | Owner 验收 S4 AI 产品并签署 v2.0.0 accepted 候选 | `r20-030-docs-accessibility`, `r20-040-three-cli-acceptance`, `r20-041-pptx-production-acceptance` | 否 | `none` | Owner对当前候选明确S4签署；完整AI与PPTX支持范围成立，固定HTML真实断网运行且身份冻结。 [完整规格](r20-050-owner-acceptance.md) |
| `r20-060-release` | 发布 v2.0.0 内部源码标签与固定课例离线 HTML | `r20-050-owner-acceptance` | 否 | `none` | 发布源码和HTML与050签署相同，离线运行正确、无AI记录/凭据；全部必选节点/签署门可追溯。 [完整规格](r20-060-release.md) |

000之后010/011在依赖上均可开始，但共享workspace-shell，默认串行；020/021/022也按实际锁集成，不虚报并行。三条生产线汇合025真实插件对照→030可访问性/文档→040三CLI完整矩阵；041 PPTX与其并列，最后050签署→060发布。数字ID不表示执行顺序。

## 共同合同与验证

- 复用[实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)的观察/候选/receipt、模式/应用策略、恢复/删除、按需发现和唯一事务；所有AI私有记录不进入CourseProject/Published/Component/Runtime或任何导出。
- 自然语言原话和固定重复门遵循[开发方案第6节](../../AI_ASSISTANT_DELIVERY_PLAN.md#6-高可靠性验收)。025比较真实插件，040复用未失效证据并补最终变化；不反复运行同一付费矩阵。
- 每个完整规格提供现有精确命令、可信反例和真实宿主操作。结构用解析/针对性测试，视觉/互动用实际呈现/动作，读屏需实际工具；自动化不代签Owner。
- 050生成/验证固定HTML后冻结签署；060复用同一候选verify结果，只核对identity、数据边界并断网打开，不能再次执行会重生成HTML的命令。
